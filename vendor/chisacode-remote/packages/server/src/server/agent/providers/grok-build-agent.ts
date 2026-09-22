import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Logger } from "pino";

import type { ProviderProfileModel, ProviderRuntimeSettings } from "../provider-launch-config.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface GrokBuildAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  providerId?: string;
  label?: string;
  models?: ProviderProfileModel[];
}

export class GrokBuildAgentClient extends GenericACPAgentClient {
  private readonly managedGatewayHome: ManagedGrokGatewayHome | null;

  constructor(options: GrokBuildAgentClientOptions) {
    const providerId = options.providerId ?? "grokbuild";
    const label = options.label ?? "Grok Build";
    const prepared = prepareGrokGatewayEnv({
      providerId,
      env: options.runtimeSettings?.env,
      models: options.models,
    });
    const env = prepared.env;
    const runtimeSettings = withGatewayAlwaysApproveCommand(options.runtimeSettings, env);

    super({
      logger: options.logger,
      command: resolveGrokBuildCommand(runtimeSettings),
      env,
      providerId,
      label,
    });
    this.managedGatewayHome = prepared.managedHome;
  }

  /**
   * Grok CLI mutates managed `config.toml` after launch (marketplace, per-model
   * base_url, dropped `[endpoints]`). Re-materialize before every process spawn so
   * built-in ids like `grok-4.5` keep routing through the model gateway.
   */
  protected override async spawnProcess(
    launchEnv?: Record<string, string>,
    options?: { initializeTimeoutMs?: number },
  ) {
    if (this.managedGatewayHome) {
      writeManagedGrokConfig(this.managedGatewayHome.grokHome, {
        apiKey: this.managedGatewayHome.apiKey,
        baseUrl: this.managedGatewayHome.baseUrl,
        models: this.managedGatewayHome.models,
      });
    }
    return super.spawnProcess(launchEnv, options);
  }
}

interface ManagedGrokGatewayHome {
  grokHome: string;
  apiKey: string;
  baseUrl: string;
  models: ProviderProfileModel[];
}

interface PreparedGrokGatewayEnv {
  env: Record<string, string> | undefined;
  managedHome: ManagedGrokGatewayHome | null;
}

/**
 * Gateway-backed Grok sessions need non-interactive tool approval so multi-turn
 * shell loops do not stall on ChisaCode permission prompts.
 */
function withGatewayAlwaysApproveCommand(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  env: Record<string, string> | undefined,
): ProviderRuntimeSettings | undefined {
  if (!isGatewayRoutedGrokEnv(env)) {
    return runtimeSettings;
  }
  if (runtimeSettings?.command?.mode === "replace") {
    // Respect explicit full argv replacements; callers can include --always-approve.
    return runtimeSettings;
  }
  const existingArgs =
    runtimeSettings?.command?.mode === "append" ? (runtimeSettings.command.args ?? []) : [];
  if (existingArgs.includes("--always-approve")) {
    return runtimeSettings ?? { env };
  }
  return {
    ...runtimeSettings,
    command: {
      mode: "append",
      args: [...existingArgs, "--always-approve"],
    },
    env: runtimeSettings?.env ?? env,
  };
}

function isGatewayRoutedGrokEnv(env: Record<string, string> | undefined): boolean {
  if (!env) {
    return false;
  }
  const modelsBase = env.GROK_MODELS_BASE_URL?.trim() ?? "";
  const openAiBase = env.OPENAI_BASE_URL?.trim() ?? "";
  return (
    modelsBase.includes("/api/model-gateways/") ||
    openAiBase.includes("/api/model-gateways/") ||
    Boolean(env.GROK_HOME?.includes("provider-runtime") && env.GROK_HOME.includes("grokbuild"))
  );
}

/**
 * Resolves the Grok Build ACP launcher command for provider runtime settings.
 * @param runtimeSettings Optional provider command and environment overrides
 * @returns The complete Grok Build ACP argv
 */
