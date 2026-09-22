import type {
  AgentMcpServerManagementScope,
  AgentSkillManagementScope,
  ManagedMcpServerConfig,
  SessionInboundMessage,
} from "@chisacode/protocol/messages";
import type { AgentSessionConfig } from "@chisacode/protocol/agent-types";
import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

type AgentSkillsInstallSource = Extract<
  SessionInboundMessage,
  { type: "agent.skills.install.request" }
>["source"];
type ListCommandsDraftConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId" | "featureValues"
>;

/** Implements agent command discovery plus skills and MCP server management RPCs. */
export class AgentExtensionCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  listCommands(
    agentId: string,
    requestIdOrOptions?: string | { requestId?: string; draftConfig?: ListCommandsDraftConfig },
  ): Promise<DaemonCommandResponsePayload<"list_commands_response">> {
    const requestId =
      typeof requestIdOrOptions === "string" ? requestIdOrOptions : requestIdOrOptions?.requestId;
    const draftConfig =
      typeof requestIdOrOptions === "string" ? undefined : requestIdOrOptions?.draftConfig;

    return this.transport.request({
      requestId,
      message: {
        type: "list_commands_request",
        agentId,
        ...(draftConfig ? { draftConfig } : {}),
      },
      responseType: "list_commands_response",
      timeout: 30000,
    });
  }

  listAgentSkills(options?: {
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"agent.skills.list.response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.skills.list.request" },
      responseType: "agent.skills.list.response",
      timeout: 30000,
    });
  }

  patchAgentSkillPolicy(input: {
    requestId?: string;
    scope: AgentSkillManagementScope;
    policy: { enabledSkillNames?: string[]; disabledSkillNames?: string[] };
  }): Promise<DaemonCommandResponsePayload<"agent.skills.policy.patch.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.skills.policy.patch.request",
        scope: input.scope,
        policy: input.policy,
      },
      responseType: "agent.skills.policy.patch.response",
      timeout: 30000,
    });
  }

  installAgentSkills(input: {
    requestId?: string;
    source: AgentSkillsInstallSource;
    replace?: boolean;
  }): Promise<DaemonCommandResponsePayload<"agent.skills.install.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.skills.install.request",
        source: input.source,
        ...(input.replace !== undefined ? { replace: input.replace } : {}),
      },
      responseType: "agent.skills.install.response",
      timeout: 120000,
    });
  }

  uninstallAgentSkill(input: {
    requestId?: string;
    sourceId: string;
  }): Promise<DaemonCommandResponsePayload<"agent.skills.uninstall.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "agent.skills.uninstall.request", sourceId: input.sourceId },
      responseType: "agent.skills.uninstall.response",
      timeout: 30000,
    });
  }

  listAgentMcpServers(options?: {
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"agent.mcp_servers.list.response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.mcp_servers.list.request" },
      responseType: "agent.mcp_servers.list.response",
      timeout: 30000,
    });
  }

  upsertAgentMcpServer(input: {
    requestId?: string;
    server: ManagedMcpServerConfig;
    originalName?: string;
  }): Promise<DaemonCommandResponsePayload<"agent.mcp_servers.upsert.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.mcp_servers.upsert.request",
        server: input.server,
        ...(input.originalName ? { originalName: input.originalName } : {}),
      },
      responseType: "agent.mcp_servers.upsert.response",
      timeout: 30000,
    });
  }

  patchAgentMcpServerPolicy(input: {
    requestId?: string;
    scope: AgentMcpServerManagementScope;
    policy: { enabledServerNames?: string[]; disabledServerNames?: string[] };
  }): Promise<DaemonCommandResponsePayload<"agent.mcp_servers.policy.patch.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.mcp_servers.policy.patch.request",
        scope: input.scope,
        policy: input.policy,
      },
      responseType: "agent.mcp_servers.policy.patch.response",
      timeout: 30000,
    });
  }

  deleteAgentMcpServer(input: {
    requestId?: string;
    name: string;
  }): Promise<DaemonCommandResponsePayload<"agent.mcp_servers.delete.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "agent.mcp_servers.delete.request", name: input.name },
      responseType: "agent.mcp_servers.delete.response",
      timeout: 30000,
    });
  }
}
