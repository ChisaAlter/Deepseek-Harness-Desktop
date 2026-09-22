import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentLaunchContext,
  AgentMetadata,
  AgentPersistenceHandle,
  AgentSessionConfig,
  McpServerConfig,
} from "../../agent-sdk-types.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import {
  CHISACODE_PI_CAPTURE_EXTENSION_COMMAND,
  CHISACODE_PI_COMMAND_RESULT_MARKER,
  CHISACODE_PI_ENTRY_CAPTURE_MARKER,
  CHISACODE_PI_TREE_EXTENSION_COMMAND,
} from "./extension-history-controller.js";
import type { PiRuntime, PiRuntimeSession, PiStartSessionInput } from "./runtime.js";
import type { PiRpcSlashCommand, PiSessionState } from "./rpc-types.js";
import {
  applyRuntimeModelPrefix,
  DEFAULT_PI_THINKING_LEVEL,
  normalizePiThinkingOption,
} from "./session-runtime.js";

const PI_MCP_PROBE_TIMEOUT_MS = 5_000;

interface PiPersistenceMetadata {
  cwd?: string;
  model?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
}

interface PiResumeConfig {
  cwd: string;
  model?: string;
  thinkingOptionId?: string;
  config: AgentSessionConfig;
}

interface PiMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: false;
  oauth?: false;
}

interface PiTempFile {
  path: string;
  cleanup: () => void;
}

interface PiSessionResources {
  mcpConfigPath?: string;
  extensionPath: string;
  /** Path to a temp file holding the append system prompt (Windows-safe). */
  systemPromptPath?: string;
  supportsMcpServers: boolean;
  cleanup: () => void;
}

interface PiSessionLifecycleOptions {
  runtime: PiRuntime;
  logger: Logger;
  modelPrefix: string | null;
  baseCapabilities: AgentCapabilityFlags;
}

export interface PiSessionInitialization {
  runtimeSession: PiRuntimeSession;
  config: AgentSessionConfig;
  initialState: PiSessionState;
  capabilities: AgentCapabilityFlags;
  cleanup: () => void;
  modelPrefix?: string;
  logger: Logger;
}

function parsePersistenceMetadata(metadata: AgentMetadata | undefined): PiPersistenceMetadata {
  if (!metadata) {
    return {};
  }
  return {
    ...(typeof metadata.cwd === "string" ? { cwd: metadata.cwd } : {}),
    ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
    ...(typeof metadata.thinkingOptionId === "string"
      ? { thinkingOptionId: metadata.thinkingOptionId }
      : {}),
    ...(typeof metadata.systemPrompt === "string" ? { systemPrompt: metadata.systemPrompt } : {}),
  };
}

function buildResumeConfig(
  metadata: PiPersistenceMetadata,
  overrides: Partial<AgentSessionConfig> | undefined,
): PiResumeConfig {
  const overrideConfig = overrides ?? {};
  const cwd = overrideConfig.cwd ?? metadata.cwd ?? process.cwd();
  const model = overrideConfig.model ?? metadata.model;
  const thinkingOptionId = overrideConfig.thinkingOptionId ?? metadata.thinkingOptionId;
  return {
    cwd,
    model,
    thinkingOptionId,
    config: {
      ...overrideConfig,
      provider: "pi",
      cwd,
      model,
      thinkingOptionId,
      systemPrompt: overrideConfig.systemPrompt ?? metadata.systemPrompt,
    },
  };
}

function toPiMcpConfig(config: McpServerConfig): PiMcpServerConfig {
  if (config.type === "stdio") {
    return {
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
    };
  }

  return {
    url: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
    auth: false,
    oauth: false,
  };
}

