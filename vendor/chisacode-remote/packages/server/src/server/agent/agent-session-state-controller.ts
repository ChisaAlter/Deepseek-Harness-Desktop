import type { Logger } from "pino";

import type { AgentPersistenceHandle, AgentStreamEvent } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentPermissionController } from "./agent-permission-controller.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface AgentSessionStateControllerOptions {
  attachPersistenceCwd(
    handle: AgentPersistenceHandle | null,
    cwd: string,
  ): AgentPersistenceHandle | null;
  emitState(agent: ManagedAgent): void;
  logger: Logger;
  permissions: AgentPermissionController;
}

/** Owns provider session state refresh and runtime/config event projection. */
export class AgentSessionStateController {
  constructor(private readonly options: AgentSessionStateControllerOptions) {}

  async refresh(agent: ActiveManagedAgent): Promise<void> {
    try {
      agent.availableModes = await agent.session.getAvailableModes();
    } catch (error) {
      this.options.logger.debug(
        { err: error, agentId: agent.id },
        "Failed to refresh available modes",
      );
      agent.availableModes = [];
    }

    try {
      agent.currentModeId = await agent.session.getCurrentMode();
    } catch (error) {
      this.options.logger.debug(
        { err: error, agentId: agent.id },
        "Failed to refresh current mode",
      );
      agent.currentModeId = null;
    }

    this.options.permissions.refreshFromSession(agent);
    this.syncFeatures(agent);
    await this.refreshRuntimeInfo(agent);
  }

  async refreshRuntimeInfo(agent: ActiveManagedAgent): Promise<void> {
    try {
      const newInfo = await agent.session.getRuntimeInfo();
      const changed =
        newInfo.model !== agent.runtimeInfo?.model ||
        newInfo.thinkingOptionId !== agent.runtimeInfo?.thinkingOptionId ||
        newInfo.sessionId !== agent.runtimeInfo?.sessionId ||
        newInfo.modeId !== agent.runtimeInfo?.modeId;
      agent.runtimeInfo = newInfo;
      if (!agent.persistence && newInfo.sessionId) {
        agent.persistence = this.options.attachPersistenceCwd(
          { provider: newInfo.provider, sessionId: newInfo.sessionId },
          agent.cwd,
        );
      }
      if (changed) {
        this.options.emitState(agent);
      }
    } catch (error) {
      this.options.logger.debug(
        { err: error, agentId: agent.id },
        "Failed to refresh runtime info",
      );
    }
  }

  syncFeatures(agent: ManagedAgent): void {
    if (agent.session?.features) {
      agent.features = agent.session.features;
    }
  }

  onThreadStarted(agent: ActiveManagedAgent): void {
    const previousSessionId = agent.persistence?.sessionId ?? null;
    const handle = agent.session.describePersistence();
    if (handle) {
      agent.persistence = this.options.attachPersistenceCwd(handle, agent.cwd);
      if (agent.persistence?.sessionId !== previousSessionId) {
        this.options.emitState(agent);
      }
    }
    void this.refreshRuntimeInfo(agent);
  }

  onUsageUpdated(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "usage_updated" }>,
  ): void {
    agent.lastUsage = event.usage;
    this.options.emitState(agent);
  }

  onModeChanged(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "mode_changed" }>,
  ): void {
    agent.currentModeId = event.currentModeId;
    agent.availableModes = event.availableModes;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, modeId: event.currentModeId };
    }
    this.options.emitState(agent);
  }

  onModelChanged(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "model_changed" }>,
  ): void {
    agent.runtimeInfo = event.runtimeInfo;
    if (!agent.persistence && event.runtimeInfo.sessionId) {
      agent.persistence = this.options.attachPersistenceCwd(
        { provider: event.runtimeInfo.provider, sessionId: event.runtimeInfo.sessionId },
        agent.cwd,
      );
    }
    agent.currentModeId = event.runtimeInfo.modeId ?? agent.currentModeId;
    this.options.emitState(agent);
  }

  onThinkingOptionChanged(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "thinking_option_changed" }>,
  ): void {
    if (agent.runtimeInfo) {
      agent.runtimeInfo = {
        ...agent.runtimeInfo,
        thinkingOptionId: event.thinkingOptionId,
      };
    }
    this.options.emitState(agent);
  }
}
