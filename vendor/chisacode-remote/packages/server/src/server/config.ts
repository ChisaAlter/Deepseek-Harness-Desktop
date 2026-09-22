import path from "node:path";
import { resolveChisaCodeNodeEnv } from "./chisacode-env.js";
import { z } from "zod/v3";

import type { ChisaCodeDaemonConfig } from "./bootstrap.js";
import {
  loadPersistedConfig,
  LogFormatSchema,
  LogLevelSchema,
  type PersistedConfig,
} from "./persisted-config.js";
import type { AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { AgentProviderSchema } from "@chisacode/protocol/provider-manifest";
import { hashDaemonPassword } from "./auth.js";
import { resolveSpeechConfig } from "./speech/speech-config-resolver.js";
import { mergeHostnames, parseHostnamesEnv, type HostnamesConfig } from "./hostnames.js";

const DEFAULT_PORT = 6767;
const DEFAULT_RELAY_ENDPOINT = "relay.chisacode.sh:443";
const DEFAULT_APP_BASE_URL = "https://app.chisacode.sh";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeLogEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function chisacodeEnv(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`CHISACODE_${suffix}`];
}

export type CliConfigOverrides = Partial<{
  listen: string;
  relayEnabled: boolean;
  relayUseTls: boolean;
  mcpEnabled: boolean;
  mcpInjectIntoAgents: boolean;
  hostnames: HostnamesConfig;
}>;

function resolveLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): PersistedConfig["log"] {
  const envLogLevel = LogLevelSchema.safeParse(normalizeLogEnv(chisacodeEnv(env, "LOG_LEVEL")));
  const envLogFormat = LogFormatSchema.safeParse(normalizeLogEnv(chisacodeEnv(env, "LOG_FORMAT")));

  if (!envLogLevel.success && !envLogFormat.success) {
    return persisted.log;
  }

  return {
    ...persisted.log,
    ...(envLogLevel.success ? { level: envLogLevel.data } : {}),
    ...(envLogFormat.success ? { format: envLogFormat.data } : {}),
  };
}

const OptionalVoiceLlmProviderSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | null =>
    typeof value === "string" ? value.trim().toLowerCase() : null,
  )
  .pipe(z.union([AgentProviderSchema, z.null()]));

function parseOptionalVoiceLlmProvider(value: unknown): AgentProvider | null {
  const parsed = OptionalVoiceLlmProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function extractProviderOverrides(
  providers: Record<string, unknown> | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!providers) {
    return undefined;
  }

  const providerOverrides = Object.entries(providers).flatMap(([providerId, provider]) => {
    const parsed = ProviderOverrideSchema.safeParse(provider);
    return parsed.success ? [[providerId, parsed.data] as const] : [];
  });

  return providerOverrides.length > 0 ? Object.fromEntries(providerOverrides) : undefined;
}

function extractAgentProviderSettings(
  providerOverrides: Record<string, ProviderOverride> | undefined,
): AgentProviderRuntimeSettingsMap | undefined {
  if (!providerOverrides) {
    return undefined;
  }

  const runtimeSettings = Object.entries(providerOverrides).flatMap(([providerId, provider]) => {
    const parsedProviderId = AgentProviderSchema.safeParse(providerId);
    if (!parsedProviderId.success || (!provider.command && !provider.env)) {
      return [];
    }

    return [
      [
        parsedProviderId.data,
        {
          command: provider.command
            ? {
                mode: "replace" as const,
                argv: provider.command,
              }
            : undefined,
          env: provider.env,
        },
      ] as const,
    ];
  });

  return runtimeSettings.length > 0
    ? (Object.fromEntries(runtimeSettings) as AgentProviderRuntimeSettingsMap)
    : undefined;
}

interface ResolveRelayInput {
  env: NodeJS.ProcessEnv;
  persisted: ReturnType<typeof loadPersistedConfig>;
  cliRelayEnabled: boolean | undefined;
  cliRelayUseTls: boolean | undefined;
}