export function resolveGrokBuildCommand(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): [string, ...string[]] {
  if (runtimeSettings?.command?.mode === "replace") {
    const [command, ...args] = runtimeSettings.command.argv;
    return [command, ...args];
  }
  // Gateway faces inject `--always-approve` via append so tool-call loops do not
  // stall on ChisaCode permission prompts for every shell execute.
  if (runtimeSettings?.command?.mode === "append") {
    return ["grok", ...(runtimeSettings.command.args ?? []), "agent", "stdio"];
  }
  return ["grok", "agent", "stdio"];
}

/**
 * Materializes an isolated Grok home when gateway credentials are present so
 * model-gateway faces never read or write the user's `~/.grok` free-tier config.
 *
 * Always rewrites managed `config.toml` for ChisaCode-owned homes. Grok CLI can
 * rewrite that file after launch and drop `[endpoints]`, which sends built-in
 * model ids such as `grok-4.5` back to native xAI auth.
 * @param options Provider id, runtime env, and gateway models
 * @returns Prepared env plus optional managed-home rewrite handle
 */
export function prepareGrokGatewayEnv(options: {
  providerId: string;
  env: Record<string, string> | undefined;
  models: ProviderProfileModel[] | undefined;
}): PreparedGrokGatewayEnv {
  const env = options.env;
  const gateway = resolveGatewayRoutingCredentials(env, options.models);
  if (!gateway) {
    return { env, managedHome: null };
  }

  const managedHomePath = resolveManagedGrokHome(options.providerId, gateway.baseUrl);
  const existingHome = env?.GROK_HOME?.trim() || "";
  if (existingHome && !isManagedGrokHomePath(existingHome, managedHomePath)) {
    // Respect an explicit external GROK_HOME, but still force gateway routing env
    // so built-in model ids do not fall back to console.x.ai with the gateway token.
    return {
      env: withGatewayRoutingEnv(env, gateway),
      managedHome: null,
    };
  }

  const managedHome = materializeManagedGrokHome({
    grokHome: existingHome || managedHomePath,
    ...gateway,
  });
  return {
    env: withGatewayRoutingEnv(env, {
      apiKey: managedHome.apiKey,
      baseUrl: managedHome.baseUrl,
      grokHome: managedHome.grokHome,
    }),
    managedHome,
  };
}

function resolveGatewayRoutingCredentials(
  env: Record<string, string> | undefined,
  models: ProviderProfileModel[] | undefined,
): { apiKey: string; baseUrl: string; models: ProviderProfileModel[] } | null {
  const apiKey = env?.OPENAI_API_KEY?.trim() || env?.XAI_API_KEY?.trim() || "";
  const baseUrl = env?.OPENAI_BASE_URL?.trim() || env?.GROK_MODELS_BASE_URL?.trim() || "";
  const resolvedModels = models ?? [];
  if (!apiKey || !baseUrl || resolvedModels.length === 0) {
    return null;
  }
  return { apiKey, baseUrl, models: resolvedModels };
}

function materializeManagedGrokHome(options: ManagedGrokGatewayHome): ManagedGrokGatewayHome {
  writeManagedGrokConfig(options.grokHome, options);
  return options;
}

function withGatewayRoutingEnv(
  env: Record<string, string> | undefined,
  options: { apiKey: string; baseUrl: string; grokHome?: string },
): Record<string, string> {
  return {
    ...env,
    ...(options.grokHome ? { GROK_HOME: options.grokHome } : {}),
    // Grok CLI routes OpenAI-compatible inference through models_base_url /
    // GROK_MODELS_BASE_URL. Per-model base_url on built-in ids like grok-4.5 is
    // ignored and still hits console.x.ai.
    GROK_MODELS_BASE_URL: options.baseUrl,
    // Prefer the "always allow" row when Grok still surfaces a first prompt.
    GROK_DEFAULT_SELECTED_PERMISSION: "always_allow_all_sessions",
    XAI_API_KEY: options.apiKey,
    OPENAI_API_KEY: options.apiKey,
    OPENAI_BASE_URL: options.baseUrl,
  };
}

/**
 * Compatibility wrapper for callers that only need the env map.
 * @param options Provider id, runtime env, and gateway models
 * @returns Env with gateway routing applied, or the original env
 */
