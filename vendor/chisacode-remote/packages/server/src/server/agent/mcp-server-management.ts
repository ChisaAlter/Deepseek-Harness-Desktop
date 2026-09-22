import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@chisacode/protocol/provider-manifest";
import type {
  AgentMcpServerPayload,
  AgentMcpServerScopePayload,
  AgentMcpServerStatus,
  AgentMcpServersPolicyPatchRequest,
  ManagedMcpServerConfig,
  McpServerManagementConfig,
  MutableDaemonConfig,
} from "@chisacode/protocol/messages";
import { ManagedMcpServerConfigSchema } from "@chisacode/protocol/messages";
import type { AgentProvider, AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

export const BUILTIN_CHISACODE_MCP_SERVER_NAME = "chisacode";
export const BUILTIN_COMPANION_MCP_SERVER_NAME = "chisacode-companion";

const MCP_PROVIDER_SCOPE_ORDER = ["claude", "codex", "opencode", "pi", "kimi", "grokbuild", "dsh"];
const RESERVED_SERVER_NAMES = new Set([
  BUILTIN_CHISACODE_MCP_SERVER_NAME,
  BUILTIN_COMPANION_MCP_SERVER_NAME,
]);

export interface McpServerListAgent {
  id: string;
  provider?: string | null;
  title?: string | null;
  lastStatus?: string;
}

export interface McpServersListResult {
  scopes: AgentMcpServerScopePayload[];
  servers: AgentMcpServerPayload[];
  errors: string[];
}

export interface EffectiveMcpServersResult {
  daemonMcpEnabled: boolean;
  servers: Record<string, McpServerConfig>;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].filter((value) => value.length > 0).sort(compareStrings);
}

function withoutName(values: readonly string[], name: string): string[] {
  return values.filter((value) => value !== name);
}

function trimName(name: string): string {
  return name.trim();
}

function providerScopeBaseLabel(provider: string | null | undefined): string | null {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    case "kimi":
      return "Kimi Code";
    case "grokbuild":
      return "Grok Build";
    case "dsh":
      return "DeepSeek Harness";
    case "mock":
      return "Mock Load Test";
    case "mock-slow":
      return "Mock Slow Provider";
    default:
      return provider?.trim() || null;
  }
}

function providerScopes(
  agents: readonly McpServerListAgent[],
  config: MutableDaemonConfig,
): AgentMcpServerScopePayload[] {
  const visibleProviders = new Set(AGENT_PROVIDER_DEFINITIONS.map((provider) => provider.id));
  for (const providerId of Object.keys(config.providers ?? {})) visibleProviders.add(providerId);
  for (const providerId of Object.keys(config.mcpServers.providers ?? {})) {
    visibleProviders.add(providerId);
  }
  for (const agent of agents) {
    if (agent.provider) visibleProviders.add(agent.provider);
  }

  const definitions = [
    ...[...AGENT_PROVIDER_DEFINITIONS].sort(
      (a, b) => MCP_PROVIDER_SCOPE_ORDER.indexOf(a.id) - MCP_PROVIDER_SCOPE_ORDER.indexOf(b.id),
    ),
    ...DEV_AGENT_PROVIDER_DEFINITIONS.filter((provider) => visibleProviders.has(provider.id)),
  ];

  const scopes: AgentMcpServerScopePayload[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!visibleProviders.has(definition.id)) continue;
    scopes.push({
      type: "provider",
      provider: definition.id,
      label: providerScopeBaseLabel(definition.id) ?? definition.label,
    });
    seen.add(definition.id);
  }

  for (const provider of [...visibleProviders].sort(compareStrings)) {
    if (seen.has(provider)) continue;
    scopes.push({
      type: "provider",
      provider,
      label: providerScopeBaseLabel(provider) ?? provider,
    });
  }

  return scopes;
}

function isChisaCodeGlobalEnabled(config: MutableDaemonConfig): boolean {
  return (
    config.mcp.injectIntoAgents !== false &&
    !config.mcpServers.global.disabledServerNames.includes(BUILTIN_CHISACODE_MCP_SERVER_NAME)
  );
}

function statusForGlobal(serverName: string, config: MutableDaemonConfig): AgentMcpServerStatus {
  if (serverName === BUILTIN_CHISACODE_MCP_SERVER_NAME) {
    return isChisaCodeGlobalEnabled(config) ? "enabled" : "global-disabled";
  }
  return config.mcpServers.global.disabledServerNames.includes(serverName)
    ? "global-disabled"
    : "enabled";
}

function statusForProvider(
  serverName: string,
  provider: string,
  config: MutableDaemonConfig,
): AgentMcpServerStatus {
  const policy = config.mcpServers.providers[provider];
  if (policy?.disabledServerNames.includes(serverName)) return "provider-disabled";
  if (policy?.enabledServerNames.includes(serverName)) return "provider-enabled";
  return statusForGlobal(serverName, config);
}

