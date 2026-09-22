import type {
  AgentDefinition,
  CanUseTool,
  McpServerConfig as ClaudeSdkMcpServerConfig,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import type { McpServerConfig } from "../../agent-sdk-types.js";
import { createProviderEnv, type ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import type { ClaudeAgentConfig } from "./client.js";
import { claudeModelSupportsFastMode } from "./feature-definitions.js";
import { toClaudeSdkMcpConfig } from "./sdk-types-mapping.js";
import type { ClaudeOptions } from "./query.js";

const CLAUDE_SETTING_SOURCES: NonNullable<ClaudeOptions["settingSources"]> = [
  "user",
  "project",
  "local",
];
const CLAUDE_GATEWAY_SETTING_SOURCES: NonNullable<ClaudeOptions["settingSources"]> = [
  "project",
  "local",
];
const CLAUDE_MODEL_SELECTION_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];
const CLAUDE_MODEL_GATEWAY_CARRIER_MODEL = "sonnet";

type ClaudeThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";
type ClaudeThinkingOption = ClaudeThinkingEffort | "ultracode";

interface ClaudeOptionsLogSummary {
  cwd: string | null;
  permissionMode: string | null;
  model: string | null;
  includePartialMessages: boolean;
  settingSources: string[];
  enableFileCheckpointing: boolean;
  hasResume: boolean;
  maxThinkingTokens: number | null;
  hasEnv: boolean;
  envKeyCount: number;
  hasMcpServers: boolean;
  mcpServerNames: string[];
  systemPromptMode: "none" | "string" | "preset" | "custom";
  systemPromptPreset: string | null;
  hasCanUseTool: boolean;
  hasSpawnOverride: boolean;
  hasStderrHandler: boolean;
  pathToClaudeCodeExecutable: string | null;
  persistSession: boolean | null;
  fastMode: boolean | null;
}

export interface BuiltClaudeOptions {
  options: ClaudeOptions;
  requestedModel: string | null;
  modelGatewayOverrideActive: boolean;
}

interface ClaudeOptionsBuilderOptions {
  config: ClaudeAgentConfig;
  launchEnv?: Record<string, string>;
  defaults?: { agents?: Record<string, AgentDefinition> };
  runtimeSettings?: ProviderRuntimeSettings;
  persistSession?: boolean;
  logger: Logger;
  resolveBinary: () => Promise<string>;
  getCurrentMode: () => PermissionMode;
  getClaudeSessionId: () => string | null;
  getPendingFreshSessionId: () => string | null;
  canUseTool: CanUseTool;
  captureStderr: (data: string) => void;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolvePathEnvKey(): "Path" | "PATH" | null {
  if (process.env["Path"] !== undefined) return "Path";
  if (process.env["PATH"] !== undefined) return "PATH";
  return null;
}

function isClaudeThinkingEffort(value: string | null | undefined): value is ClaudeThinkingEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isClaudeThinkingOption(value: string | null | undefined): value is ClaudeThinkingOption {
  return value === "ultracode" || isClaudeThinkingEffort(value);
}

function readClaudeFastModeSetting(settings: ClaudeOptions["settings"]): boolean | null {
  if (!settings || typeof settings === "string") {
    return null;
  }
  return typeof settings.fastMode === "boolean" ? settings.fastMode : null;
}

function mergeClaudeSettings(
  settings: ClaudeOptions["settings"],
  updates: NonNullable<Exclude<ClaudeOptions["settings"], string>>,
): ClaudeOptions["settings"] {
  if (!settings || typeof settings === "string") {
    return settings ?? updates;
  }
  const merged = { ...settings, ...updates };
  if (settings.env || updates.env) {
    merged.env = {
      ...settings.env,
      ...updates.env,
    };
  }
  return merged;
}

function readRuntimeSettingsEnv(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): Record<string, string> | null {
  const entries = Object.entries(runtimeSettings?.env ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function buildModelGatewayOverrideBaseUrl(baseUrl: string, model: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/u, "");
  const gatewayPathMatch = normalizedPath.match(/^(.*\/api\/model-gateways\/[^/]+)(?:\/v1)?$/u);
  if (!gatewayPathMatch?.[1]) {
    return null;
  }

  parsed.pathname = `${gatewayPathMatch[1]}/model-overrides/${encodeURIComponent(model)}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function resolveClaudeModelGatewayOverride(input: {
  model: string | undefined;
  env: NodeJS.ProcessEnv;
}): { env: Record<string, string>; launchModel: string } | null {
  const selectedModel = input.model?.trim();
  const baseUrl = input.env["ANTHROPIC_BASE_URL"]?.trim();
  if (!selectedModel || !baseUrl) {
    return null;
  }

  const overrideBaseUrl = buildModelGatewayOverrideBaseUrl(baseUrl, selectedModel);
  if (!overrideBaseUrl) {
    return null;
  }

  const env: Record<string, string> = { ANTHROPIC_BASE_URL: overrideBaseUrl };
  const token = input.env["ANTHROPIC_API_KEY"] ?? input.env["ANTHROPIC_AUTH_TOKEN"];
  if (token) {
    env.ANTHROPIC_API_KEY = token;
    env.ANTHROPIC_AUTH_TOKEN = token;
  }
  return { env, launchModel: CLAUDE_MODEL_GATEWAY_CARRIER_MODEL };
}

function removeClaudeModelSelectionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  for (const key of CLAUDE_MODEL_SELECTION_ENV_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

function isTruthyEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized !== undefined &&
    normalized.length > 0 &&
    normalized !== "0" &&
    normalized !== "false" &&
    normalized !== "no" &&
    normalized !== "off"
  );
}

function detectIneligibleAutoModeTransport(env: NodeJS.ProcessEnv): "Bedrock" | "Vertex" | null {
  if (isTruthyEnvValue(env.CLAUDE_CODE_USE_BEDROCK)) {
    return "Bedrock";
  }
  if (isTruthyEnvValue(env.CLAUDE_CODE_USE_VERTEX)) {
    return "Vertex";
  }
  return null;
}

/** Builds and owns Claude Agent SDK launch options and environment overlays. */
export class ClaudeOptionsBuilder {
  constructor(private readonly state: ClaudeOptionsBuilderOptions) {}

  async build(): Promise<BuiltClaudeOptions> {
    const { thinking, effort, ultracode } = this.resolveThinkingConfig();
    const extraClaudeOptions = this.state.config.extra?.claude;
    const { sdkEnv, flagSettingsOptions, launchModel, modelGatewayOverrideActive } =
      this.buildSdkLaunchOptions(extraClaudeOptions, { ultracode });
    this.assertAutoModeEligible(this.state.getCurrentMode(), sdkEnv);

    const claudeBinary = await this.state.resolveBinary();
    this.state.logger.debug(
      {
        claudeBinary,
        pathEnvKey: resolvePathEnvKey(),
        pathIncludesClaudeLocalBin: (process.env["Path"] ?? process.env["PATH"] ?? "")
          .toLowerCase()
          .includes("\\.local\\bin"),
      },
      "Resolved Claude executable",
    );
    const sessionBinding: Pick<ClaudeOptions, "resume" | "sessionId"> = {};
    const pendingFreshSessionId = this.state.getPendingFreshSessionId();
    const claudeSessionId = this.state.getClaudeSessionId();
    if (pendingFreshSessionId) {
      sessionBinding.sessionId = pendingFreshSessionId;
    } else if (claudeSessionId) {
      sessionBinding.resume = claudeSessionId;
    }

    const base: ClaudeOptions = {
      cwd: this.state.config.cwd,
      includePartialMessages: true,
      permissionMode: this.state.getCurrentMode(),
      allowDangerouslySkipPermissions: true,
      agents: this.state.defaults?.agents,
      canUseTool: this.state.canUseTool,
      pathToClaudeCodeExecutable: claudeBinary,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          composeSystemPromptParts(
            this.state.config.systemPrompt,
            this.state.config.daemonAppendSystemPrompt,
          ) ?? "",
      },
      settingSources: CLAUDE_SETTING_SOURCES,
      stderr: (data: string) => {
        this.state.captureStderr(data);
        this.state.logger.error({ stderr: data.trim() }, "Claude Agent SDK stderr");
      },
      enableFileCheckpointing: true,
      ...sessionBinding,
      ...(thinking ? { thinking } : {}),
      ...(effort ? { effort } : {}),
      ...extraClaudeOptions,
      ...flagSettingsOptions,
      ...(this.state.persistSession === undefined
        ? {}
        : { persistSession: this.state.persistSession }),
      env: sdkEnv,
    };
    const options = this.applyPostOptions(base, launchModel);
    return {
      options,
      requestedModel: modelGatewayOverrideActive
        ? (this.state.config.model ?? null)
        : (options.model ?? null),
      modelGatewayOverrideActive,
    };
  }

  buildSdkEnv(extraClaudeOptions: Partial<ClaudeOptions> | undefined): NodeJS.ProcessEnv {
    return createProviderEnv({
      baseEnv: process.env,
      runtimeSettings: this.state.runtimeSettings,
      overlays: [
        extraClaudeOptions?.env,
        {
          MCP_TIMEOUT: "600000",
          MCP_TOOL_TIMEOUT: "600000",
        },
        this.state.launchEnv,
      ],
    });
  }

  resolveFastModeSetting(): boolean | null {
    if (!claudeModelSupportsFastMode(this.state.config.model)) {
      return null;
    }
    return this.state.config.featureValues?.fast_mode === true;
  }

  assertAutoModeEligible(mode: PermissionMode, env?: NodeJS.ProcessEnv): void {
    if (mode !== "auto") {
      return;
    }
    const transport = detectIneligibleAutoModeTransport(
      env ?? this.buildSdkEnv(this.state.config.extra?.claude),
    );
    if (transport === null) {
      return;
    }
    throw new Error(
      `Claude Auto mode requires the Anthropic API and is not supported when Claude Code uses ${transport}. Select another permission mode or unset the ${transport === "Bedrock" ? "CLAUDE_CODE_USE_BEDROCK" : "CLAUDE_CODE_USE_VERTEX"} environment variable.`,
    );
  }

  private resolveThinkingConfig(): {
    thinking: ClaudeOptions["thinking"];
    effort: ClaudeOptions["effort"];
    ultracode: boolean;
  } {
    const thinkingOptionId = isClaudeThinkingOption(this.state.config.thinkingOptionId)
      ? this.state.config.thinkingOptionId
      : undefined;
    if (thinkingOptionId === "ultracode") {
      return { thinking: { type: "adaptive" }, effort: "xhigh", ultracode: true };
    }
    if (thinkingOptionId) {
      return { thinking: { type: "adaptive" }, effort: thinkingOptionId, ultracode: false };
    }
    return { thinking: undefined, effort: undefined, ultracode: false };
  }

  private applyPostOptions(base: ClaudeOptions, launchModel: string | undefined): ClaudeOptions {
    if (this.state.config.mcpServers) {
      base.mcpServers = this.normalizeMcpServers(this.state.config.mcpServers);
    }
    if (launchModel) {
      base.model = launchModel;
    }
    const claudeSessionId = this.state.getClaudeSessionId();
    if (claudeSessionId && !this.state.getPendingFreshSessionId()) {
      base.resume = claudeSessionId;
    }
    if (this.state.runtimeSettings?.disallowedTools?.length) {
      base.disallowedTools = [
        ...(base.disallowedTools ?? []),
        ...this.state.runtimeSettings.disallowedTools,
      ];
    }
    return base;
  }

  private buildSdkLaunchOptions(
    extraClaudeOptions: Partial<ClaudeOptions> | undefined,
    extra?: { ultracode?: boolean },
  ): {
    sdkEnv: NodeJS.ProcessEnv;
    flagSettingsOptions: Partial<Pick<ClaudeOptions, "settings" | "settingSources">>;
    launchModel: string | undefined;
    modelGatewayOverrideActive: boolean;
  } {
    const baseEnv = this.buildSdkEnv(extraClaudeOptions);
    const modelGatewayOverride = resolveClaudeModelGatewayOverride({
      model: this.state.config.model,
      env: baseEnv,
    });
    const sdkEnv = modelGatewayOverride
      ? removeClaudeModelSelectionEnv({ ...baseEnv, ...modelGatewayOverride.env })
      : baseEnv;
    const flagSettingsOptions: Partial<Pick<ClaudeOptions, "settings" | "settingSources">> =
      this.buildFlagSettingsOptions(extraClaudeOptions, modelGatewayOverride?.env, extra);
    if (modelGatewayOverride) {
      flagSettingsOptions.settingSources = CLAUDE_GATEWAY_SETTING_SOURCES;
    }
    return {
      sdkEnv,
      flagSettingsOptions,
      launchModel: modelGatewayOverride?.launchModel ?? this.state.config.model,
      modelGatewayOverrideActive: Boolean(modelGatewayOverride),
    };
  }

  private buildFlagSettingsOptions(
    extraClaudeOptions: Partial<ClaudeOptions> | undefined,
    envOverride?: Record<string, string>,
    extra?: { ultracode?: boolean },
  ): Pick<ClaudeOptions, "settings"> | Record<string, never> {
    const runtimeEnv = readRuntimeSettingsEnv(this.state.runtimeSettings);
    const fastMode = this.resolveFastModeSetting();
    const env = runtimeEnv || envOverride ? { ...runtimeEnv, ...envOverride } : null;
    if (!env && fastMode === null && !extra?.ultracode) {
      return {};
    }
    const updates: NonNullable<Exclude<ClaudeOptions["settings"], string>> = {
      ...(env ? { env } : {}),
      ...(fastMode === null ? {} : { fastMode }),
      ...(extra?.ultracode ? { ultracode: true } : {}),
    };
    return { settings: mergeClaudeSettings(extraClaudeOptions?.settings, updates) };
  }

  private normalizeMcpServers(
    servers: Record<string, McpServerConfig>,
  ): Record<string, ClaudeSdkMcpServerConfig> {
    const result: Record<string, ClaudeSdkMcpServerConfig> = {};
    for (const [name, config] of Object.entries(servers)) {
      result[name] = toClaudeSdkMcpConfig(config);
    }
    return result;
  }
}

/** Produces a credential-safe summary of Claude SDK options for debug logging. */
export function summarizeClaudeOptionsForLog(options: ClaudeOptions): ClaudeOptionsLogSummary {
  const systemPromptRaw = options.systemPrompt;
  const systemPromptSummary = (() => {
    if (!systemPromptRaw) {
      return { mode: "none" as const, preset: null };
    }
    if (typeof systemPromptRaw === "string") {
      return { mode: "string" as const, preset: null };
    }
    const prompt = toObjectRecord(systemPromptRaw);
    const promptType = typeof prompt?.type === "string" ? prompt.type : "custom";
    return {
      mode: promptType === "preset" ? ("preset" as const) : ("custom" as const),
      preset: typeof prompt?.preset === "string" && prompt.preset.length > 0 ? prompt.preset : null,
    };
  })();
  const mcpServerNames = options.mcpServers ? Object.keys(options.mcpServers).sort() : [];

  return {
    cwd: typeof options.cwd === "string" ? options.cwd : null,
    permissionMode: typeof options.permissionMode === "string" ? options.permissionMode : null,
    model: typeof options.model === "string" ? options.model : null,
    includePartialMessages: options.includePartialMessages === true,
    settingSources: Array.isArray(options.settingSources) ? options.settingSources : [],
    enableFileCheckpointing: options.enableFileCheckpointing === true,
    hasResume: typeof options.resume === "string" && options.resume.length > 0,
    maxThinkingTokens:
      typeof options.maxThinkingTokens === "number" ? options.maxThinkingTokens : null,
    hasEnv: Boolean(options.env),
    envKeyCount: Object.keys(options.env ?? {}).length,
    hasMcpServers: mcpServerNames.length > 0,
    mcpServerNames,
    systemPromptMode: systemPromptSummary.mode,
    systemPromptPreset: systemPromptSummary.preset,
    hasCanUseTool: typeof options.canUseTool === "function",
    hasSpawnOverride: typeof options.spawnClaudeCodeProcess === "function",
    hasStderrHandler: typeof options.stderr === "function",
    pathToClaudeCodeExecutable:
      typeof options.pathToClaudeCodeExecutable === "string"
        ? options.pathToClaudeCodeExecutable
        : null,
    persistSession: typeof options.persistSession === "boolean" ? options.persistSession : null,
    fastMode: readClaudeFastModeSetting(options.settings),
  };
}