export function resolveGrokGatewayEnv(options: {
  providerId: string;
  env: Record<string, string> | undefined;
  models: ProviderProfileModel[] | undefined;
}): Record<string, string> | undefined {
  return prepareGrokGatewayEnv(options).env;
}

function isManagedGrokHomePath(existingHome: string, managedHomePath: string): boolean {
  if (existingHome === managedHomePath) {
    return true;
  }
  const normalizedExisting = existingHome.replaceAll("\\", "/").toLowerCase();
  const marker = "/provider-runtime/grokbuild/";
  return normalizedExisting.includes(marker);
}

function resolveManagedGrokHome(providerId: string, baseUrl: string): string {
  const chisacodeHome = process.env.CHISACODE_HOME?.trim() || join(homedir(), ".chisacode");
  const safeProviderId = providerId.replace(/[^a-zA-Z0-9_-]+/gu, "-");
  const configHash = createHash("sha256").update(baseUrl).digest("hex").slice(0, 10);
  return join(chisacodeHome, "provider-runtime", "grokbuild", `${safeProviderId}-${configHash}`);
}

function writeManagedGrokConfig(
  grokHome: string,
  options: {
    apiKey: string;
    baseUrl: string;
    models: ProviderProfileModel[];
  },
): void {
  mkdirSync(grokHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(grokHome, "config.toml"), buildManagedGrokConfigToml(options), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Builds a managed Grok `config.toml` that routes models through an OpenAI-compatible gateway.
 *
 * Grok CLI only honors custom OpenAI-compatible backends via `[endpoints].models_base_url`
 * (or `GROK_MODELS_BASE_URL`). Setting `base_url` under `[model.<builtin-id>]` does **not**
 * divert built-in ids such as `grok-4.5` away from xAI free/subscription auth.
 *
 * @param options API credentials, base URL, and model list
 * @returns TOML document contents
 */
export function buildManagedGrokConfigToml(options: {
  apiKey: string;
  baseUrl: string;
  models: ProviderProfileModel[];
}): string {
  const models = mergeGrokModels(options.models);
  const defaultModel = models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
  const lines = [
    // Headless gateway sessions should not stop on interactive approval UI.
    "[permissions]",
    'default_selected_permission = "always_allow_all_sessions"',
    "",
    "[ui]",
    "yolo = true",
    "remember_tool_approvals = true",
    "",
    "[models]",
    `default = ${tomlString(defaultModel)}`,
    "",
    "[endpoints]",
    `models_base_url = ${tomlString(options.baseUrl)}`,
    `api_key = ${tomlString(options.apiKey)}`,
  ];

  // Optional per-model display/context overrides. Do not set base_url here for
  // built-in model ids; Grok ignores it and keeps the xAI endpoint.
  for (const model of models) {
    const tableKey = grokModelTableKey(model.id);
    lines.push("", `[model.${tableKey}]`, `model = ${tomlString(model.id)}`);
    if (model.label && model.label !== model.id) {
      lines.push(`name = ${tomlString(model.label)}`);
    }
    if (model.description) {
      lines.push(`description = ${tomlString(model.description)}`);
    }
    if (model.contextWindowMaxTokens) {
      lines.push(`context_window = ${model.contextWindowMaxTokens}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function mergeGrokModels(models: ProviderProfileModel[]): ProviderProfileModel[] {
  const mergedModels: ProviderProfileModel[] = [];
  for (const model of models) {
    const existingIndex = mergedModels.findIndex((candidate) => candidate.id === model.id);
    if (existingIndex === -1) {
      mergedModels.push(model);
      continue;
    }
    mergedModels[existingIndex] = {
      ...mergedModels[existingIndex],
      ...model,
    };
  }
  return mergedModels;
}

function grokModelTableKey(modelId: string): string {
  // Bare keys match Grok's own examples (`[model.grok-4.5]`); quote anything else.
  if (/^[A-Za-z0-9._-]+$/u.test(modelId)) {
    return modelId;
  }
  return tomlString(modelId);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
