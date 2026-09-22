import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { generateComponentPromptSection } from "@chisacode/protocol/generative-ui/component-manifest";
import { getAgentProviderDefinition } from "@chisacode/protocol/provider-manifest";
import type { Logger } from "pino";

import {
  buildCompanionMcpUrl,
  COMPANION_MCP_SERVER_NAME,
  createCompanionTokenEntry,
  type CompanionMcpTokenEntry,
} from "./companion-mcp-injection.js";
import type {
  AgentLaunchContext,
  AgentModelDefinition,
  AgentSessionConfig,
  AgentSkillEffectivePolicy,
} from "./agent-sdk-types.js";
import type { EffectiveMcpServersResult } from "./mcp-server-management.js";
import type { AgentProviderController } from "./agent-provider-controller.js";
import { loadProjectContext } from "../project-context.js";

interface AgentLaunchConfigControllerOptions {
  appendSystemPrompt: string;
  logger: Logger;
  mcpBaseUrl: string | null;
  providers: Pick<AgentProviderController, "getClient">;
  /**
   * Optional cache lookup for default model resolution. When present and non-empty,
   * `normalizeConfig` reuses these models instead of calling `client.listModels`
   * (which for codex spawns a throwaway app-server process).
   */
  resolveCachedModels?: (
    cwd: string | undefined,
    provider: AgentSessionConfig["provider"],
  ) => readonly AgentModelDefinition[] | undefined;
  resolveMcpServers?: (
    agentId: string,
    config: AgentSessionConfig,
  ) => EffectiveMcpServersResult | undefined;
  resolveSkillPolicy?: (
    agentId: string,
    config: AgentSessionConfig,
  ) => AgentSkillEffectivePolicy | undefined;
}

function resolveDefaultModelId(models: readonly AgentModelDefinition[]): string | undefined {
  return (models.find((model) => model.isDefault) ?? models[0])?.id;
}

/** Owns daemon policy injection, companion credentials, and provider launch normalization. */
export class AgentLaunchConfigController {
  private appendSystemPrompt: string;
  private readonly companionMcpTokens = new Map<string, CompanionMcpTokenEntry>();
  private readonly logger: Logger;
  private mcpBaseUrl: string | null;
  private readonly providers: Pick<AgentProviderController, "getClient">;
  private readonly resolveCachedModels: AgentLaunchConfigControllerOptions["resolveCachedModels"];
  private readonly resolveMcpServers: AgentLaunchConfigControllerOptions["resolveMcpServers"];
  private readonly resolveSkillPolicy: AgentLaunchConfigControllerOptions["resolveSkillPolicy"];

  constructor(options: AgentLaunchConfigControllerOptions) {
    this.appendSystemPrompt = options.appendSystemPrompt;
    this.logger = options.logger;
    this.mcpBaseUrl = options.mcpBaseUrl;
    this.providers = options.providers;
    this.resolveCachedModels = options.resolveCachedModels;
    this.resolveMcpServers = options.resolveMcpServers;
    this.resolveSkillPolicy = options.resolveSkillPolicy;
  }

  setMcpBaseUrl(url: string | null): void {
    if (url !== this.mcpBaseUrl) {
      this.companionMcpTokens.clear();
    }
    this.mcpBaseUrl = url;
  }

  validateCompanionMcpToken(parentAgentId: string, token: string): boolean {
    const now = Date.now();
    this.purgeExpiredCompanionTokens(now);
    const entry = this.companionMcpTokens.get(token);
    return entry !== undefined && entry.parentAgentId === parentAgentId;
  }

  setAppendSystemPrompt(prompt: string | null | undefined): void {
    this.appendSystemPrompt = prompt ?? "";
  }

  async prepareAgentConfig(
    config: AgentSessionConfig,
    agentId: string,
  ): Promise<AgentSessionConfig> {
    const mcpConfig = this.applyDaemonMcpServers(config, agentId);
    const skillConfig = this.applyDaemonSkillPolicy(mcpConfig, agentId);
    const normalized = await this.normalizeConfig(skillConfig);
    return this.applyDaemonAppendSystemPrompt(normalized);
  }