function statusForAgent(
  serverName: string,
  agent: McpServerListAgent,
  config: MutableDaemonConfig,
): AgentMcpServerStatus {
  const policy = config.mcpServers.agents[agent.id];
  if (policy?.disabledServerNames.includes(serverName)) return "agent-disabled";
  if (policy?.enabledServerNames.includes(serverName)) return "agent-enabled";
  return agent.provider
    ? statusForProvider(serverName, agent.provider, config)
    : statusForGlobal(serverName, config);
}

function isEnabledStatus(status: AgentMcpServerStatus): boolean {
  return status === "enabled" || status === "provider-enabled" || status === "agent-enabled";
}

function builtinChisaCodeServer(baseUrl: string | null): AgentMcpServerPayload {
  return {
    name: BUILTIN_CHISACODE_MCP_SERVER_NAME,
    label: "ChisaCode 工具",
    description: "系统内置",
    source: "system",
    removable: false,
    editable: false,
    config: {
      type: "http",
      url: baseUrl ?? "internal",
    },
    statusByScope: { global: "enabled", providers: {}, agents: {} },
    errors: [],
  };
}

function userServerPayload(server: ManagedMcpServerConfig): AgentMcpServerPayload {
  return {
    name: server.name,
    label: server.label,
    description: server.description,
    source: "user",
    removable: true,
    editable: true,
    config: server.config,
    statusByScope: { global: "enabled", providers: {}, agents: {} },
    errors: [],
  };
}

export function listManagedMcpServers(
  agents: readonly McpServerListAgent[],
  config: MutableDaemonConfig,
  options: { mcpBaseUrl?: string | null } = {},
): McpServersListResult {
  const scopes = providerScopes(agents, config);
  const servers = [
    builtinChisaCodeServer(options.mcpBaseUrl ?? null),
    ...Object.values(config.mcpServers.servers)
      .sort((a, b) => compareStrings(a.name, b.name))
      .map(userServerPayload),
  ];

  for (const server of servers) {
    server.statusByScope.global = statusForGlobal(server.name, config);
    server.statusByScope.providers = Object.fromEntries(
      scopes
        .filter((scope) => scope.type === "provider")
        .map((scope) => [scope.provider, statusForProvider(server.name, scope.provider, config)]),
    );
    server.statusByScope.agents = Object.fromEntries(
      agents.map((agent) => [agent.id, statusForAgent(server.name, agent, config)]),
    );
  }

  return {
    scopes: [{ type: "global", label: "Global" }, ...scopes],
    servers,
    errors: [],
  };
}

export function normalizeManagedMcpServer(server: ManagedMcpServerConfig): ManagedMcpServerConfig {
  const parsed = ManagedMcpServerConfigSchema.parse({
    ...server,
    name: trimName(server.name),
  });
  if (RESERVED_SERVER_NAMES.has(parsed.name)) {
    throw new Error(`MCP server name is reserved: ${parsed.name}`);
  }
  if (parsed.config.type === "stdio" && parsed.config.command.trim().length === 0) {
    throw new Error("stdio MCP server command is required.");
  }
  if (parsed.config.type === "http" || parsed.config.type === "sse") {
    try {
      const url = new URL(parsed.config.url);
      if (!url.protocol) throw new Error("Missing protocol");
    } catch {
      throw new Error(`${parsed.config.type.toUpperCase()} MCP server URL is invalid.`);
    }
  }
  return parsed;
}

function cleanPolicyNameReferences(
  config: McpServerManagementConfig,
  names: readonly string[],
): McpServerManagementConfig {
  const remove = new Set(names);
  const cleanAgentPolicy = (policy: {
    enabledServerNames: string[];
    disabledServerNames: string[];
  }) => ({
    ...policy,
    enabledServerNames: uniqueSorted(policy.enabledServerNames.filter((name) => !remove.has(name))),
    disabledServerNames: uniqueSorted(
      policy.disabledServerNames.filter((name) => !remove.has(name)),
    ),
  });
  return {
    ...config,
    global: {
      ...config.global,
      disabledServerNames: uniqueSorted(
        config.global.disabledServerNames.filter((name) => !remove.has(name)),
      ),
    },
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([provider, policy]) => [
        provider,
        cleanAgentPolicy(policy),
      ]),
    ),
    agents: Object.fromEntries(
      Object.entries(config.agents).map(([agentId, policy]) => [agentId, cleanAgentPolicy(policy)]),
    ),
  };
}