interface ResolvedRelay {
  enabled: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

function resolveTlsFromEnv(
  envValue: string | undefined,
  persistedValue: boolean | undefined,
  fallback: boolean,
): boolean {
  if (envValue !== undefined) {
    return parseBooleanEnv(envValue) ?? false;
  }
  return persistedValue ?? fallback;
}

function resolveRelayConfig(input: ResolveRelayInput): ResolvedRelay {
  const enabled =
    input.cliRelayEnabled ??
    parseBooleanEnv(chisacodeEnv(input.env, "RELAY_ENABLED")) ??
    input.persisted.daemon?.relay?.enabled ??
    true;
  const endpoint =
    chisacodeEnv(input.env, "RELAY_ENDPOINT") ??
    input.persisted.daemon?.relay?.endpoint ??
    DEFAULT_RELAY_ENDPOINT;
  const publicEndpoint =
    chisacodeEnv(input.env, "RELAY_PUBLIC_ENDPOINT") ??
    input.persisted.daemon?.relay?.publicEndpoint ??
    endpoint;
  const useTls =
    input.cliRelayUseTls ??
    resolveTlsFromEnv(
      chisacodeEnv(input.env, "RELAY_USE_TLS"),
      input.persisted.daemon?.relay?.useTls,
      endpoint === DEFAULT_RELAY_ENDPOINT,
    );
  const publicUseTls = resolveTlsFromEnv(
    chisacodeEnv(input.env, "RELAY_PUBLIC_USE_TLS"),
    input.persisted.daemon?.relay?.publicUseTls,
    useTls,
  );
  return { enabled, endpoint, publicEndpoint, useTls, publicUseTls };
}

interface ResolvedVoiceLlm {
  provider: AgentProvider | null;
  providerExplicit: boolean;
  model: string | null;
}

function resolveVoiceLlmConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedVoiceLlm {
  const envVoiceLlmProvider = parseOptionalVoiceLlmProvider(
    chisacodeEnv(env, "VOICE_LLM_PROVIDER"),
  );
  const persistedVoiceLlmProvider = parseOptionalVoiceLlmProvider(
    persisted.features?.voiceMode?.llm?.provider,
  );
  return {
    provider: envVoiceLlmProvider ?? persistedVoiceLlmProvider ?? null,
    providerExplicit: envVoiceLlmProvider !== null || persistedVoiceLlmProvider !== null,
    model: persisted.features?.voiceMode?.llm?.model ?? null,
  };
}

function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string[] {
  const corsOrigins = chisacodeEnv(env, "CORS_ORIGINS");
  const envCorsOrigins = corsOrigins ? corsOrigins.split(",").map((s) => s.trim()) : [];
  const persistedCorsOrigins = persisted.daemon?.cors?.allowedOrigins ?? [];
  return Array.from(
    new Set([...persistedCorsOrigins, ...envCorsOrigins].filter((s) => s.length > 0)),
  );
}

// CHISACODE_LISTEN can be:
// - host:port (TCP)
// - /path/to/socket (Unix socket)
// - unix:///path/to/socket (Unix socket)
// Default is TCP at 127.0.0.1:6767
function resolveListenAddress(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string {
  return (
    cli?.listen ??
    chisacodeEnv(env, "LISTEN") ??
    persisted.daemon?.listen ??
    `127.0.0.1:${env.PORT ?? DEFAULT_PORT}`
  );
}

function resolveAuthConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ChisaCodeDaemonConfig["auth"] {
  const envPassword = chisacodeEnv(env, "PASSWORD")?.trim();
  if (envPassword) {
    return { password: hashDaemonPassword(envPassword) };
  }
  return persisted.daemon?.auth?.password
    ? { password: persisted.daemon.auth.password }
    : undefined;
}

function resolveAppendSystemPrompt(persisted: ReturnType<typeof loadPersistedConfig>): string {
  return persisted.daemon?.appendSystemPrompt ?? "";
}

function resolveMcpServerManagementConfig(persisted: ReturnType<typeof loadPersistedConfig>) {
  return persisted.daemon?.mcpServers;
}

function resolveStaticLoadConfigSettings(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
) {
  return {
    mcpEnabled: cli?.mcpEnabled ?? persisted.daemon?.mcp?.enabled ?? true,
    mcpInjectIntoAgents:
      cli?.mcpInjectIntoAgents ?? persisted.daemon?.mcp?.injectIntoAgents ?? false,
    autoArchiveAfterMerge: persisted.daemon?.autoArchiveAfterMerge ?? false,
    appendSystemPrompt: resolveAppendSystemPrompt(persisted),
    skills: persisted.daemon?.skills,
    mcpServers: resolveMcpServerManagementConfig(persisted),
    hostnames: mergeHostnames([
      persisted.daemon?.hostnames,
      parseHostnamesEnv(chisacodeEnv(env, "HOSTNAMES") ?? env.CHISACODE_ALLOWED_HOSTS),
      cli?.hostnames,
    ]),
    appBaseUrl: chisacodeEnv(env, "APP_BASE_URL") ?? persisted.app?.baseUrl ?? DEFAULT_APP_BASE_URL,
  };
}

export function loadConfig(
  chisacodeHome: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    cli?: CliConfigOverrides;
  },
): ChisaCodeDaemonConfig {
  const env = options?.env ?? process.env;
  const persisted = loadPersistedConfig(chisacodeHome);

  const listen = resolveListenAddress(env, options?.cli, persisted);
  const {
    mcpEnabled,
    mcpInjectIntoAgents,
    autoArchiveAfterMerge,
    appendSystemPrompt,
    skills,
    mcpServers,
    hostnames,
    appBaseUrl,
  } = resolveStaticLoadConfigSettings(env, options?.cli, persisted);

  // Packaged/e2e daemons run with CHISACODE_NODE_ENV=production (the desktop
  // launcher forces it), so the dev-only mock provider is normally unavailable
  // there. Allow deterministic UI gates to opt dev providers in explicitly.
  const enableDevProviders = chisacodeEnv(env, "ENABLE_DEV_PROVIDERS") === "1";

  const relay = resolveRelayConfig({
    env,
    persisted,
    cliRelayEnabled: options?.cli?.relayEnabled,
    cliRelayUseTls: options?.cli?.relayUseTls,
  });

  const { mimo, openai, speech } = resolveSpeechConfig({
    chisacodeHome,
    env,
    persisted,
  });

  const voiceLlm = resolveVoiceLlmConfig(env, persisted);
  const providerOverrides = extractProviderOverrides(
    persisted.agents?.providers as Record<string, unknown> | undefined,
  );

  return {
    listen,
    chisacodeHome,
    corsAllowedOrigins: resolveCorsAllowedOrigins(env, persisted),
    hostnames,
    mcpEnabled,
    mcpInjectIntoAgents,
    autoArchiveAfterMerge,
    appendSystemPrompt,
    skills,
    mcpServers,
    mcpDebug: env.MCP_DEBUG === "1",
    isDev: resolveChisaCodeNodeEnv(env) === "development",
    enableDevProviders,
    agentStoragePath: path.join(chisacodeHome, "agents"),
    staticDir: "public",
    agentClients: {},
    relayEnabled: relay.enabled,
    relayEndpoint: relay.endpoint,
    relayPublicEndpoint: relay.publicEndpoint,
    relayUseTls: relay.useTls,
    relayPublicUseTls: relay.publicUseTls,
    appBaseUrl,
    auth: resolveAuthConfig(env, persisted),
    mimo,
    openai,
    speech,
    voiceLlmProvider: voiceLlm.provider,
    voiceLlmProviderExplicit: voiceLlm.providerExplicit,
    voiceLlmModel: voiceLlm.model,
    agentProviderSettings: extractAgentProviderSettings(providerOverrides),
    metadataGeneration: persisted.agents?.metadataGeneration,
    providerOverrides,
    modelGateways: persisted.agents?.modelGateways,
    visionFallbackModel:
      (persisted.agents as { visionFallbackModel?: { provider: string; modelId: string } | null })
        ?.visionFallbackModel ?? null,
    log: resolveLogConfigFromEnv(env, persisted),
  };
}