function createPiMcpConfigFile(servers: Record<string, McpServerConfig>): PiTempFile {
  const dir = mkdtempSync(join(tmpdir(), "chisacode-pi-mcp-"));
  const filePath = join(dir, "mcp.json");
  const mcpServers: Record<string, PiMcpServerConfig> = {};
  for (const [name, serverConfig] of Object.entries(servers)) {
    mcpServers[name] = toPiMcpConfig(serverConfig);
  }
  try {
    writeFileSync(filePath, `${JSON.stringify({ mcpServers }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    path: filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Write the append system prompt to a temp file.
 * Pi accepts either inline text or a file path for `--append-system-prompt`.
 * Using a file avoids Windows `cmd.exe` truncating the spawn command line when
 * the prompt contains newlines (which would drop later args like `--extension`).
 * @param content Full append system prompt text
 * @returns Temp file handle with cleanup
 */
function createPiSystemPromptFile(content: string): PiTempFile {
  const dir = mkdtempSync(join(tmpdir(), "chisacode-pi-system-prompt-"));
  const filePath = join(dir, "append-system-prompt.txt");
  try {
    writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    path: filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function createPiChisaCodeExtensionFile(): PiTempFile {
  const dir = mkdtempSync(join(tmpdir(), "chisacode-pi-extension-"));
  const filePath = join(dir, "chisacode-integration.mjs");
  try {
    writeFileSync(
      filePath,
      `
\tfunction decodePayload(encoded) {
\t  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
\t}

\tfunction readTextContent(content) {
\t  if (typeof content === "string") {
\t    return content;
\t  }
\t  if (!Array.isArray(content)) {
\t    return "";
\t  }
\t  return content
\t    .filter((part) => part && part.type === "text" && typeof part.text === "string")
\t    .map((part) => part.text)
\t    .join("\\n\\n");
\t}

\tfunction getCapturedUserEntries(ctx) {
\t  return ctx.sessionManager
\t    .getEntries()
\t    .filter((entry) => entry.type === "message" && entry.message?.role === "user")
\t    .map((entry) => ({
\t      id: entry.id,
\t      parentId: entry.parentId ?? null,
\t      text: readTextContent(entry.message.content),
\t    }));
\t}

\tfunction emitEntryCapture(ctx, reason, requestId) {
\t  ctx.ui.notify(
\t    "${CHISACODE_PI_ENTRY_CAPTURE_MARKER} " +
\t      JSON.stringify({ reason, requestId, entries: getCapturedUserEntries(ctx) }),
\t    "info",
\t  );
\t}

\tfunction emitCommandResult(ctx, requestId, result) {
\t  ctx.ui.notify(
\t    "${CHISACODE_PI_COMMAND_RESULT_MARKER} " + JSON.stringify({ requestId, ...result }),
\t    result.ok ? "info" : "error",
\t  );
\t}
\t
\texport default function chisacodeIntegration(pi) {
\t  pi.on("session_start", async (_event, ctx) => {
\t    emitEntryCapture(ctx, "session_start");
\t  });

\t  pi.on("turn_end", async (_event, ctx) => {
\t    emitEntryCapture(ctx, "turn_end");
\t  });

\t  pi.registerCommand("${CHISACODE_PI_CAPTURE_EXTENSION_COMMAND}", {
\t    description: "Internal ChisaCode entry capture bridge",
\t    handler: async (args, ctx) => {
\t      const payload = decodePayload(args.trim());
\t      emitEntryCapture(ctx, "command", payload.requestId);
\t    },
\t  });

\t  pi.registerCommand("${CHISACODE_PI_TREE_EXTENSION_COMMAND}", {
\t    description: "Internal ChisaCode tree navigation bridge",
\t    handler: async (args, ctx) => {
\t      const payload = decodePayload(args.trim());
\t      try {
\t        const result = await ctx.navigateTree(payload.targetId, { summarize: false });
\t        emitEntryCapture(ctx, "tree_navigation");
\t        emitCommandResult(ctx, payload.requestId, { ok: true, result });
\t      } catch (error) {
\t        const message = error instanceof Error ? error.message : String(error);
\t        emitCommandResult(ctx, payload.requestId, { ok: false, error: message });
\t        throw error;
\t      }
\t    },
\t  });
\t}
`.trimStart(),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    path: filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function isPiMcpAdapterCommand(command: PiRpcSlashCommand): boolean {
  if (command.source !== "extension" || !/^mcp(?::\d+)?$/.test(command.name)) {
    return false;
  }
  if (!command.sourceInfo) {
    return true;
  }
  return JSON.stringify(command.sourceInfo).includes("pi-mcp-adapter");
}

export class PiSessionLifecycle {
  constructor(private readonly options: PiSessionLifecycleOptions) {}

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<PiSessionInitialization> {
    const normalizedConfig: AgentSessionConfig = {
      ...config,
      model: applyRuntimeModelPrefix(config.model, this.options.modelPrefix),
    };
    const systemPrompt = composeSystemPromptParts(
      normalizedConfig.systemPrompt,
      normalizedConfig.daemonAppendSystemPrompt,
    );
    const resources = await this.prepareResources(
      normalizedConfig.cwd,
      normalizedConfig.mcpServers,
      launchContext?.env,
      systemPrompt,
    );
    return this.startSession(
      normalizedConfig,
      {
        cwd: normalizedConfig.cwd,
        model: normalizedConfig.model,
        thinkingOptionId:
          normalizePiThinkingOption(normalizedConfig.thinkingOptionId) ?? DEFAULT_PI_THINKING_LEVEL,
        systemPrompt: resources.systemPromptPath ?? systemPrompt,
        env: launchContext?.env,
      },
      resources,
    );
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<PiSessionInitialization> {
    const sessionFile = handle.nativeHandle;
    if (!sessionFile) {
      throw new Error("Pi resume requires a native session file handle");
    }

    const persistenceMetadata = parsePersistenceMetadata(handle.metadata);
    const resumeConfig = buildResumeConfig(persistenceMetadata, overrides);
    const model = applyRuntimeModelPrefix(resumeConfig.model, this.options.modelPrefix);
    const normalizedConfig: AgentSessionConfig = {
      ...resumeConfig.config,
      model,
    };
    const systemPrompt = composeSystemPromptParts(
      normalizedConfig.systemPrompt,
      normalizedConfig.daemonAppendSystemPrompt,
    );
    const resources = await this.prepareResources(
      resumeConfig.cwd,
      normalizedConfig.mcpServers,
      launchContext?.env,
      systemPrompt,
    );
    return this.startSession(
      normalizedConfig,
      {
        cwd: resumeConfig.cwd,
        session: sessionFile,
        model,
        thinkingOptionId: normalizePiThinkingOption(resumeConfig.thinkingOptionId) ?? undefined,
        systemPrompt: resources.systemPromptPath ?? systemPrompt,
        env: launchContext?.env,
      },
      resources,
    );
  }

  private async startSession(
    config: AgentSessionConfig,
    input: PiStartSessionInput,
    resources: PiSessionResources,
  ): Promise<PiSessionInitialization> {
    let runtimeSession: PiRuntimeSession;
    try {
      runtimeSession = await this.options.runtime.startSession({
        ...input,
        mcpConfigPath: resources.mcpConfigPath,
        extensionPaths: [resources.extensionPath],
      });
    } catch (error) {
      resources.cleanup();
      throw error;
    }

    try {
      return {
        runtimeSession,
        config,
        initialState: await runtimeSession.getState(),
        capabilities: {
          ...this.options.baseCapabilities,
          supportsMcpServers: resources.supportsMcpServers,
        },
        cleanup: resources.cleanup,
        ...(this.options.modelPrefix ? { modelPrefix: this.options.modelPrefix } : {}),
        logger: this.options.logger,
      };
    } catch (error) {
      await runtimeSession.close().catch(() => undefined);
      resources.cleanup();
      throw error;
    }
  }

  private async prepareResources(
    cwd: string,
    servers: Record<string, McpServerConfig> | undefined,
    env: Record<string, string> | undefined,
    systemPrompt?: string,
  ): Promise<PiSessionResources> {
    const mcpConfig = await this.prepareMcpConfig(cwd, servers, env);
    let extension: PiTempFile;
    try {
      extension = createPiChisaCodeExtensionFile();
    } catch (error) {
      mcpConfig?.cleanup();
      throw error;
    }

    let systemPromptFile: PiTempFile | undefined;
    const trimmedSystemPrompt = systemPrompt?.trim();
    if (trimmedSystemPrompt) {
      try {
        systemPromptFile = createPiSystemPromptFile(trimmedSystemPrompt);
      } catch (error) {
        extension.cleanup();
        mcpConfig?.cleanup();
        throw error;
      }
    }

    return {
      ...(mcpConfig ? { mcpConfigPath: mcpConfig.path } : {}),
      extensionPath: extension.path,
      ...(systemPromptFile ? { systemPromptPath: systemPromptFile.path } : {}),
      supportsMcpServers: mcpConfig !== null,
      cleanup: this.createCleanup([
        mcpConfig?.cleanup,
        extension.cleanup,
        systemPromptFile?.cleanup,
      ]),
    };
  }

  private createCleanup(cleanups: Array<(() => void) | undefined>): () => void {
    let cleaned = false;
    return () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      for (const cleanup of cleanups) {
        try {
          cleanup?.();
        } catch (error) {
          this.options.logger.warn({ err: error }, "Pi temporary resource cleanup failed");
        }
      }
    };
  }

  private async prepareMcpConfig(
    cwd: string,
    servers: Record<string, McpServerConfig> | undefined,
    env: Record<string, string> | undefined,
  ): Promise<PiTempFile | null> {
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }
    if (!(await this.detectMcpAdapter(cwd, env))) {
      return null;
    }
    return createPiMcpConfigFile(servers);
  }

  private async detectMcpAdapter(
    cwd: string,
    env: Record<string, string> | undefined,
  ): Promise<boolean> {
    const runtimeSession = await this.options.runtime.startSession({ cwd, env }).catch((error) => {
      this.options.logger.debug({ err: error, cwd }, "Pi MCP adapter probe failed to start");
      return null;
    });
    if (!runtimeSession) {
      return false;
    }
    try {
      return await withTimeout(
        runtimeSession.getCommands().then((commands) => commands.some(isPiMcpAdapterCommand)),
        PI_MCP_PROBE_TIMEOUT_MS,
        `Timed out probing Pi MCP adapter after ${PI_MCP_PROBE_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      this.options.logger.debug({ err: error, cwd }, "Pi MCP adapter probe failed");
      return false;
    } finally {
      await runtimeSession.close().catch(() => undefined);
    }
  }
}
