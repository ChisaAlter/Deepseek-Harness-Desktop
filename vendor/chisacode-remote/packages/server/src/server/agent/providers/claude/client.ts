import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import { buildClaudeFeatures } from "./feature-definitions.js";
import { isClaudeTranscriptNoiseText, isSyntheticUserEntry } from "./history-converter.js";
import { getClaudeModelsWithSettings } from "./models.js";
import type { ClaudeOptions, ClaudeQueryFactory } from "./query.js";
import { isUnknownArray } from "./sdk-types-mapping.js";
import {
  buildBinaryDiagnosticRows,
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentFeature,
  AgentLaunchContext,
  AgentMetadata,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
  AgentTimelineItem,
  ListModelsOptions,
  ListPersistedAgentsOptions,
  McpServerConfig,
  PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import {
  checkProviderLaunchAvailable,
  createProviderEnv,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import { execCommand } from "../../../../utils/spawn.js";

export const CLAUDE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: true,
  supportsRewindBoth: true,
};

export type ClaudeAgentConfig = AgentSessionConfig & { provider: "claude" };

export interface ClaudeAgentClientOptions {
  defaults?: { agents?: Record<string, AgentDefinition> };
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  queryFactory?: ClaudeQueryFactory;
  resolveBinary?: () => Promise<string>;
}

export interface ClaudeAgentSessionOptions {
  defaults?: { agents?: Record<string, AgentDefinition> };
  runtimeSettings?: ProviderRuntimeSettings;
  handle?: AgentPersistenceHandle;
  agentId?: string;
  launchEnv?: Record<string, string>;
  persistSession?: boolean;
  logger: Logger;
  queryFactory?: ClaudeQueryFactory;
  resolveBinary: () => Promise<string>;
}

type ClaudeSessionFactory = (
  config: ClaudeAgentConfig,
  options: ClaudeAgentSessionOptions,
) => AgentSession;

interface ClaudeAgentClientRuntimeOptions extends ClaudeAgentClientOptions {
  sessionFactory: ClaudeSessionFactory;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isMetadata(value: unknown): value is AgentMetadata {
  return typeof value === "object" && value !== null;
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isMetadata(value)) {
    return false;
  }
  if (value.type === "stdio") {
    return typeof value.command === "string";
  }
  if (value.type === "http" || value.type === "sse") {
    return typeof value.url === "string";
  }
  return false;
}

function isMcpServersRecord(value: unknown): value is Record<string, McpServerConfig> {
  if (!isMetadata(value)) {
    return false;
  }
  return Object.values(value).every((config) => isMcpServerConfig(config));
}

function isClaudeExtra(value: unknown): value is Partial<ClaudeOptions> {
  return isMetadata(value);
}

function coerceSessionMetadata(metadata: AgentMetadata | undefined): Partial<AgentSessionConfig> {
  if (!isMetadata(metadata)) {
    return {};
  }

  const result: Partial<AgentSessionConfig> = {};
  if (metadata.provider === "claude" || metadata.provider === "codex") {
    result.provider = metadata.provider;
  }
  if (typeof metadata.cwd === "string") result.cwd = metadata.cwd;
  if (typeof metadata.modeId === "string") result.modeId = metadata.modeId;
  if (typeof metadata.model === "string") result.model = metadata.model;
  if (typeof metadata.title === "string" || metadata.title === null) result.title = metadata.title;
  if (typeof metadata.approvalPolicy === "string") {
    result.approvalPolicy = metadata.approvalPolicy;
  }
  if (typeof metadata.sandboxMode === "string") result.sandboxMode = metadata.sandboxMode;
  if (typeof metadata.networkAccess === "boolean") result.networkAccess = metadata.networkAccess;
  if (typeof metadata.webSearch === "boolean") result.webSearch = metadata.webSearch;
  if (isMetadata(metadata.extra)) {
    const extra: AgentSessionConfig["extra"] = {};
    if (isMetadata(metadata.extra.codex)) extra.codex = metadata.extra.codex;
    if (isClaudeExtra(metadata.extra.claude)) extra.claude = metadata.extra.claude;
    if (extra.codex || extra.claude) result.extra = extra;
  }
  if (typeof metadata.systemPrompt === "string") result.systemPrompt = metadata.systemPrompt;
  if (isMcpServersRecord(metadata.mcpServers)) result.mcpServers = metadata.mcpServers;
  return result;
}

export function resolveClaudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/** Implements Claude client discovery and constructs sessions through an injected factory. */
export class ClaudeAgentClientRuntime implements AgentClient {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly defaults?: { agents?: Record<string, AgentDefinition> };
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly queryFactory?: ClaudeQueryFactory;
  private readonly resolveBinary: () => Promise<string>;
  private readonly sessionFactory: ClaudeSessionFactory;

  constructor(options: ClaudeAgentClientRuntimeOptions) {
    this.defaults = options.defaults;
    this.logger = options.logger.child({ module: "agent", provider: "claude" });
    this.runtimeSettings = options.runtimeSettings;
    this.queryFactory = options.queryFactory;
    this.resolveBinary = options.resolveBinary ?? (() => resolveClaudeBinary(this.runtimeSettings));
    this.sessionFactory = options.sessionFactory;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    const claudeConfig = this.assertConfig(config);
    return this.sessionFactory(claudeConfig, {
      defaults: this.defaults,
      runtimeSettings: this.runtimeSettings,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      persistSession: options?.persistSession,
      logger: this.logger,
      queryFactory: this.queryFactory,
      resolveBinary: this.resolveBinary,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = coerceSessionMetadata(handle.metadata);
    const merged: Partial<AgentSessionConfig> = { ...metadata, ...overrides };
    if (!merged.cwd) {
      throw new Error("Claude resume requires the original working directory in metadata");
    }
    const claudeConfig = this.assertConfig({
      ...merged,
      provider: "claude",
      cwd: merged.cwd,
    });
    return this.sessionFactory(claudeConfig, {
      defaults: this.defaults,
      runtimeSettings: this.runtimeSettings,
      handle,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      logger: this.logger,
      queryFactory: this.queryFactory,
      resolveBinary: this.resolveBinary,
    });
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return await getClaudeModelsWithSettings(this.logger);
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const claudeConfig = this.assertConfig(config);
    return buildClaudeFeatures({
      modelId: claudeConfig.model,
      fastModeEnabled: claudeConfig.featureValues?.fast_mode === true,
    });
  }

  async listPersistedAgents(
    options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    const env = createProviderEnv({ baseEnv: process.env, runtimeSettings: this.runtimeSettings });
    const projectsRoot = path.join(resolveClaudeConfigDir(env), "projects");
    if (!(await pathExists(projectsRoot))) {
      return [];
    }
    const limit = options?.limit ?? 20;
    const candidates = await collectRecentClaudeSessions(projectsRoot, limit * 3);
    const parsed = await Promise.all(
      candidates.map((candidate) => parseClaudeSessionDescriptor(candidate.path, candidate.mtime)),
    );
    return parsed
      .filter((descriptor): descriptor is PersistedAgentDescriptor => descriptor !== null)
      .slice(0, limit);
  }

  async isAvailable(): Promise<boolean> {
    const launch = await resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: "claude",
    });
    return (await checkProviderLaunchAvailable(launch)).available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await resolveProviderLaunch({
        commandConfig: this.runtimeSettings?.command,
        defaultBinary: "claude",
      });
      const availability = await checkProviderLaunchAvailable(launch);
      const available = availability.available;
      const auth = available
        ? await resolveClaudeAuth(launch, availability, this.runtimeSettings)
        : null;
      let modelsValue = "Not checked";
      let status = formatDiagnosticStatus(available);

      if (available) {
        try {
          const models = await this.listModels({ cwd: os.homedir(), force: false });
          modelsValue = String(models.length);
        } catch (error) {
          modelsValue = `Error - ${toDiagnosticErrorMessage(error)}`;
          status = formatDiagnosticStatus(available, { source: "model fetch", cause: error });
        }
      }

      return {
        diagnostic: formatProviderDiagnostic("Claude Code", [
          ...(await buildBinaryDiagnosticRows(launch, availability)),
          ...(auth ? [{ label: "Auth", value: auth }] : []),
          { label: "Models", value: modelsValue },
          { label: "Status", value: status },
        ]),
      };
    } catch (error) {
      return { diagnostic: formatProviderDiagnosticError("Claude Code", error) };
    }
  }

  private assertConfig(config: AgentSessionConfig): ClaudeAgentConfig {
    if (config.provider !== "claude") {
      throw new Error(`ClaudeAgentClient received config for provider '${config.provider}'`);
    }
    return { ...config, provider: "claude" } as ClaudeAgentConfig;
  }
}

