import type { Logger } from "pino";

import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentProvider,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;
type PermissionRequestedEvent = Extract<AgentStreamEvent, { type: "permission_requested" }>;
type PermissionResolvedEvent = Extract<AgentStreamEvent, { type: "permission_resolved" }>;

interface AgentPermissionControllerOptions {
  broadcastAttention(agent: ManagedAgent): void;
  dispatchStream(agentId: string, event: AgentStreamEvent, metadata?: { timestamp?: string }): void;
  emitState(agent: ManagedAgent): void;
  getAgent(agentId: string): ActiveManagedAgent;
  getSessionEventTail(agentId: string): Promise<void> | undefined;
  logger: Logger;
  persistSnapshot(agent: ManagedAgent): Promise<void>;
  refreshSessionState(agent: ActiveManagedAgent): Promise<void>;
  touchUpdatedAt(agent: ManagedAgent): Date;
}

/** Owns manager-level permission requests, response races, and terminal cleanup. */
export class AgentPermissionController {
  constructor(private readonly options: AgentPermissionControllerOptions) {}

  async respond(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const agent = this.options.getAgent(agentId);
    agent.inFlightPermissionResponses.add(requestId);

    try {
      const result = await agent.session.respondToPermission(requestId, response);
      await this.options.getSessionEventTail(agent.id)?.catch(() => undefined);
      agent.pendingPermissions.delete(requestId);

      try {
        await this.options.refreshSessionState(agent);
      } catch (error) {
        this.options.logger.debug(
          { err: error, agentId: agent.id },
          "Failed to refresh state after permission response",
        );
      }

      this.options.touchUpdatedAt(agent);
      await this.options.persistSnapshot(agent);
      this.options.emitState(agent);

      const bufferedResolution = agent.bufferedPermissionResolutions.get(requestId);
      if (bufferedResolution) {
        agent.bufferedPermissionResolutions.delete(requestId);
        this.options.dispatchStream(agent.id, bufferedResolution, {
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } finally {
      agent.inFlightPermissionResponses.delete(requestId);
      agent.bufferedPermissionResolutions.delete(requestId);
    }
  }

  list(agentId: string): AgentPermissionRequest[] {
    return Array.from(this.options.getAgent(agentId).pendingPermissions.values());
  }

  refreshFromSession(agent: ActiveManagedAgent): void {
    try {
      const pending = agent.session.getPendingPermissions();
      agent.pendingPermissions = new Map(pending.map((request) => [request.id, request]));
    } catch (error) {
      this.options.logger.debug(
        { err: error, agentId: agent.id },
        "Failed to refresh pending permissions",
      );
      agent.pendingPermissions.clear();
    }
  }

  onRequested(agent: ActiveManagedAgent, event: PermissionRequestedEvent): void {
    const hadPendingPermissions = agent.pendingPermissions.size > 0;
    agent.pendingPermissions.set(event.request.id, event.request);
    if (!hadPendingPermissions && !agent.internal) {
      this.options.broadcastAttention(agent);
    }
    this.options.emitState(agent);
  }

  onResolved(
    agent: ActiveManagedAgent,
    event: PermissionResolvedEvent,
    options?: { fromHistory?: boolean },
  ): boolean {
    agent.pendingPermissions.delete(event.requestId);
    if (!options?.fromHistory && agent.inFlightPermissionResponses.has(event.requestId)) {
      agent.bufferedPermissionResolutions.set(event.requestId, event);
      return false;
    }
    this.options.emitState(agent);
    return true;
  }

  resolvePending(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    options: { fromHistory?: boolean } | undefined,
    message: string,
  ): void {
    this.denyPending(agent, provider, message, options?.fromHistory === true, false);
  }

  clearAfterInterrupt(agent: ActiveManagedAgent): void {
    if (agent.pendingPermissions.size === 0) {
      return;
    }

    this.denyPending(agent, agent.provider, "Interrupted", false, true);
    this.options.touchUpdatedAt(agent);
    this.options.emitState(agent);
  }

  private denyPending(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    message: string,
    fromHistory: boolean,
    includeTimestamp: boolean,
  ): void {
    for (const [requestId] of agent.pendingPermissions) {
      agent.pendingPermissions.delete(requestId);
      if (fromHistory) {
        continue;
      }
      this.options.dispatchStream(
        agent.id,
        {
          type: "permission_resolved",
          provider,
          requestId,
          resolution: { behavior: "deny", message },
        },
        includeTimestamp ? { timestamp: new Date().toISOString() } : undefined,
      );
    }
  }
}
