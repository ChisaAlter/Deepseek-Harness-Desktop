import type { AgentRelation } from "@chisacode/protocol/agent-labels";

import type {
  AgentPermissionRequest,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
} from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentTitleSource } from "./agent-storage.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import type { ForegroundTurnWaiter } from "./foreground-run-state.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;
type AgentAttentionState = ManagedAgent["attention"];

export interface RegisterAgentSessionOptions {
  workspaceId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  lastUserMessageAt?: Date | null;
  labels?: Record<string, string>;
  relation?: AgentRelation;
  timeline?: AgentTimelineItem[];
  timelineRows?: AgentTimelineRow[];
  timelineNextSeq?: number;
  historyPrimed?: boolean;
  lastUsage?: AgentUsage;
  lastError?: string;
  attention?: AgentAttentionState;
  initialTitle?: string | null;
}

interface AgentSessionRegistrationControllerOptions {
  addAgent(agent: ActiveManagedAgent): void;
  attachPersistenceCwd(
    handle: AgentPersistenceHandle | null,
    cwd: string,
  ): AgentPersistenceHandle | null;
  beginInitialSnapshotPersist(agentId: string): void;
  emitState(agent: ManagedAgent, options?: { persist?: boolean }): void;
  endInitialSnapshotPersist(agentId: string): void;
  enqueueSessionEvent(agentId: string, event: AgentStreamEvent): void;
  hasAgent(agentId: string): boolean;
  persistSnapshot(
    agent: ManagedAgent,
    options?: {
      workspaceId?: string;
      title?: string | null;
      titleSource?: StoredAgentTitleSource;
    },
  ): Promise<void>;
  recordInitialStatus(agentId: string, lifecycle: ManagedAgent["lifecycle"]): void;
  refreshRuntimeInfo(agent: ActiveManagedAgent): Promise<void>;
  refreshSessionState(agent: ActiveManagedAgent): Promise<void>;
  registry?: AgentStorage;
  resolveInitialAttention(input: AgentAttentionState | undefined): AgentAttentionState;
  timeline: AgentTimelineController;
  validateAgentId(agentId: string, source: string): string;
}

/** Owns active agent construction, initial persistence, and session event subscription. */
export class AgentSessionRegistrationController {
  constructor(private readonly options: AgentSessionRegistrationControllerOptions) {}

  async register(
    session: AgentSession,
    config: AgentSessionConfig,
    agentId: string,
    options?: RegisterAgentSessionOptions,
  ): Promise<ManagedAgent> {
    const resolvedAgentId = this.options.validateAgentId(agentId, "registerSession");
    if (this.options.hasAgent(resolvedAgentId)) {
      throw new Error(`Agent with id ${resolvedAgentId} already exists`);
    }
    const initialPersistedTitle = await this.resolveInitialPersistedTitle(
      resolvedAgentId,
      config,
      options?.initialTitle ?? null,
    );

    const now = new Date();
    const { durableTimelineHasRows } = await this.options.timeline.initializeForAgent({
      agentId: resolvedAgentId,
      now,
      options,
    });
    const managed = this.buildManagedAgent({
      resolvedAgentId,
      session,
      config,
      now,
      durableTimelineHasRows,
      options,
    });

    const sessionConnected = session.isConnected?.() ?? true;

    this.options.beginInitialSnapshotPersist(resolvedAgentId);
    try {
      this.options.addAgent(managed);
      this.options.recordInitialStatus(resolvedAgentId, managed.lifecycle);
      // Skip runtime refresh for deferred-connect sessions so registration does
      // not force a provider process spawn before the first turn.
      if (sessionConnected) {
        await this.options.refreshRuntimeInfo(managed);
      }
      await this.options.persistSnapshot(managed, {
        workspaceId: options?.workspaceId,
        title: initialPersistedTitle.title,
        titleSource: initialPersistedTitle.titleSource,
      });
    } finally {
      this.options.endInitialSnapshotPersist(resolvedAgentId);
    }
    this.options.emitState(managed, { persist: false });

    if (sessionConnected) {
      await this.options.refreshSessionState(managed);
    }
    (managed as ActiveManagedAgent).lifecycle = "idle";
    await this.options.persistSnapshot(managed, { workspaceId: options?.workspaceId });
    this.options.emitState(managed, { persist: false });
    this.subscribeToSession(managed);
    return { ...managed };
  }

  private buildManagedAgent(params: {
    resolvedAgentId: string;
    session: AgentSession;
    config: AgentSessionConfig;
    now: Date;
    durableTimelineHasRows: boolean;
    options: RegisterAgentSessionOptions | undefined;
  }): ActiveManagedAgent {
    const { resolvedAgentId, session, config, now, durableTimelineHasRows, options } = params;
    return {
      id: resolvedAgentId,
      provider: config.provider,
      cwd: config.cwd,
      session,
      capabilities: session.capabilities,
      config,
      runtimeInfo: undefined,
      lifecycle: "initializing",
      createdAt: options?.createdAt ?? now,
      updatedAt: options?.updatedAt ?? now,
      availableModes: [],
      currentModeId: null,
      pendingPermissions: new Map<string, AgentPermissionRequest>(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      activeForegroundTurnId: null,
      foregroundTurnWaiters: new Set<ForegroundTurnWaiter>(),
      finalizedForegroundTurnIds: new Set<string>(),
      unsubscribeSession: null,
      persistence: this.options.attachPersistenceCwd(session.describePersistence(), config.cwd),
      historyPrimed: options?.historyPrimed ?? durableTimelineHasRows,
      lastUserMessageAt: options?.lastUserMessageAt ?? null,
      lastUsage: options?.lastUsage,
      lastError: options?.lastError,
      attention: this.options.resolveInitialAttention(options?.attention),
      internal: config.internal ?? false,
      labels: options?.labels ?? {},
      relation: options?.relation,
      currentTurnToolCallCount: 0,
    } as ActiveManagedAgent;
  }

  private subscribeToSession(agent: ActiveManagedAgent): void {
    if (agent.unsubscribeSession) {
      return;
    }
    const agentId = agent.id;
    agent.unsubscribeSession = agent.session.subscribe((event) => {
      this.options.enqueueSessionEvent(agentId, event);
    });
  }

  private async resolveInitialPersistedTitle(
    agentId: string,
    config: AgentSessionConfig,
    fallbackTitle: string | null,
  ): Promise<{ title: string | null; titleSource: StoredAgentTitleSource }> {
    const existing = await this.options.registry?.get(agentId);
    if (existing) {
      return {
        title: existing.title ?? null,
        titleSource: existing.titleSource ?? "legacy",
      };
    }
    const explicitTitle =
      typeof config.title === "string" && config.title.trim().length > 0
        ? config.title.trim()
        : null;
    if (explicitTitle) {
      return { title: explicitTitle, titleSource: "explicit" };
    }
    return {
      title: fallbackTitle,
      titleSource: fallbackTitle ? "initial_prompt" : "legacy",
    };
  }
}
