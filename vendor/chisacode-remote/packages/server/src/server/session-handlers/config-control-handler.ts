/**
 * ConfigControlHandler — extracted from Session.
 *
 * Handles daemon config, project config, skills, MCP servers, commands list,
 * push token registration, restart, and shutdown.
 */

import { getErrorMessage } from "@chisacode/protocol/error-utils";

import { expandTilde } from "../../utils/path.js";
import { getPidLockInfo } from "../pid-lock.js";
import { generateLocalPairingOffer } from "../pairing-offer.js";
import {
  installUserSkillsFromGitHub,
  installUserSkillsFromLocalDirectory,
  listManagedSkills,
  uninstallUserInstalledSkills,
} from "../agent/skills-management.js";
import {
  deleteManagedMcpServer,
  listManagedMcpServers,
  patchManagedMcpServerPolicy,
  upsertManagedMcpServer,
} from "../agent/mcp-server-management.js";
import {
  readChisaCodeConfigForEdit,
  writeChisaCodeConfigForEdit,
  type ProjectConfigRpcError,
} from "../../utils/chisacode-config-file.js";
import type { ConfigControlHandlerContext, DisposableHandler } from "./session-context.js";
import type {
  SessionInboundMessage,
  AgentSkillsPolicyPatchRequest,
  AgentSkillsInstallRequest,
  AgentSkillsUninstallRequest,
  AgentMcpServersUpsertRequest,
  AgentMcpServersPolicyPatchRequest,
  AgentMcpServersDeleteRequest,
} from "../messages.js";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";

/** Handles daemon/project config, skills, MCP servers, restart, shutdown, and push token RPC operations. */
export class ConfigControlHandler implements DisposableHandler {
  private readonly context: ConfigControlHandlerContext;

  constructor(context: ConfigControlHandlerContext) {
    this.context = context;
  }

  dispose(): void {
    // No subscriptions to clean up
  }