  async normalizeConfig(config: AgentSessionConfig): Promise<AgentSessionConfig> {
    const normalized: AgentSessionConfig = { ...config };
    const runtimeProvider = normalized.runtimeProvider ?? normalized.provider;

    if (normalized.cwd) {
      normalized.cwd = resolve(normalized.cwd);
      try {
        const cwdStats = await stat(normalized.cwd);
        if (!cwdStats.isDirectory()) {
          throw new Error(`Working directory is not a directory: ${normalized.cwd}`);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new Error(`Working directory does not exist: ${normalized.cwd}`, { cause: error });
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to access working directory: ${normalized.cwd}`, { cause: error });
      }
    }

    if (typeof normalized.model === "string") {
      const trimmed = normalized.model.trim();
      normalized.model = trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
    }

    if (!normalized.model) {
      normalized.model = await this.resolveDefaultModel(normalized.cwd, runtimeProvider);
    }

    if (!normalized.modeId) {
      try {
        normalized.modeId =
          getAgentProviderDefinition(normalized.provider).defaultModeId ?? undefined;
      } catch (error) {
        this.logger.debug(
          { err: error, provider: normalized.provider },
          "Failed to resolve default mode for provider",
        );
      }
    }

    return normalized;
  }

  private async resolveDefaultModel(
    cwd: string | undefined,
    provider: AgentSessionConfig["provider"],
  ): Promise<string | undefined> {
    const cachedModels = this.resolveCachedModels?.(cwd, provider);
    if (cachedModels && cachedModels.length > 0) {
      return resolveDefaultModelId(cachedModels);
    }

    const client = this.providers.getClient(provider);
    if (!client) {
      return undefined;
    }

    try {
      const models = await client.listModels({
        cwd: cwd ?? process.cwd(),
        force: false,
      });
      return resolveDefaultModelId(models);
    } catch (error) {
      this.logger.debug({ err: error, provider }, "Failed to list models for default resolution");
      return undefined;
    }
  }

  buildRuntimeLaunchConfig(config: AgentSessionConfig): AgentSessionConfig {
    const runtimeProvider = config.runtimeProvider ?? config.provider;
    return runtimeProvider === config.provider ? config : { ...config, provider: runtimeProvider };
  }

  buildLaunchContext(agentId: string, env?: Record<string, string>): AgentLaunchContext {
    return {
      agentId,
      env: {
        ...env,
        CHISACODE_AGENT_ID: agentId,
      },
    };
  }

  private applyDaemonMcpServers(
    config: AgentSessionConfig,
    resolvedAgentId: string,
  ): AgentSessionConfig {
    const resolved = this.resolveMcpServers?.(resolvedAgentId, config);
    const managedMcpServers = resolved?.servers ?? {};
    const hasManagedMcpServers = Object.keys(managedMcpServers).length > 0;
    const daemonMcpEnabled = resolved?.daemonMcpEnabled ?? true;
    if (this.mcpBaseUrl == null || !daemonMcpEnabled) {
      if (!hasManagedMcpServers) {
        return config;
      }
      return {
        ...config,
        mcpServers: {
          ...managedMcpServers,
          ...config.mcpServers,
        },
      };
    }

    this.purgeExpiredCompanionTokens(Date.now());
    const { token, entry } = createCompanionTokenEntry(resolvedAgentId);
    this.companionMcpTokens.set(token, entry);
    return {
      ...config,
      mcpServers: {
        ...managedMcpServers,
        chisacode: {
          type: "http" as const,
          url: `${this.mcpBaseUrl}?callerAgentId=${resolvedAgentId}`,
        },
        [COMPANION_MCP_SERVER_NAME]: {
          type: "http" as const,
          url: buildCompanionMcpUrl({
            mcpBaseUrl: this.mcpBaseUrl,
            parentAgentId: resolvedAgentId,
            token,
          }),
        },
        ...config.mcpServers,
      },
    };
  }

  private applyDaemonSkillPolicy(config: AgentSessionConfig, agentId: string): AgentSessionConfig {
    const policy = this.resolveSkillPolicy?.(agentId, config);
    if (!policy) {
      return config;
    }
    const runtimeProvider = config.runtimeProvider ?? config.provider;
    if (config.provider !== "codex" && runtimeProvider !== "codex") {
      return config;
    }
    return {
      ...config,
      extra: {
        ...config.extra,
        codex: {
          ...config.extra?.codex,
          skillsPolicy: policy,
        },
      },
    };
  }

  private async applyDaemonAppendSystemPrompt(
    config: AgentSessionConfig,
  ): Promise<AgentSessionConfig> {
    const genUiSection = generateComponentPromptSection();
    const projectToc = this.resolveProjectContextToc(config.cwd);
    const parts = [this.appendSystemPrompt.trim(), projectToc, genUiSection].filter(Boolean);
    const daemonAppendSystemPrompt = parts.join("\n\n");
    const next = { ...config };
    delete next.daemonAppendSystemPrompt;

    return daemonAppendSystemPrompt
      ? {
          ...next,
          daemonAppendSystemPrompt,
        }
      : next;
  }

  /** Max TOC size injected into system prompt (8 KB). Larger contexts are truncated. */
  private static readonly MAX_TOC_BYTES = 8192;

  private resolveProjectContextToc(cwd: string | undefined): string {
    if (!cwd) return "";
    try {
      const context = loadProjectContext(cwd, resolve(cwd, ".chisacode-context"));
      if (context.toc) {
        let toc = context.toc;
        if (Buffer.byteLength(toc, "utf8") > AgentLaunchConfigController.MAX_TOC_BYTES) {
          toc = Buffer.from(toc, "utf8")
            .subarray(0, AgentLaunchConfigController.MAX_TOC_BYTES)
            .toString("utf8");
          toc += "\n[truncated — project context too large]";
        }
        return `<project-context>\n${toc}\n</project-context>`;
      }
    } catch {
      // Non-fatal — project context is best-effort
    }
    return "";
  }

  private purgeExpiredCompanionTokens(now: number): void {
    for (const [token, entry] of this.companionMcpTokens) {
      if (entry.expiresAt < now) {
        this.companionMcpTokens.delete(token);
      }
    }
  }
}
