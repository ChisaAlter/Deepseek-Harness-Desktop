import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Logger } from "pino";

import type { ProviderProfileModel, ProviderRuntimeSettings } from "../provider-launch-config.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface KimiCodeAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  providerId?: string;
  label?: string;
  models?: ProviderProfileModel[];
}

export class KimiCodeAgentClient extends GenericACPAgentClient {
  constructor(options: KimiCodeAgentClientOptions) {
    const providerId = options.providerId ?? "kimi";
    const label = options.label ?? "Kimi Code";
    const env = prepareKimiEnv({
      providerId,
      env: options.runtimeSettings?.env,
      models: options.models,
    });

    super({
      logger: options.logger,
      command: resolveKimiCommand(options.runtimeSettings),
      env,
      providerId,
      label,
    });
  }
}

function resolveKimiCommand(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): [string, ...string[]] {
  if (runtimeSettings?.command?.mode === "replace") {
    const [command, ...args] = runtimeSettings.command.argv;
    return [command, ...args];
  }
  if (runtimeSettings?.command?.mode === "append") {
    return ["kimi", ...(runtimeSettings.command.args ?? []), "acp"];
  }
  return ["kimi", "acp"];
}

function prepareKimiEnv(options: {
  providerId: string;
  env: Record<string, string> | undefined;
  models: ProviderProfileModel[] | undefined;
}): Record<string, string> | undefined {
  const env = options.env;
  const apiKey = env?.OPENAI_API_KEY?.trim();
  const baseUrl = env?.OPENAI_BASE_URL?.trim();
  const models = options.models ?? [];
  if (!apiKey || !baseUrl || models.length === 0 || env?.KIMI_CODE_HOME) {
    return env;
  }

  const kimiHome = resolveManagedKimiHome(options.providerId, baseUrl);
  writeManagedKimiConfig(kimiHome, {
    providerId: "chisacode",
    apiKey,
    baseUrl,
    models,
  });

  return {
    ...env,
    KIMI_CODE_HOME: kimiHome,
  };
}

function resolveManagedKimiHome(providerId: string, baseUrl: string): string {
  const chisacodeHome = process.env.CHISACODE_HOME?.trim() || join(homedir(), ".chisacode");
  const safeProviderId = providerId.replace(/[^a-zA-Z0-9_-]+/gu, "-");
  const configHash = createHash("sha256").update(baseUrl).digest("hex").slice(0, 10);
  return join(chisacodeHome, "provider-runtime", "kimi-code", `${safeProviderId}-${configHash}`);
}

function writeManagedKimiConfig(
  kimiHome: string,
  options: {
    providerId: string;
    apiKey: string;
    baseUrl: string;
    models: ProviderProfileModel[];
  },
): void {
  mkdirSync(kimiHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(kimiHome, "config.toml"), buildManagedKimiConfigToml(options), {
    encoding: "utf8",
    mode: 0o600,
  });
  writeManagedKimiAuthSentinel(kimiHome);
}

function writeManagedKimiAuthSentinel(kimiHome: string): void {
  const credentialsDir = join(kimiHome, "credentials");
  mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(credentialsDir, "kimi-code.json"),
    `${JSON.stringify(buildManagedKimiAuthSentinel(), null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

function buildManagedKimiAuthSentinel(): Record<string, string | number> {
  return {
    access_token: "chisacode-managed-api-key-provider",
    refresh_token: "chisacode-managed-api-key-provider",
    expires_at: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
    scope: "",
    token_type: "Bearer",
    expires_in: 10 * 365 * 24 * 60 * 60,
  };
}

export function buildManagedKimiConfigToml(options: {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  models: ProviderProfileModel[];
}): string {
  const models = mergeKimiModels(options.models);
  const defaultModel = models.find((model) => model.isDefault)?.id ?? models[0]?.id;
  const lines = [
    `default_model = ${tomlString(defaultModel ?? "")}`,
    "",
    `[providers.${tomlKey(options.providerId)}]`,
    `type = "openai"`,
    `api_key = ${tomlString(options.apiKey)}`,
    `base_url = ${tomlString(options.baseUrl)}`,
  ];

  for (const model of models) {
    lines.push(
      "",
      `[models.${tomlKey(model.id)}]`,
      `provider = ${tomlString(options.providerId)}`,
      `model = ${tomlString(model.id)}`,
      `max_context_size = ${model.contextWindowMaxTokens ?? 262144}`,
      `capabilities = ${tomlStringArray(modelCapabilities(model))}`,
      `display_name = ${tomlString(model.label)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function mergeKimiModels(models: ProviderProfileModel[]): ProviderProfileModel[] {
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

function modelCapabilities(model: ProviderProfileModel): string[] {
  const capabilities = model.supportsTools === false ? [] : ["tool_use"];
  if (model.supportsImages) {
    capabilities.push("image_in");
  }
  if ((model.thinkingOptions?.length ?? 0) > 0) {
    capabilities.push("thinking");
  }
  return capabilities;
}

function tomlKey(value: string): string {
  return tomlString(value);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}