  /** Dispatch config/control messages to the appropriate handler. Returns undefined for unhandled messages. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      // --- From dispatchMiscMessage ---
      case "list_commands_request":
        return this.handleListCommandsRequest(msg);
      case "agent.skills.list.request":
        return this.handleAgentSkillsListRequest(msg.requestId);
      case "agent.skills.policy.patch.request":
        return this.handleAgentSkillsPolicyPatchRequest(msg);
      case "agent.skills.install.request":
        return this.handleAgentSkillsInstallRequest(msg);
      case "agent.skills.uninstall.request":
        return this.handleAgentSkillsUninstallRequest(msg);
      case "agent.mcp_servers.list.request":
        return this.handleAgentMcpServersListRequest(msg.requestId);
      case "agent.mcp_servers.upsert.request":
        return this.handleAgentMcpServersUpsertRequest(msg);
      case "agent.mcp_servers.policy.patch.request":
        return this.handleAgentMcpServersPolicyPatchRequest(msg);
      case "agent.mcp_servers.delete.request":
        return this.handleAgentMcpServersDeleteRequest(msg);
      case "register_push_token":
        this.handleRegisterPushToken(msg.token);
        return undefined;

      // --- From dispatchAgentConfigMessage (config cases) ---
      case "get_daemon_config_request":
        this.context.emit({
          type: "get_daemon_config_response",
          payload: { requestId: msg.requestId, config: this.context.daemonConfigStore.get() },
        });
        return undefined;
      case "daemon.get_status.request":
        return this.handleDaemonGetStatusRequest(msg);
      case "daemon.get_pairing_offer.request":
        return this.handleDaemonGetPairingOfferRequest(msg);
      case "set_daemon_config_request":
        this.context.emit({
          type: "set_daemon_config_response",
          payload: {
            requestId: msg.requestId,
            config: this.context.daemonConfigStore.patch(msg.config),
          },
        });
        return undefined;
      case "read_project_config_request":
        return this.handleReadProjectConfigRequest(msg);
      case "write_project_config_request":
        return this.handleWriteProjectConfigRequest(msg);

      // --- Restart / Shutdown ---
      case "restart_server_request":
        return this.handleRestartServerRequest(msg.requestId, msg.reason);
      case "shutdown_server_request":
        return this.handleShutdownServerRequest(msg.requestId);

      default:
        return undefined;
    }
  }

  // --- Daemon config ---

  private async handleDaemonGetStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_status.request" }>,
  ): Promise<void> {
    try {
      const pidInfo = await getPidLockInfo(this.context.chisacodeHome);
      const providers = (await this.context.agentManager.listProviderAvailability()).map((p) => ({
        provider: p.provider,
        available: p.available,
        error: p.error ?? null,
      }));
      this.context.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.context.serverId ?? "",
          version: this.context.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: pidInfo?.startedAt ?? null,
          listen: this.context.daemonRuntimeConfig?.listen ?? null,
          relay: this.context.daemonRuntimeConfig?.relay ?? null,
          providers,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error({ err: error }, "Failed to handle daemon status request");
      this.context.emit({
        type: "daemon.get_status.response",
        payload: {
          requestId: msg.requestId,
          serverId: this.context.serverId ?? "",
          version: this.context.daemonVersion ?? null,
          pid: process.pid,
          nodePath: process.execPath,
          startedAt: null,
          listen: null,
          relay: null,
          providers: [],
        },
      });
    }
  }

  private async handleDaemonGetPairingOfferRequest(
    msg: Extract<SessionInboundMessage, { type: "daemon.get_pairing_offer.request" }>,
  ): Promise<void> {
    try {
      const relay = this.context.daemonRuntimeConfig?.relay;
      const pairing = await generateLocalPairingOffer({
        chisacodeHome: this.context.chisacodeHome,
        relayEnabled: relay?.enabled ?? true,
        relayEndpoint: relay?.endpoint,
        relayPublicEndpoint: relay?.publicEndpoint,
        relayUseTls: relay?.useTls,
        relayPublicUseTls: relay?.publicUseTls,
        includeQr: true,
        logger: this.context.sessionLogger,
      });
      this.context.emit({
        type: "daemon.get_pairing_offer.response",
        payload: {
          requestId: msg.requestId,
          url: pairing.url ?? "",
          qr: pairing.qr ?? null,
          relayEnabled: pairing.relayEnabled,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error },
        "Failed to handle daemon pairing offer request",
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: "daemon.get_pairing_offer.request",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // --- Project config ---

  private async handleReadProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.context.resolveKnownProjectRootForConfig(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigReadFailure(msg, { code: "project_not_found" });
      return;
    }

    const result = readChisaCodeConfigForEdit(repoRoot);
    if (!result.ok) {
      this.context.sessionLogger.warn(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Failed to read project config",
      );
      this.emitProjectConfigReadFailure(msg, result.error, repoRoot);
      return;
    }

    if (result.config === null) {
      this.context.sessionLogger.debug(
        { repoRoot, requestId: msg.requestId, outcome: "missing_project_config" },
        "Project config missing",
      );
    }

    this.context.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
      },
    });
  }

  private async handleWriteProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.context.resolveKnownProjectRootForConfig(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigWriteFailure(msg, { code: "project_not_found" });
      return;
    }

    this.context.sessionLogger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "write_attempt" },
      "Writing project config",
    );
    const result = writeChisaCodeConfigForEdit({
      repoRoot,
      config: msg.config,
      expectedRevision: msg.expectedRevision,
    });
    if (!result.ok) {
      this.context.sessionLogger.debug(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Project config write did not complete",
      );
      this.emitProjectConfigWriteFailure(msg, result.error, repoRoot);
      return;
    }

    this.context.sessionLogger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "written" },
      "Project config written",
    );
    this.context.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
      },
    });
  }

  private emitProjectConfigReadFailure(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.context.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private emitProjectConfigWriteFailure(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.context.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  // --- Restart / Shutdown ---

  private async handleRestartServerRequest(requestId: string, reason?: string): Promise<void> {
    const payload: { status: string } & Record<string, unknown> = {
      status: "restart_requested",
      clientId: this.context.clientId,
    };
    if (reason && reason.trim().length > 0) {
      payload.reason = reason;
    }
    payload.requestId = requestId;

    this.context.sessionLogger.warn({ reason }, "Restart requested via websocket");
    this.context.emit({
      type: "status",
      payload,
    });

    this.context.emitLifecycleIntent({
      type: "restart",
      clientId: this.context.clientId,
      requestId,
      ...(reason ? { reason } : {}),
    });
  }

  private async handleShutdownServerRequest(requestId: string): Promise<void> {
    this.context.sessionLogger.warn("Shutdown requested via websocket");
    this.context.emit({
      type: "status",
      payload: {
        status: "shutdown_requested",
        clientId: this.context.clientId,
        requestId,
      },
    });

    this.context.emitLifecycleIntent({
      type: "shutdown",
      clientId: this.context.clientId,
      requestId,
    });
  }

  // --- Push token ---

  private handleRegisterPushToken(token: string): void {
    this.context.pushTokenStore.addToken(token);
    this.context.sessionLogger.info("Registered push token");
  }

  // --- Skills ---

  private async handleAgentSkillsListRequest(requestId: string): Promise<void> {
    try {
      const config = this.context.daemonConfigStore.get();
      const agents = this.context.agentManager
        .listAgents()
        .filter((agent) => !agent.internal)
        .map((agent) => ({
          id: agent.id,
          provider: agent.config.provider,
          title: agent.config.title ?? null,
          lastStatus: agent.lifecycle,
          session: agent.session,
        }));
      const result = await listManagedSkills(agents, config);
      this.context.emit({
        type: "agent.skills.list.response",
        payload: {
          requestId,
          scopes: result.scopes,
          skills: result.skills,
          policy: config.skills,
          errors: result.errors,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.skills.list.response",
        payload: {
          requestId,
          scopes: [{ type: "global", label: "Global" }],
          skills: [],
          policy: this.context.daemonConfigStore.get().skills,
          errors: [getErrorMessage(error)],
        },
      });
    }
  }

  private async handleAgentSkillsPolicyPatchRequest(
    msg: AgentSkillsPolicyPatchRequest,
  ): Promise<void> {
    try {
      const current = this.context.daemonConfigStore.get();
      const nextSkills = {
        ...current.skills,
        global: { ...current.skills.global },
        providers: { ...current.skills.providers },
        agents: { ...current.skills.agents },
        installedSources: { ...current.skills.installedSources },
      };

      if (msg.scope.type === "global") {
        nextSkills.global = {
          ...nextSkills.global,
          disabledSkillNames: msg.policy.disabledSkillNames ?? nextSkills.global.disabledSkillNames,
        };
      } else if (msg.scope.type === "provider") {
        const existing = nextSkills.providers[msg.scope.provider] ?? {
          enabledSkillNames: [],
          disabledSkillNames: [],
        };
        nextSkills.providers[msg.scope.provider] = {
          ...existing,
          enabledSkillNames: msg.policy.enabledSkillNames ?? existing.enabledSkillNames,
          disabledSkillNames: msg.policy.disabledSkillNames ?? existing.disabledSkillNames,
        };
      } else {
        const existing = nextSkills.agents[msg.scope.agentId] ?? {
          enabledSkillNames: [],
          disabledSkillNames: [],
        };
        nextSkills.agents[msg.scope.agentId] = {
          ...existing,
          enabledSkillNames: msg.policy.enabledSkillNames ?? existing.enabledSkillNames,
          disabledSkillNames: msg.policy.disabledSkillNames ?? existing.disabledSkillNames,
        };
      }

      const next = this.context.daemonConfigStore.replace({ ...current, skills: nextSkills });
      this.context.emit({
        type: "agent.skills.policy.patch.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          policy: next.skills,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.skills.policy.patch.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          policy: this.context.daemonConfigStore.get().skills,
          error: getErrorMessage(error),
        },
      });
    }
  }

  private async handleAgentSkillsInstallRequest(msg: AgentSkillsInstallRequest): Promise<void> {
    try {
      const result =
        msg.source.type === "github"
          ? await installUserSkillsFromGitHub(msg.source.value, { replace: msg.replace })
          : await installUserSkillsFromLocalDirectory(expandTilde(msg.source.path), {
              replace: msg.replace,
            });
      const current = this.context.daemonConfigStore.get();
      const next = this.context.daemonConfigStore.replace({
        ...current,
        skills: {
          ...current.skills,
          installedSources: {
            ...current.skills.installedSources,
            [result.installedSource.id]: result.installedSource,
          },
        },
      });
      this.context.emit({
        type: "agent.skills.install.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          installedSource: next.skills.installedSources[result.installedSource.id] ?? null,
          skills: result.skillNames,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.skills.install.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          installedSource: null,
          skills: [],
          error: getErrorMessage(error),
        },
      });
    }
  }

  private async handleAgentSkillsUninstallRequest(msg: AgentSkillsUninstallRequest): Promise<void> {
    try {
      const current = this.context.daemonConfigStore.get();
      const source = current.skills.installedSources[msg.sourceId];
      if (!source) {
        throw new Error(`Installed skill source not found: ${msg.sourceId}`);
      }
      const removedSkillNames = await uninstallUserInstalledSkills(source.skillNames);
      const { [msg.sourceId]: _removed, ...installedSources } = current.skills.installedSources;
      const next = this.context.daemonConfigStore.replace({
        ...current,
        skills: {
          ...current.skills,
          installedSources,
        },
      });
      this.context.emit({
        type: "agent.skills.uninstall.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          removedSkillNames,
          policy: next.skills,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.skills.uninstall.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          removedSkillNames: [],
          policy: this.context.daemonConfigStore.get().skills,
          error: getErrorMessage(error),
        },
      });
    }
  }

  // --- MCP Servers ---

  private async handleAgentMcpServersListRequest(requestId: string): Promise<void> {
    try {
      const config = this.context.daemonConfigStore.get();
      const agents = this.context.agentManager
        .listAgents()
        .filter((agent) => !agent.internal)
        .map((agent) => ({
          id: agent.id,
          provider: agent.config.provider,
          title: agent.config.title ?? null,
          lastStatus: agent.lifecycle,
        }));
      const result = listManagedMcpServers(agents, config, {
        mcpBaseUrl: this.context.mcpBaseUrl,
      });
      this.context.emit({
        type: "agent.mcp_servers.list.response",
        payload: {
          requestId,
          scopes: result.scopes,
          servers: result.servers,
          policy: config.mcpServers,
          errors: result.errors,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.mcp_servers.list.response",
        payload: {
          requestId,
          scopes: [{ type: "global", label: "Global" }],
          servers: [],
          policy: this.context.daemonConfigStore.get().mcpServers,
          errors: [getErrorMessage(error)],
        },
      });
    }
  }

  private async handleAgentMcpServersUpsertRequest(
    msg: AgentMcpServersUpsertRequest,
  ): Promise<void> {
    try {
      const current = this.context.daemonConfigStore.get();
      const next = this.context.daemonConfigStore.replace(
        upsertManagedMcpServer(current, msg.server, msg.originalName),
      );
      const savedServer =
        next.mcpServers.servers[msg.server.name.trim()] ??
        Object.values(next.mcpServers.servers).find(
          (server) => server.name === msg.server.name.trim(),
        ) ??
        null;
      this.context.emit({
        type: "agent.mcp_servers.upsert.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          server: savedServer,
          policy: next.mcpServers,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.mcp_servers.upsert.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          server: null,
          policy: this.context.daemonConfigStore.get().mcpServers,
          error: getErrorMessage(error),
        },
      });
    }
  }

  private async handleAgentMcpServersPolicyPatchRequest(
    msg: AgentMcpServersPolicyPatchRequest,
  ): Promise<void> {
    try {
      const current = this.context.daemonConfigStore.get();
      const next = this.context.daemonConfigStore.replace(
        patchManagedMcpServerPolicy(current, msg.scope, msg.policy),
      );
      this.context.emit({
        type: "agent.mcp_servers.policy.patch.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          policy: next.mcpServers,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.mcp_servers.policy.patch.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          policy: this.context.daemonConfigStore.get().mcpServers,
          error: getErrorMessage(error),
        },
      });
    }
  }

  private async handleAgentMcpServersDeleteRequest(
    msg: AgentMcpServersDeleteRequest,
  ): Promise<void> {
    try {
      const current = this.context.daemonConfigStore.get();
      const next = this.context.daemonConfigStore.replace(
        deleteManagedMcpServer(current, msg.name),
      );
      this.context.emit({
        type: "agent.mcp_servers.delete.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          removedServerName: msg.name,
          policy: next.mcpServers,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.mcp_servers.delete.response",
        payload: {
          requestId: msg.requestId,
          ok: false,
          removedServerName: null,
          policy: this.context.daemonConfigStore.get().mcpServers,
          error: getErrorMessage(error),
        },
      });
    }
  }

  // --- List commands ---

  private async handleListCommandsRequest(
    msg: Extract<SessionInboundMessage, { type: "list_commands_request" }>,
  ): Promise<void> {
    const { agentId, requestId, draftConfig } = msg;
    this.context.sessionLogger.debug(
      { agentId, draftConfig },
      `Handling list commands request for agent ${agentId}`,
    );

    try {
      const agents = this.context.agentManager.listAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (agent?.session?.listCommands) {
        const commands = await agent.session.listCommands();
        this.context.emit({
          type: "list_commands_response",
          payload: {
            agentId,
            commands,
            error: null,
            requestId,
          },
        });
        return;
      }

      if (!agent && draftConfig) {
        const sessionConfig: AgentSessionConfig = {
          provider: draftConfig.provider,
          cwd: expandTilde(draftConfig.cwd),
          ...(draftConfig.modeId ? { modeId: draftConfig.modeId } : {}),
          ...(draftConfig.model ? { model: draftConfig.model } : {}),
          ...(draftConfig.thinkingOptionId
            ? { thinkingOptionId: draftConfig.thinkingOptionId }
            : {}),
        };

        const commands = await this.context.agentManager.listDraftCommands(sessionConfig);
        this.context.emit({
          type: "list_commands_response",
          payload: {
            agentId,
            commands,
            error: null,
            requestId,
          },
        });
        return;
      }

      this.context.emit({
        type: "list_commands_response",
        payload: {
          agentId,
          commands: [],
          error: agent ? `Agent does not support listing commands` : `Agent not found: ${agentId}`,
          requestId,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, draftConfig },
        "Failed to list commands",
      );
      this.context.emit({
        type: "list_commands_response",
        payload: {
          agentId,
          commands: [],
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }
}