async function resolveClaudeBinary(runtimeSettings?: ProviderRuntimeSettings): Promise<string> {
  const launch = await resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  if (availability.available) {
    return availability.resolvedPath ?? launch.command;
  }
  throw new Error(
    "Claude binary not found. Install Claude Code (https://github.com/anthropics/claude-code) and ensure it is available in your shell PATH.",
  );
}

async function resolveClaudeAuth(
  launch: ResolvedProviderLaunch,
  availability: { resolvedPath: string | null },
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<string | null> {
  const run = async (
    executable: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    try {
      return await execCommand(executable, args, {
        ...createProviderEnvSpec({ runtimeSettings }),
        timeout: 5_000,
      });
    } catch (error) {
      const record = toObjectRecord(error);
      const stdout = typeof record?.stdout === "string" ? record.stdout : "";
      const stderr = typeof record?.stderr === "string" ? record.stderr : "";
      const fallbackMessage = typeof record?.message === "string" ? record.message : "";
      return { stdout, stderr: stderr || fallbackMessage };
    }
  };

  try {
    const executable = availability.resolvedPath ?? launch.command;
    const result = await run(executable, [...launch.args, "auth", "status"]);
    const combined = [result.stdout, result.stderr]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join("\n");
    return combined || null;
  } catch {
    return null;
  }
}

interface ClaudeSessionCandidate {
  path: string;
  mtime: Date;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectRecentClaudeSessions(
  root: string,
  limit: number,
): Promise<ClaudeSessionCandidate[]> {
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(root);
  } catch {
    return [];
  }
  const projectFileLists = await Promise.all(
    projectDirs.map(async (dirName) => {
      const projectPath = path.join(root, dirName);
      try {
        const stats = await fs.stat(projectPath);
        if (!stats.isDirectory()) return { projectPath, files: [] as string[] };
        return { projectPath, files: await fs.readdir(projectPath) };
      } catch {
        return { projectPath, files: [] as string[] };
      }
    }),
  );
  const fileEntries = projectFileLists.flatMap(({ projectPath, files }) =>
    files.filter((file) => file.endsWith(".jsonl")).map((file) => path.join(projectPath, file)),
  );
  const statResults = await Promise.all(
    fileEntries.map(async (fullPath) => {
      try {
        return { path: fullPath, mtime: (await fs.stat(fullPath)).mtime };
      } catch {
        return null;
      }
    }),
  );
  return statResults
    .filter((entry): entry is ClaudeSessionCandidate => entry !== null)
    .sort((left, right) => right.mtime.getTime() - left.mtime.getTime())
    .slice(0, limit);
}

interface ClaudeSessionDescriptorAccumulator {
  sessionId: string | null;
  cwd: string | null;
  title: string | null;
  timeline: AgentTimelineItem[];
}

function applyClaudeSessionEntryToAccumulator(
  entryRaw: unknown,
  accumulator: ClaudeSessionDescriptorAccumulator,
): void {
  const entry = toObjectRecord(entryRaw);
  if (!entry || entry.isSidechain || (entry.type === "user" && isSyntheticUserEntry(entry))) {
    return;
  }
  if (!accumulator.sessionId && typeof entry.sessionId === "string") {
    accumulator.sessionId = entry.sessionId;
  }
  if (!accumulator.cwd && typeof entry.cwd === "string") {
    accumulator.cwd = entry.cwd;
  }
  if (entry.type === "user" && entry.message) {
    const text = extractClaudeUserText(entry.message);
    if (text) {
      accumulator.title ??= text;
      accumulator.timeline.push({ type: "user_message", text });
    }
    return;
  }
  if (entry.type === "assistant" && entry.message) {
    const text = extractClaudeUserText(entry.message);
    if (text) {
      accumulator.timeline.push({ type: "assistant_message", text });
    }
  }
}

async function parseClaudeSessionDescriptor(
  filePath: string,
  mtime: Date,
): Promise<PersistedAgentDescriptor | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const accumulator: ClaudeSessionDescriptorAccumulator = {
    sessionId: null,
    cwd: null,
    title: null,
    timeline: [],
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      applyClaudeSessionEntryToAccumulator(JSON.parse(line), accumulator);
    } catch {
      continue;
    }
    if (accumulator.sessionId && accumulator.cwd && accumulator.title) {
      break;
    }
  }

  const { sessionId, cwd, title, timeline } = accumulator;
  if (!sessionId || !cwd) {
    return null;
  }
  const persistence: AgentPersistenceHandle = {
    provider: "claude",
    sessionId,
    nativeHandle: sessionId,
    metadata: { provider: "claude", cwd },
  };
  return {
    provider: "claude",
    sessionId,
    cwd,
    title: (title ?? "").trim() || `Claude session ${sessionId.slice(0, 8)}`,
    lastActivityAt: mtime,
    persistence,
    timeline,
  };
}

function extractClaudeUserText(messageRaw: unknown): string | null {
  const message = toObjectRecord(messageRaw);
  if (!message) {
    return null;
  }
  if (typeof message.content === "string") {
    const normalized = message.content.trim();
    return normalized && !isClaudeTranscriptNoiseText(normalized) ? normalized : null;
  }
  if (typeof message.text === "string") {
    const normalized = message.text.trim();
    return normalized && !isClaudeTranscriptNoiseText(normalized) ? normalized : null;
  }
  if (isUnknownArray(message.content)) {
    for (const block of message.content) {
      const blockRecord = toObjectRecord(block);
      if (blockRecord && typeof blockRecord.text === "string") {
        const normalized = blockRecord.text.trim();
        if (normalized && !isClaudeTranscriptNoiseText(normalized)) {
          return normalized;
        }
      }
    }
  }
  return null;
}