export function upsertManagedMcpServer(
  current: MutableDaemonConfig,
  server: ManagedMcpServerConfig,
  originalName?: string,
): MutableDaemonConfig {
  const normalized = normalizeManagedMcpServer(server);
  const existingNames = new Set(Object.keys(current.mcpServers.servers));
  const normalizedOriginalName = originalName ? trimName(originalName) : normalized.name;
  if (normalized.name !== normalizedOriginalName && existingNames.has(normalized.name)) {
    throw new Error(`MCP server already exists: ${normalized.name}`);
  }
  if (normalizedOriginalName && RESERVED_SERVER_NAMES.has(normalizedOriginalName)) {
    throw new Error(`MCP server name is reserved: ${normalizedOriginalName}`);
  }
  const timestamp = new Date().toISOString();
  const previous = current.mcpServers.servers[normalizedOriginalName];
  const nextServer: ManagedMcpServerConfig = {
    ...normalized,
    createdAt: previous?.createdAt ?? normalized.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const { [normalizedOriginalName]: _renamed, ...remainingServers } = current.mcpServers.servers;
  const cleaned = cleanPolicyNameReferences(current.mcpServers, [normalizedOriginalName]);
  return {
    ...current,
    mcpServers: {
      ...cleaned,
      servers: {
        ...remainingServers,
        [normalized.name]: nextServer,
      },
    },
  };
}

export function patchManagedMcpServerPolicy(
  current: MutableDaemonConfig,
  scope: AgentMcpServersPolicyPatchRequest["scope"],
  policy: AgentMcpServersPolicyPatchRequest["policy"],
): MutableDaemonConfig {
  const nextMcpServers = {
    ...current.mcpServers,
    global: { ...current.mcpServers.global },
    providers: { ...current.mcpServers.providers },
    agents: { ...current.mcpServers.agents },
    servers: { ...current.mcpServers.servers },
  };
  let nextMcp = current.mcp;

  if (scope.type === "global") {
    const disabledServerNames =
      policy.disabledServerNames ?? nextMcpServers.global.disabledServerNames;
    nextMcpServers.global = {
      ...nextMcpServers.global,
      disabledServerNames: uniqueSorted(disabledServerNames),
    };
    nextMcp = {
      ...current.mcp,
      injectIntoAgents: !disabledServerNames.includes(BUILTIN_CHISACODE_MCP_SERVER_NAME),
    };
  } else if (scope.type === "provider") {
    const existing = nextMcpServers.providers[scope.provider] ?? {
      enabledServerNames: [],
      disabledServerNames: [],
    };
    nextMcpServers.providers[scope.provider] = {
      ...existing,
      enabledServerNames: uniqueSorted(policy.enabledServerNames ?? existing.enabledServerNames),
      disabledServerNames: uniqueSorted(policy.disabledServerNames ?? existing.disabledServerNames),
    };
  } else {
    const existing = nextMcpServers.agents[scope.agentId] ?? {
      enabledServerNames: [],
      disabledServerNames: [],
    };
    nextMcpServers.agents[scope.agentId] = {
      ...existing,
      enabledServerNames: uniqueSorted(policy.enabledServerNames ?? existing.enabledServerNames),
      disabledServerNames: uniqueSorted(policy.disabledServerNames ?? existing.disabledServerNames),
    };
  }

  return {
    ...current,
    mcp: nextMcp,
    mcpServers: nextMcpServers,
  };
}

export function deleteManagedMcpServer(
  current: MutableDaemonConfig,
  name: string,
): MutableDaemonConfig {
  const normalizedName = trimName(name);
  if (RESERVED_SERVER_NAMES.has(normalizedName)) {
    throw new Error(`MCP server is system managed: ${normalizedName}`);
  }
  if (!current.mcpServers.servers[normalizedName]) {
    throw new Error(`MCP server not found: ${normalizedName}`);
  }
  const { [normalizedName]: _removed, ...servers } = current.mcpServers.servers;
  return {
    ...current,
    mcpServers: {
      ...cleanPolicyNameReferences(current.mcpServers, [normalizedName]),
      servers,
    },
  };
}

function isEnabledForAgent(
  serverName: string,
  agentId: string,
  provider: AgentProvider | undefined,
  config: MutableDaemonConfig,
): boolean {
  const agentPolicy = config.mcpServers.agents[agentId];
  if (agentPolicy?.disabledServerNames.includes(serverName)) return false;
  if (agentPolicy?.enabledServerNames.includes(serverName)) return true;
  if (provider) return isEnabledStatus(statusForProvider(serverName, provider, config));
  return isEnabledStatus(statusForGlobal(serverName, config));
}

export function resolveEffectiveManagedMcpServers(
  agentId: string,
  sessionConfig: AgentSessionConfig,
  config: MutableDaemonConfig,
): EffectiveMcpServersResult {
  const provider = sessionConfig.runtimeProvider ?? sessionConfig.provider;
  const servers: Record<string, McpServerConfig> = {};
  for (const server of Object.values(config.mcpServers.servers)) {
    if (isEnabledForAgent(server.name, agentId, provider, config)) {
      servers[server.name] = server.config;
    }
  }
  return {
    daemonMcpEnabled: isEnabledForAgent(
      BUILTIN_CHISACODE_MCP_SERVER_NAME,
      agentId,
      provider,
      config,
    ),
    servers,
  };
}

export function removeServerNameFromPolicyLists(
  policy: { enabledServerNames: string[]; disabledServerNames: string[] },
  serverName: string,
): { enabledServerNames: string[]; disabledServerNames: string[] } {
  return {
    enabledServerNames: withoutName(policy.enabledServerNames, serverName),
    disabledServerNames: withoutName(policy.disabledServerNames, serverName),
  };
}
