import type { AgentSessionConfig, McpServerConfig } from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";

export interface CodexCustomProvider {
  id: string;
  label: string;
  extends: string;
}

export interface CodexMcpServerConfig {
  url?: string;
  http_headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  tool_timeout_sec?: number;
}

export function toCodexMcpConfig(config: McpServerConfig): CodexMcpServerConfig {
  switch (config.type) {
    case "stdio":
      return {
        command: config.command,
        args: config.args,
        env: config.env,
      };
    case "http":
    case "sse":
      return {
        url: config.url,
        http_headers: config.headers,
      };
    default: {
      const _exhaustive = config as { type: never };
      throw new Error(`Unsupported MCP config type: ${String(_exhaustive.type)}`);
    }
  }
}

export function buildCodexAppServerInitializeParams(): {
  clientInfo: { name: string; title: string; version: string };
  capabilities: { experimentalApi: true };
} {
  return {
    clientInfo: {
      name: "chisacode",
      title: "ChisaCode",
      version: "0.0.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

function normalizeOpenAICompatibleBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutTrailingSlashes = trimmed.replace(/\/+$/u, "");
  return withoutTrailingSlashes.endsWith("/v1")
    ? withoutTrailingSlashes
    : `${withoutTrailingSlashes}/v1`;
}

function resolveOpenAIWireApi(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): "responses" | "chat" {
  return runtimeSettings?.env?.OPENAI_WIRE_API === "chat" ? "chat" : "responses";
}

export function buildCodexCustomProviderConfig(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  customProvider: CodexCustomProvider | undefined,
): Record<string, unknown> | null {
  if (customProvider?.extends !== "codex") {
    return null;
  }
  const baseUrl = runtimeSettings?.env?.OPENAI_BASE_URL;
  if (typeof baseUrl !== "string") {
    return null;
  }
  const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return null;
  }
  const providerConfig: Record<string, unknown> = {
    name: customProvider.label,
    base_url: normalizedBaseUrl,
    wire_api: resolveOpenAIWireApi(runtimeSettings),
  };
  if (runtimeSettings?.env?.OPENAI_API_KEY?.trim()) {
    providerConfig.env_key = "OPENAI_API_KEY";
    providerConfig.requires_openai_auth = false;
  }
  return {
    model_provider: customProvider.id,
    model_providers: {
      [customProvider.id]: providerConfig,
    },
  };
}

export function buildRuntimeModelIdentityInstructions(
  config: AgentSessionConfig,
  customProvider: CodexCustomProvider | undefined,
): string | null {
  const runtimeProvider = config.runtimeProvider?.trim();
  const customProviderId = customProvider?.id?.trim();
  const provider =
    customProviderId ||
    (runtimeProvider && runtimeProvider !== config.provider ? runtimeProvider : null);
  const model = config.model?.trim();
  if (!provider) {
    return null;
  }

  return [
    "When asked what model or provider you are using, answer from this configured runtime metadata.",
    `Runtime provider: ${provider}.`,
    model ? `Configured model: ${model}.` : null,
    "Do not infer a default vendor/model from the client binary, and do not inspect local config files or run shell commands to answer model-identity questions.",
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}
