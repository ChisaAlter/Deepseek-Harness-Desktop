import { randomUUID } from "node:crypto";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@chisacode/protocol/agent-lifecycle";
import type { AgentRelation } from "@chisacode/protocol/agent-labels";
import type { EffectiveMcpServersResult } from "./mcp-server-management.js";
import type { Logger } from "pino";
import { z } from "zod/v3";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { createSnapshot } from "../git-snapshot.js";
import {
  createGoalState,
  judgeTurn,
  buildContinuationPrompt,
  type GoalState,
  type GoalCompletionJudge,
} from "../goal-service.js";

import {
  getAgentStreamEventTurnId,
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentFeature,
  type AgentSlashCommand,
  type AgentMode,
  type AgentModelDefinition,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentProvider,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSkillEffectivePolicy,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
  type ListPersistedAgentsOptions,
  type PersistedAgentDescriptor,
} from "./agent-sdk-types.js";
import type { AgentStorage, StoredAgentRecord, StoredAgentTitleSource } from "./agent-storage.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";
import { AgentTimelineEventController } from "./agent-timeline-event-controller.js";
import { AgentLaunchConfigController } from "./agent-launch-config-controller.js";
import {
  AgentProviderController,
  type ImportablePersistedAgentQueryOptions,
  type ProviderAvailability,
  type ProviderClientMap,
  type ProviderEnabledMap,
} from "./agent-provider-controller.js";
import {
  AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
  AgentStreamCoalescer,
} from "./agent-stream-coalescer.js";
import { ForegroundRunState, type ForegroundTurnWaiter } from "./foreground-run-state.js";
import type { RewindMode } from "./rewind/rewind.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import type { UsageStore } from "../usage/usage-store.js";
import {
  GenerativeUiActionQueue,
  type GenerativeUiQueuedAction,
} from "./generative-ui-action-queue.js";
import { AgentHistoryController, type HydrateTimelineOptions } from "./agent-history-controller.js";
import { AgentManagerEventBus } from "./agent-manager-event-bus.js";
import { AgentArchiveController, type AgentArchivedCallback } from "./agent-archive-controller.js";
import { AgentMetadataController } from "./agent-metadata-controller.js";
import { AgentPermissionController } from "./agent-permission-controller.js";
import { AgentRunControlController } from "./agent-run-control-controller.js";
import { AgentRuntimeConfigurationController } from "./agent-runtime-configuration-controller.js";
import {
  AgentSessionRescueController,
  type AgentSessionRescueTimeouts,
} from "./agent-session-rescue-controller.js";
import { AgentSessionEventPipelineController } from "./agent-session-event-pipeline-controller.js";
import { AgentSessionLifecycleController } from "./agent-session-lifecycle-controller.js";
import { AgentSessionRegistrationController } from "./agent-session-registration-controller.js";
import { AgentSessionStateController } from "./agent-session-state-controller.js";
import { AgentSessionTeardownController } from "./agent-session-teardown-controller.js";
import { AgentTurnEventController } from "./agent-turn-event-controller.js";
import {
  AgentWaitController,
  type WaitForAgentOptions,
  type WaitForAgentResult,
  type WaitForAgentStartOptions,
} from "./agent-wait-controller.js";
import { AgentForegroundExecutionController } from "./agent-foreground-execution-controller.js";

export { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus };
export type {
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineWindow,
} from "./agent-timeline-store-types.js";
export type {
  ImportablePersistedAgentQueryOptions,
  ProviderAvailability,
} from "./agent-provider-controller.js";
export type { AgentArchivedCallback } from "./agent-archive-controller.js";
export type { AgentSessionRescueTimeouts } from "./agent-session-rescue-controller.js";
export type {
  WaitForAgentOptions,
  WaitForAgentResult,
  WaitForAgentStartOptions,
} from "./agent-wait-controller.js";

export type AgentManagerEvent =
  | { type: "agent_state"; agent: ManagedAgent }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEvent;
      seq?: number;
      epoch?: string;
      timestamp?: string;
    };

export type AgentSubscriber = (event: AgentManagerEvent) => void;

export interface SubscribeOptions {
  agentId?: string;
  replayState?: boolean;
}

export type AgentAttentionCallback = (params: {
  agentId: string;
  provider: AgentProvider;
  reason: "finished" | "error" | "permission";
}) => void;

export interface AgentManagerOptions {
  clients?: ProviderClientMap;
  providerDefinitions?: ProviderEnabledMap;
  idFactory?: () => string;
  registry?: AgentStorage;
  onAgentAttention?: AgentAttentionCallback;
  durableTimelineStore?: AgentTimelineStore;
  terminalManager?: TerminalManager | null;
  mcpBaseUrl?: string;
  appendSystemPrompt?: string;
  /**
   * Optional model-list cache for default model resolution during launch config
   * normalization. Avoids throwaway provider process spawns when a snapshot is warm.
   */
  resolveCachedModels?: (
    cwd: string | undefined,
    provider: AgentProvider,
  ) => readonly AgentModelDefinition[] | undefined;
  resolveSkillPolicy?: (
    agentId: string,
    config: AgentSessionConfig,
  ) => AgentSkillEffectivePolicy | undefined;
  resolveMcpServers?: (
    agentId: string,
    config: AgentSessionConfig,
  ) => EffectiveMcpServersResult | undefined;
  usageStore?: UsageStore;
  agentStreamCoalesceWindowMs?: number;
  rescueTimeouts?: AgentSessionRescueTimeouts;
  /**
   * Stalls longer than this (no stream events) end the foreground turn via
   * run-control cancellation. See AgentForegroundExecutionController.
   */
  foregroundTurnInactivityTimeoutMs?: number;
  /**
   * Maximum time a single tool call may stay `running` without further stream
   * events before the foreground turn is cancelled. See
   * AgentForegroundExecutionController.
   */
  foregroundToolCallStallTimeoutMs?: number;
  /** Coordinates agent registration and run starts with destructive workspace mutations. */
  workspaceWriteCoordinator?: {
    assertAcceptingWrites(path: string, operation: string): void;
    runWithWriteLease<T>(path: string, operation: string, fn: () => Promise<T>): Promise<T>;
  };
  logger: Logger;
}

type AttentionState =
  | { requiresAttention: false }
  | {
      requiresAttention: true;
      attentionReason: "finished" | "error" | "permission";
      attentionTimestamp: Date;
    };

function resolveInitialAttention(input: AttentionState | undefined): AttentionState {
  if (input == null || !input.requiresAttention) {
    return { requiresAttention: false };
  }
  return {
    requiresAttention: true,
    attentionReason: input.attentionReason,
    attentionTimestamp: new Date(input.attentionTimestamp),
  };
}

interface ManagedAgentBase {
  id: string;
  provider: AgentProvider;
  cwd: string;
  capabilities: AgentCapabilityFlags;
  config: AgentSessionConfig;
  runtimeInfo?: AgentRuntimeInfo;
  createdAt: Date;
  updatedAt: Date;
  availableModes: AgentMode[];
  features?: AgentFeature[];
  currentModeId: string | null;
  pendingPermissions: Map<string, AgentPermissionRequest>;
  bufferedPermissionResolutions: Map<
    string,
    Extract<AgentStreamEvent, { type: "permission_resolved" }>
  >;
  inFlightPermissionResponses: Set<string>;
  pendingReplacement: boolean;
  persistence: AgentPersistenceHandle | null;
  historyPrimed: boolean;
  lastUserMessageAt: Date | null;
  lastUsage?: AgentUsage;
  lastError?: string;
  attention: AttentionState;
  foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
  finalizedForegroundTurnIds: Set<string>;
  unsubscribeSession: (() => void) | null;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   */
  internal?: boolean;
  /**
   * User-defined labels for categorizing agents (e.g., { surface: "workspace" }).
   */
  labels: Record<string, string>;
  relation?: AgentRelation;
  /** Count of tool_call timeline items in the current turn (reset on turn start). */
  currentTurnToolCallCount: number;
}

type ManagedAgentWithSession = ManagedAgentBase & {
  session: AgentSession;
};

type ManagedAgentInitializing = ManagedAgentWithSession & {
  lifecycle: "initializing";
  activeForegroundTurnId: null;
};

type ManagedAgentIdle = ManagedAgentWithSession & {
  lifecycle: "idle";
  activeForegroundTurnId: null;
};

type ManagedAgentRunning = ManagedAgentWithSession & {
  lifecycle: "running";
  activeForegroundTurnId: string | null;
};

type ManagedAgentError = ManagedAgentWithSession & {
  lifecycle: "error";
  activeForegroundTurnId: null;
  lastError: string;
};

type ManagedAgentClosed = ManagedAgentBase & {
  lifecycle: "closed";
  session: null;
  activeForegroundTurnId: null;
};

export type ManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError
  | ManagedAgentClosed;

export interface AgentMetricsSnapshot {
  total: number;
  byLifecycle: Record<string, number>;
  withActiveForegroundTurn: number;
  timelineStats: {
    totalItems: number;
    maxItemsPerAgent: number;
  };
}

type ActiveManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError;

function attachPersistenceCwd(
  handle: AgentPersistenceHandle | null,
  cwd: string,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }
  return {
    ...handle,
    metadata: {
      ...handle.metadata,
      cwd,
    },
  };
}

const AgentIdSchema = z.string().uuid();

function isTurnTerminalEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

function validateAgentId(agentId: string, source: string): string {
  const result = AgentIdSchema.safeParse(agentId);
  if (!result.success) {
    throw new Error(`${source}: agentId must be a UUID`);
  }
  return result.data;
}

export class AgentManager {
  private readonly agents = new Map<string, ActiveManagedAgent>();
  private readonly archive: AgentArchiveController;
  private readonly foregroundExecution: AgentForegroundExecutionController;
  private readonly history: AgentHistoryController;
  private readonly launchConfig: AgentLaunchConfigController;
  private readonly metadata: AgentMetadataController;
  private readonly permissions: AgentPermissionController;
  private readonly providers: AgentProviderController;
  private readonly runControl: AgentRunControlController;
  private readonly runtimeConfiguration: AgentRuntimeConfigurationController;
  private readonly sessionEvents: AgentSessionEventPipelineController;
  private readonly sessionLifecycle: AgentSessionLifecycleController;
  private readonly sessionRegistration: AgentSessionRegistrationController;
  private readonly sessionRescue: AgentSessionRescueController;
  private readonly sessionState: AgentSessionStateController;
  private readonly sessionTeardown: AgentSessionTeardownController;
  private readonly timeline: AgentTimelineController;
  private readonly timelineEvents: AgentTimelineEventController;
  private readonly turnEvents: AgentTurnEventController;
  private readonly waits: AgentWaitController;
  private readonly agentsAwaitingInitialSnapshotPersist = new Set<string>();
  private readonly foregroundRuns = new ForegroundRunState();
  private readonly eventBus: AgentManagerEventBus;
  private readonly idFactory: () => string;
  private readonly registry?: AgentStorage;
  private readonly previousStatuses = new Map<string, AgentLifecycleStatus>();
  private readonly goals = new Map<string, GoalState>();
  private goalCompletionJudge?: GoalCompletionJudge;
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly agentStreamCoalescer: AgentStreamCoalescer;
  private readonly generativeUiActionQueue: GenerativeUiActionQueue;
  private readonly workspaceWriteCoordinator: AgentManagerOptions["workspaceWriteCoordinator"];
  private onAgentAttention?: AgentAttentionCallback;
  private logger: Logger;

  constructor(options: AgentManagerOptions) {
    this.idFactory = options?.idFactory ?? (() => randomUUID());
    this.registry = options?.registry;
    this.onAgentAttention = options?.onAgentAttention;
    this.workspaceWriteCoordinator = options.workspaceWriteCoordinator;
    this.logger = options.logger.child({ module: "agent", component: "agent-manager" });
    this.eventBus = new AgentManagerEventBus({
      logger: this.logger,
      validateAgentId,
      getAgent: (agentId) => this.agents.get(agentId) ?? null,
      listAgents: () => this.agents.values(),
    });
    this.waits = new AgentWaitController({
      getAgent: (agentId) => this.getAgent(agentId),
      getLastAssistantMessage: (agentId) => this.getLastAssistantMessage(agentId),
      getPendingRun: (agentId) => this.foregroundRuns.getPendingRun(agentId),
      subscribe: (callback, waitOptions) => this.subscribe(callback, waitOptions),
    });
    this.permissions = new AgentPermissionController({
      broadcastAttention: (agent) => this.broadcastAgentAttention(agent, "permission"),
      dispatchStream: (agentId, event, metadata) => this.dispatchStream(agentId, event, metadata),
      emitState: (agent) => this.emitState(agent),
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      getSessionEventTail: (agentId) => this.sessionEvents.getTail(agentId),
      logger: this.logger,
      persistSnapshot: (agent) => this.persistSnapshot(agent),
      refreshSessionState: (agent) => this.sessionState.refresh(agent),
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
    });
    this.sessionState = new AgentSessionStateController({
      attachPersistenceCwd,
      emitState: (agent) => this.emitState(agent),
      logger: this.logger,
      permissions: this.permissions,
    });
    this.foregroundExecution = new AgentForegroundExecutionController({
      attachPersistenceCwd,
      cancelRun: (agentId) => this.runControl.cancel(agentId),
      emitState: (agent) => this.emitState(agent),
      foregroundRuns: this.foregroundRuns,
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      handleStreamEvent: (agent, event) => this.sessionEvents.handle(agent, event),
      inactivityTimeoutMs: options.foregroundTurnInactivityTimeoutMs,
      toolCallStallTimeoutMs: options.foregroundToolCallStallTimeoutMs,
      isTerminalEvent: isTurnTerminalEvent,
      logger: this.logger,
      onAgentTerminal: (agentId) => this.generativeUiActionQueue.onAgentTerminal(agentId),
      refreshRuntimeInfo: (agent) => this.sessionState.refreshRuntimeInfo(agent),
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
    });
    this.providers = new AgentProviderController({
      clients: options.clients ?? {},
      providerDefinitions: options.providerDefinitions ?? {},
      logger: this.logger,
    });
    this.launchConfig = new AgentLaunchConfigController({
      appendSystemPrompt: options.appendSystemPrompt ?? "",
      logger: this.logger,
      mcpBaseUrl: options.mcpBaseUrl ?? null,
      providers: this.providers,
      resolveCachedModels: options.resolveCachedModels,
      resolveMcpServers: options.resolveMcpServers,
      resolveSkillPolicy: options.resolveSkillPolicy,
    });
    this.timeline = new AgentTimelineController({
      durableStore: options.durableTimelineStore,
      logger: this.logger,
      trackBackgroundTask: (task) => this.trackBackgroundTask(task),
    });
    this.timelineEvents = new AgentTimelineEventController({
      dispatchStream: (agentId, event, metadata) => this.dispatchStream(agentId, event, metadata),
      emitState: (agent) => this.emitState(agent),
      findAgent: (agentId) => this.agents.get(agentId) ?? null,
      foregroundRuns: this.foregroundRuns,
      logger: this.logger,
      timeline: this.timeline,
    });
    this.turnEvents = new AgentTurnEventController({
      dispatchStream: (agentId, event, metadata) => this.dispatchStream(agentId, event, metadata),
      emitState: (agent) => this.emitState(agent),
      logger: this.logger,
      permissions: this.permissions,
      sessionState: this.sessionState,
      timeline: this.timeline,
      trackBackgroundTask: (task) => this.trackBackgroundTask(task),
      usageStore: options.usageStore,
      snapshotOnTurn: (cwd, kind, agentId) => {
        const task = createSnapshot(cwd, { kind, agentId }, this.logger)
          .then(() => undefined)
          .catch((err) => {
            this.logger.debug({ err, agentId, kind }, "Auto-snapshot skipped");
          });
        this.trackBackgroundTask(task);
      },
      onGoalTurnCompleted: (agentId, _cwd, tokensUsed, usedTools) => {
        // Wrap the goal continuation evaluation so a throw inside judgeTurn (or
        // any synchronous part of evaluateGoalContinuation) cannot abort the
        // turn-event pipeline and leave the agent stuck in a non-idle lifecycle.
        try {
          this.evaluateGoalContinuation(agentId, tokensUsed, usedTools);
        } catch (err) {
          this.logger.warn({ err, agentId }, "Goal continuation evaluation threw");
        }
      },
    });
    this.sessionRegistration = new AgentSessionRegistrationController({
      addAgent: (agent) => {
        this.agents.set(agent.id, agent);
      },
      attachPersistenceCwd,
      beginInitialSnapshotPersist: (agentId) => {
        this.agentsAwaitingInitialSnapshotPersist.add(agentId);
      },
      emitState: (agent, emitOptions) => this.emitState(agent, emitOptions),
      endInitialSnapshotPersist: (agentId) => {
        this.agentsAwaitingInitialSnapshotPersist.delete(agentId);
      },
      enqueueSessionEvent: (agentId, event) => this.sessionEvents.enqueue(agentId, event),
      hasAgent: (agentId) => this.agents.has(agentId),
      persistSnapshot: (agent, persistOptions) => this.persistSnapshot(agent, persistOptions),
      recordInitialStatus: (agentId, lifecycle) => {
        this.previousStatuses.set(agentId, lifecycle);
      },
      refreshRuntimeInfo: (agent) => this.sessionState.refreshRuntimeInfo(agent),
      refreshSessionState: (agent) => this.sessionState.refresh(agent),
      registry: this.registry,
      resolveInitialAttention,
      timeline: this.timeline,
      validateAgentId,
    });
    this.metadata = new AgentMetadataController({
      emitState: (agent, emitOptions) => this.emitState(agent, emitOptions),
      getAgent: (agentId) => this.agents.get(agentId) ?? null,
      isAwaitingInitialSnapshotPersist: (agentId) =>
        this.agentsAwaitingInitialSnapshotPersist.has(agentId),
      persistSnapshot: (agent, persistOptions) => this.persistSnapshot(agent, persistOptions),
      registry: this.registry,
    });
    this.runtimeConfiguration = new AgentRuntimeConfigurationController({
      emitState: (agent) => this.emitState(agent),
      providers: this.providers,
      reloadAgentSession: async (agentId, overrides) => {
        await this.reloadAgentSession(agentId, overrides);
      },
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
    });
    this.archive = new AgentArchiveController({
      archiveNativeSessionBestEffort: (provider, persistence) =>
        this.providers.archiveNativeSessionBestEffort(provider, persistence),
      closeAgent: (agentId) => this.closeAgent(agentId),
      dispatchAgentState: (agent) => this.dispatch({ type: "agent_state", agent }),
      getAgent: (agentId) => this.agents.get(agentId) ?? null,
      logger: this.logger,
      notifyAgentState: (agentId) => this.notifyAgentState(agentId),
      persistSnapshot: (agent, persistOptions) => this.persistSnapshot(agent, persistOptions),
      registry: this.registry,
    });
    this.sessionRescue = new AgentSessionRescueController(this.logger, options.rescueTimeouts);
    this.runControl = new AgentRunControlController({
      clearPendingPermissions: (agent) => this.permissions.clearAfterInterrupt(agent),
      dispatchSessionEvent: (agent, event) => this.sessionEvents.dispatch(agent, event),
      emitState: (agent) => this.emitState(agent),
      findAgent: (agentId) => this.agents.get(agentId) ?? null,
      foregroundRuns: this.foregroundRuns,
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      interruptSession: (session, agentId) => this.sessionRescue.interruptSession(session, agentId),
      logger: this.logger,
      streamAgent: (agentId, prompt, runOptions) =>
        this.foregroundExecution.stream(agentId, prompt, runOptions),
      subscribe: (callback, subscribeOptions) => this.subscribe(callback, subscribeOptions),
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
    });
    this.generativeUiActionQueue = new GenerativeUiActionQueue({
      getAgentStatus: (agentId) => {
        const agent = this.agents.get(agentId);
        if (!agent) return undefined;
        return this.hasInFlightRun(agentId) ? "running" : agent.lifecycle;
      },
      dispatchPrompt: (agentId, prompt) => this.initiateGenerativeUiPrompt(agentId, prompt),
      log: (metadata) => {
        this.logger.warn(metadata, "Generative UI action batch was dropped");
      },
    });
    this.agentStreamCoalescer = new AgentStreamCoalescer({
      windowMs: options.agentStreamCoalesceWindowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
      timers: { setTimeout, clearTimeout },
      onFlush: (input) => this.timelineEvents.onCoalescedFlush(input),
    });
    this.sessionEvents = new AgentSessionEventPipelineController({
      coalescer: this.agentStreamCoalescer,
      dispatchStream: (agentId, event, metadata) => this.dispatchStream(agentId, event, metadata),
      finalizeForeground: (agent, turnId) => this.foregroundExecution.finalize(agent, turnId),
      findAgent: (agentId) => this.agents.get(agentId) ?? null,
      foregroundRuns: this.foregroundRuns,
      isTerminalEvent: isTurnTerminalEvent,
      logger: this.logger,
      onAgentTerminal: (agentId) => this.generativeUiActionQueue.onAgentTerminal(agentId),
      permissions: this.permissions,
      sessionState: this.sessionState,
      timelineEvents: this.timelineEvents,
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
      trackBackgroundTask: (task) => this.trackBackgroundTask(task),
      turnEvents: this.turnEvents,
    });
    this.history = new AgentHistoryController({
      cancelAgentRun: (agentId) => this.runControl.cancel(agentId),
      coalescer: this.agentStreamCoalescer,
      dispatchStream: (agentId, event, metadata) => this.dispatchStream(agentId, event, metadata),
      emitState: (agent) => this.emitState(agent),
      foregroundRuns: this.foregroundRuns,
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      logger: this.logger,
      persistSnapshot: (agent) => this.persistSnapshot(agent),
      refreshRuntimeInfo: (agent) => this.sessionState.refreshRuntimeInfo(agent),
      timeline: this.timeline,
      touchUpdatedAt: (agent) => this.touchUpdatedAt(agent),
    });
    this.sessionTeardown = new AgentSessionTeardownController({
      clearGenerativeUi: (agentId) => this.generativeUiActionQueue.clearAgent(agentId),
      closeReloadedSession: (session, agentId) =>
        this.sessionRescue.closeReloadedSession(session, agentId),
      coalescer: this.agentStreamCoalescer,
      deleteAgent: (agentId) => {
        this.agents.delete(agentId);
      },
      deletePreviousStatus: (agentId) => {
        this.previousStatuses.delete(agentId);
      },
      deleteGoal: (agentId) => {
        // Clear the goal state when the agent is torn down so a long-running
        // daemon does not accumulate GoalState entries for archived agents and
        // listGoals() does not return goals for agents that no longer exist.
        this.goals.delete(agentId);
      },
      emitState: (agent, emitOptions) => this.emitState(agent, emitOptions),
      foregroundRuns: this.foregroundRuns,
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      logger: this.logger,
      persistSnapshot: (agent) => this.persistSnapshot(agent),
      timeline: this.timeline,
    });
    this.sessionLifecycle = new AgentSessionLifecycleController({
      cancelAgentRun: (agentId) => this.runControl.cancel(agentId),
      getAgent: (agentId) => this.requireSessionAgent(agentId),
      hasInFlightRun: (agentId) => this.hasInFlightRun(agentId),
      idFactory: () => this.idFactory(),
      launchConfig: this.launchConfig,
      providers: this.providers,
      registration: this.sessionRegistration,
      teardown: this.sessionTeardown,
      timeline: this.timeline,
      validateAgentId,
    });
  }

  private async runWorkspaceRegistration<T>(
    cwd: string,
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.workspaceWriteCoordinator) {
      return await fn();
    }
    return await this.workspaceWriteCoordinator.runWithWriteLease(cwd, operation, fn);
  }

  private assertAgentWorkspaceAcceptingWrites(agentId: string, operation: string): ManagedAgent {
    const agent = this.requireAgent(agentId);
    this.workspaceWriteCoordinator?.assertAcceptingWrites(agent.cwd, operation);
    return agent;
  }

  /**
   * Enqueues a generative UI action without interrupting an active agent turn.
   * @param agentId Target agent identifier
   * @param action Validated action payload
   * @returns Confirmation that the action entered the manager-owned queue
   */
  enqueueGenerativeUiAction(agentId: string, action: GenerativeUiQueuedAction): { queued: true } {
    this.assertAgentWorkspaceAcceptingWrites(agentId, "enqueue agent action");
    this.generativeUiActionQueue.enqueue(agentId, action);
    return { queued: true };
  }

  private async initiateGenerativeUiPrompt(agentId: string, prompt: string): Promise<void> {
    this.assertAgentWorkspaceAcceptingWrites(agentId, "start agent action");
    let started = false;
    let resolveInitiated!: () => void;
    let rejectInitiated!: (error: unknown) => void;
    const initiated = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveInitiated = resolvePromise;
      rejectInitiated = rejectPromise;
    });
    const task = (async () => {
      try {
        for await (const _event of this.foregroundExecution.stream(
          agentId,
          formatSystemNotificationPrompt(prompt),
          undefined,
          {
            onStarted: () => {
              started = true;
              resolveInitiated();
            },
            onStartFailed: rejectInitiated,
          },
        )) {
          // The normal session event pipeline persists and broadcasts every event.
        }
      } catch (error) {
        if (!started) {
          rejectInitiated(error);
          return;
        }
        this.logger.warn(
          { agentId, reason: "dispatch_failed" },
          "Generative UI follow-up prompt failed after initiation",
        );
      }
    })();
    this.trackBackgroundTask(task);
    await initiated;
  }
  registerClient(provider: AgentProvider, client: AgentClient): void {
    this.providers.registerClient(provider, client);
  }

  updateProviderRegistry(input: {
    providerDefinitions: ProviderEnabledMap;
    clients: ProviderClientMap;
  }): void {
    this.providers.updateProviderRegistry(input);
  }

  getRegisteredProviderIds(): AgentProvider[] {
    return this.providers.getRegisteredProviderIds();
  }

  setAgentAttentionCallback(callback: AgentAttentionCallback): void {
    this.onAgentAttention = callback;
  }

  setAgentArchivedCallback(callback: AgentArchivedCallback): void {
    this.archive.setArchivedCallback(callback);
  }

  setMcpBaseUrl(url: string | null): void {
    this.launchConfig.setMcpBaseUrl(url);
  }

  validateCompanionMcpToken(parentAgentId: string, token: string): boolean {
    return this.launchConfig.validateCompanionMcpToken(parentAgentId, token);
  }

  setAppendSystemPrompt(prompt: string | null | undefined): void {
    this.launchConfig.setAppendSystemPrompt(prompt);
  }

  public getMetricsSnapshot(): AgentMetricsSnapshot {
    const byLifecycle: Record<string, number> = {};
    let withActiveForegroundTurn = 0;
    let totalItems = 0;
    let maxItemsPerAgent = 0;

    for (const agent of this.agents.values()) {
      byLifecycle[agent.lifecycle] = (byLifecycle[agent.lifecycle] ?? 0) + 1;

      if (agent.activeForegroundTurnId !== null) {
        withActiveForegroundTurn++;
      }

      if (!this.timeline.has(agent.id)) {
        continue;
      }

      const len = this.timeline.getItemCount(agent.id);
      totalItems += len;
      if (len > maxItemsPerAgent) {
        maxItemsPerAgent = len;
      }
    }

    return {
      total: this.agents.size,
      byLifecycle,
      withActiveForegroundTurn,
      timelineStats: {
        totalItems,
        maxItemsPerAgent,
      },
    };
  }

  private touchUpdatedAt(agent: ManagedAgent): Date {
    return this.metadata.touchUpdatedAt(agent);
  }

  hasInFlightRun(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    return (
      agent.lifecycle === "running" ||
      Boolean(agent.activeForegroundTurnId) ||
      this.foregroundRuns.hasPendingRun(agentId)
    );
  }

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    return this.eventBus.subscribe(callback, options);
  }

  listAgents(): ManagedAgent[] {
    return Array.from(this.agents.values())
      .filter((agent) => !agent.internal)
      .map((agent) => Object.assign({}, agent));
  }

  async listImportablePersistedAgents(
    options?: ImportablePersistedAgentQueryOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    return await this.providers.listImportablePersistedAgents(options);
  }

  async findPersistedAgent(
    provider: AgentProvider,
    sessionId: string,
    options?: Pick<ListPersistedAgentsOptions, "cwd">,
  ): Promise<PersistedAgentDescriptor | null> {
    return await this.providers.findPersistedAgent(provider, sessionId, options);
  }

  async listProviderAvailability(): Promise<ProviderAvailability[]> {
    return await this.providers.listProviderAvailability();
  }

  async listDraftCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const normalizedConfig = await this.launchConfig.normalizeConfig(config);
    const launchConfig = this.launchConfig.buildRuntimeLaunchConfig(normalizedConfig);
    return await this.providers.listDraftCommands(launchConfig, normalizedConfig.provider);
  }

  async listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const normalizedConfig = await this.launchConfig.normalizeConfig(config);
    const launchConfig = this.launchConfig.buildRuntimeLaunchConfig(normalizedConfig);
    return await this.providers.listDraftFeatures(launchConfig, normalizedConfig.provider);
  }

  getAgent(id: string): ManagedAgent | null {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : null;
  }

  getTimeline(id: string): AgentTimelineItem[] {
    this.requireAgent(id);
    return this.timeline.getItems(id);
  }

  async getTimelineRows(id: string): Promise<AgentTimelineRow[]> {
    this.requireAgent(id);
    return await this.timeline.getRows(id);
  }

  fetchTimeline(id: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    this.requireAgent(id);
    return this.timeline.fetch(id, options);
  }

  async createAgent(
    config: AgentSessionConfig,
    agentId?: string,
    options?: {
      labels?: Record<string, string>;
      relation?: AgentRelation;
      workspaceId?: string;
      initialPrompt?: string;
      env?: Record<string, string>;
      persistSession?: boolean;
      initialTitle?: string | null;
    },
  ): Promise<ManagedAgent> {
    return await this.runWorkspaceRegistration(config.cwd, "create agent", () =>
      this.sessionLifecycle.create(config, agentId, options),
    );
  }

  // Reconstruct an agent from provider persistence. Callers should explicitly
  // hydrate timeline history after resume.
  async resumeAgentFromPersistence(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      relation?: AgentRelation;
    },
  ): Promise<ManagedAgent> {
    const metadata = handle.metadata as Partial<AgentSessionConfig> | undefined;
    const cwd = overrides?.cwd ?? metadata?.cwd;
    if (!cwd) {
      return await this.sessionLifecycle.resume(handle, overrides, agentId, options);
    }
    return await this.runWorkspaceRegistration(cwd, "resume agent", () =>
      this.sessionLifecycle.resume(handle, overrides, agentId, options),
    );
  }

  // Hot-reload an active agent session with config overrides. By default the
  // in-memory timeline is preserved (used for voice-mode toggles and similar
  // config swaps). When `rehydrateFromDisk` is set, the timeline is wiped so a
  // new epoch is minted and provider history is re-streamed — this is what the
  // user-facing "Reload agent" action wants when the on-disk session was
  // mutated outside ChisaCode.
  async reloadAgentSession(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    const cwd = overrides?.cwd ?? this.requireAgent(agentId).cwd;
    return await this.runWorkspaceRegistration(cwd, "reload agent", () =>
      this.sessionLifecycle.reload(agentId, overrides, options),
    );
  }

  async closeAgent(agentId: string): Promise<void> {
    await this.sessionTeardown.close(agentId);
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const agent = this.requireAgent(agentId);
    return await this.archive.archiveAgent(agent);
  }

  async setAgentMode(agentId: string, modeId: string): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.runtimeConfiguration.setMode(agent, modeId);
  }

  async setAgentModel(
    agentId: string,
    modelId: string | null,
    options?: { runtimeProvider?: AgentProvider | string | null },
  ): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.runtimeConfiguration.setModel(agent, modelId, options);
  }

  async setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.runtimeConfiguration.setThinkingOption(agent, thinkingOptionId);
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.runtimeConfiguration.setFeature(agent, featureId, value);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.metadata.setTitle(agent, title);
  }

  async setGeneratedTitle(
    agentId: string,
    title: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.metadata.setGeneratedTitle(agent, title, options);
  }

  /**
   * Force-regenerate title from first user message. Requires provider snapshot deps.
   */
  async regenerateAgentTitle(
    agentId: string,
    deps: {
      providerSnapshotManager: { listProviders: (...args: never[]) => unknown };
      workspaceGitService?: { resolveRepoRoot: (...args: never[]) => unknown };
      daemonConfig?: unknown;
    },
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.internal) {
      throw new Error("Cannot regenerate title for internal agents");
    }
    const timeline = this.getTimeline(agentId);
    const firstUserMessage = timeline.find(
      (item) => item.type === "user_message" && typeof item.text === "string" && item.text.trim(),
    );
    if (!firstUserMessage || firstUserMessage.type !== "user_message") {
      throw new Error("No user message available to regenerate the title");
    }
    const { generateAndApplyAgentMetadata } = await import("./agent-metadata-generator.js");
    await generateAndApplyAgentMetadata({
      agentManager: this,
      agentId,
      cwd: agent.config.cwd,
      workspaceGitService: deps.workspaceGitService as never,
      providerSnapshotManager: deps.providerSnapshotManager as never,
      daemonConfig: deps.daemonConfig as never,
      currentSelection: {
        provider: agent.provider,
        model: agent.runtimeInfo?.model ?? agent.config.model,
        thinkingOptionId:
          agent.runtimeInfo?.thinkingOptionId ?? agent.config.thinkingOptionId ?? null,
      },
      initialPrompt: firstUserMessage.text,
      explicitTitle: null,
      provisionalTitle: null,
      forceRegenerateTitle: true,
      logger: this.logger,
    });
  }

  async setLabels(agentId: string, labels: Record<string, string>): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.metadata.setLabels(agent, labels);
  }

  notifyAgentState(agentId: string): void {
    this.metadata.notifyAgentState(agentId);
  }

  async clearAgentAttention(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.metadata.clearAgentAttention(agent);
  }

  async archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord> {
    return await this.archive.archiveSnapshot(agentId, archivedAt);
  }

  async unarchiveSnapshot(agentId: string): Promise<boolean> {
    return await this.archive.unarchiveSnapshot(agentId);
  }

  async unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void> {
    await this.archive.unarchiveSnapshotByHandle(handle);
  }

  async updateAgentMetadata(
    agentId: string,
    updates: {
      title?: string;
      labels?: Record<string, string>;
    },
  ): Promise<void> {
    await this.metadata.updateAgentMetadata(agentId, updates);
  }

  async runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const events = this.streamAgent(agentId, prompt, options);
    const timeline: AgentTimelineItem[] = [];
    let finalText = "";
    let usage: AgentUsage | undefined;
    let canceled = false;

    for await (const event of events) {
      if (event.type === "timeline") {
        timeline.push(event.item);
      } else if (event.type === "turn_completed") {
        usage = event.usage;
      } else if (event.type === "turn_failed") {
        throw new Error(this.turnEvents.formatFailure(event));
      } else if (event.type === "turn_canceled") {
        canceled = true;
      }
    }

    finalText = this.getLastAssistantMessageFromTimeline(timeline) ?? "";

    const agent = this.requireAgent(agentId);
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId) {
      throw new Error(`Agent ${agentId} has no persistence.sessionId after run completed`);
    }
    return {
      sessionId,
      finalText,
      usage,
      timeline,
      canceled,
    };
  }

  /**
   * Try to run a prompt out-of-band — i.e. without allocating a foreground turn
   * and without canceling any active turn. Returns true when the session
   * accepted the prompt as a side-effect command (e.g. /goal pause). Events
   * emitted by the handler flow through dispatchStream so they persist and
   * broadcast like normal timeline events.
   */
  tryRunOutOfBand(agentId: string, prompt: AgentPromptInput): boolean {
    this.assertAgentWorkspaceAcceptingWrites(agentId, "start agent command");
    const agent = this.requireSessionAgent(agentId);
    const handler = agent.session.tryHandleOutOfBand?.(prompt);
    if (!handler) {
      return false;
    }
    const dispatch = (event: AgentStreamEvent): void => {
      // Persist timeline items so they show up in fetchAgentTimeline; broadcast
      // for live subscribers. Other event types are broadcast only.
      if (event.type === "timeline") {
        this.touchUpdatedAt(agent);
        const row = this.recordTimeline(agent.id, event.item);
        this.dispatchStream(agent.id, event, {
          seq: row.seq,
          epoch: this.timeline.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
        return;
      }
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    };
    void (async () => {
      try {
        await handler.run({ emit: dispatch });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Out-of-band command failed";
        dispatch({
          type: "timeline",
          provider: agent.provider,
          item: { type: "assistant_message", text: `[Error] ${text}` },
        });
      }
    })();
    return true;
  }

  async appendTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    const row = this.recordTimeline(agentId, item);
    this.dispatchStream(
      agentId,
      {
        type: "timeline",
        item,
        provider: agent.provider,
      },
      {
        seq: row.seq,
        epoch: this.timeline.getEpoch(agentId),
        timestamp: row.timestamp,
      },
    );
    await this.persistSnapshot(agent);
  }

  async emitLiveTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    this.dispatchStream(agentId, {
      type: "timeline",
      item,
      provider: agent.provider,
    });
  }

  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    this.assertAgentWorkspaceAcceptingWrites(agentId, "start agent run");
    return this.foregroundExecution.stream(agentId, prompt, options);
  }

  replaceAgentRun(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    this.assertAgentWorkspaceAcceptingWrites(agentId, "replace agent run");
    return this.runControl.replace(agentId, prompt, options);
  }

  // ── Goal management ────────────────────────────────────────────────────────

  setGoal(
    agentId: string,
    objective: string,
    limits?: {
      maxTurns?: number | null;
      budgetTokens?: number | null;
      noProgressLimit?: number | null;
    },
  ): GoalState {
    const goal = createGoalState({ sessionId: agentId, objective, limits }, Date.now());
    this.goals.set(agentId, goal);
    this.logger.info({ agentId, objective }, "Goal set");
    return goal;
  }

  cancelGoal(agentId: string): GoalState | null {
    const goal = this.goals.get(agentId);
    if (!goal) return null;
    const cancelled: GoalState = {
      ...goal,
      // Use the dedicated "cancelled" terminal state so UI logic can branch on
      // user-initiated cancellation distinct from a judge pause or a budget limit.
      status: "cancelled",
      lastReason: "Cancelled by user",
      updatedAt: Date.now(),
    };
    this.goals.set(agentId, cancelled);
    return cancelled;
  }

  getGoal(agentId: string): GoalState | null {
    return this.goals.get(agentId) ?? null;
  }

  listGoals(): GoalState[] {
    return Array.from(this.goals.values());
  }

  /** Set the LLM judge that decides whether an active goal is already met. */
  setGoalCompletionJudge(judge: GoalCompletionJudge | undefined): void {
    this.goalCompletionJudge = judge;
  }

  private evaluateGoalContinuation(agentId: string, tokensUsed: number, usedTools: boolean): void {
    const goal = this.goals.get(agentId);
    if (!goal || goal.status !== "active") return;

    const { verdict, updated } = judgeTurn(goal, { usedTools, tokensUsed }, Date.now());
    this.goals.set(agentId, updated);

    this.logger.info(
      { agentId, action: verdict.action, reason: verdict.reason, turnsUsed: updated.turnsUsed },
      "Goal turn judged",
    );

    if (verdict.action !== "continue") {
      if (verdict.action === "complete" || verdict.action === "budgetLimited") {
        this.logger.info({ agentId, reason: verdict.reason }, "Goal finished");
      }
      return;
    }

    const task = (async () => {
      // Optional LLM completion judge: stop early if the objective is already met.
      if (this.goalCompletionJudge) {
        try {
          const judgment = await this.goalCompletionJudge({
            agentId,
            objective: updated.objective,
            recentOutput: this.lastAssistantText(agentId),
          });
          if (judgment?.complete) {
            const current = this.goals.get(agentId);
            if (current && current.status === "active") {
              this.goals.set(agentId, {
                ...current,
                status: "complete",
                lastReason: judgment.reason,
                updatedAt: Date.now(),
              });
              this.logger.info({ agentId, reason: judgment.reason }, "Goal completed by judge");
              return;
            }
          }
        } catch (err) {
          this.logger.warn({ err, agentId }, "Goal completion judge failed; continuing");
        }
      }

      // Re-check the goal status before starting another turn: a user cancel
      // (cancelGoal flips status to "paused" and cancels the in-flight run) can
      // land while the judge was awaiting. Without this guard the loop would
      // start a fresh continuation turn for a goal that is no longer active.
      const preStream = this.goals.get(agentId);
      if (!preStream || preStream.status !== "active") {
        this.logger.info({ agentId }, "Goal continuation skipped (no longer active)");
        return;
      }

      const prompt = buildContinuationPrompt(updated);
      this.logger.info({ agentId }, "Goal auto-continuing");
      try {
        this.assertAgentWorkspaceAcceptingWrites(agentId, "continue agent goal");
        for await (const _event of this.foregroundExecution.stream(agentId, prompt)) {
          // Drain the stream — events are dispatched internally. The stream can
          // be aborted mid-iteration by cancelAgentRun if the user cancels now.
        }
      } catch (err) {
        this.logger.warn({ err, agentId }, "Goal continuation run failed");
      }
    })();
    this.trackBackgroundTask(task);
  }

  /** Most recent assistant message text for an agent ("" if none). */
  private lastAssistantText(agentId: string): string {
    const items = this.timeline.getItems(agentId);
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item.type === "assistant_message") return item.text;
    }
    return "";
  }

  async waitForAgentRunStart(agentId: string, options?: WaitForAgentStartOptions): Promise<void> {
    await this.waits.waitForRunStart(agentId, options);
  }

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    return this.permissions.respond(agentId, requestId, response);
  }

  async cancelAgentRun(agentId: string): Promise<boolean> {
    return this.runControl.cancel(agentId);
  }

  getPendingPermissions(agentId: string): AgentPermissionRequest[] {
    return this.permissions.list(agentId);
  }

  /**
   * Hydrates the timeline from provider history if the agent's durable
   * timeline is empty (e.g., imported agents that have provider history
   * on disk but no persisted timeline rows). No-ops if already hydrated.
   */
  async hydrateTimelineFromProvider(
    agentId: string,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    await this.history.hydrate(agentId, options);
  }

  getHydrationState(agentId: string): "idle" | "hydrating" | "hydrated" {
    return this.history.getHydrationState(agentId);
  }

  getHydrationPromise(agentId: string): Promise<void> | undefined {
    return this.history.getHydrationPromise(agentId);
  }

  async rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void> {
    await this.history.rewind(agentId, messageId, mode);
  }

  async deleteCommittedTimeline(agentId: string): Promise<void> {
    await this.timeline.deleteCommitted(agentId);
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    return await this.timeline.getLastAssistantMessage(agentId);
  }

  private getLastAssistantMessageFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): string | null {
    const chunks: string[] = [];
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.type !== "assistant_message") {
        if (chunks.length) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
    }
    return chunks.length > 0 ? chunks.toReversed().join("") : null;
  }

  async waitForAgentEvent(
    agentId: string,
    options?: WaitForAgentOptions,
  ): Promise<WaitForAgentResult> {
    return await this.waits.waitForEvent(agentId, options);
  }

  private async persistSnapshot(
    agent: ManagedAgent,
    options?: {
      workspaceId?: string;
      title?: string | null;
      titleSource?: StoredAgentTitleSource;
      internal?: boolean;
    },
  ): Promise<void> {
    if (!this.registry) {
      return;
    }
    // Don't persist internal agents - they're ephemeral system tasks
    if (agent.internal) {
      return;
    }
    if (options?.workspaceId !== undefined) {
      await this.registry.applySnapshot(agent, options.workspaceId, options);
      return;
    }
    await this.registry.applySnapshot(agent, options);
  }

  private recordTimeline(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): AgentTimelineRow {
    return this.timeline.append(agentId, item, options);
  }

  private emitState(agent: ManagedAgent, options?: { persist?: boolean }): void {
    // Keep attention as an edge-triggered unread signal, not a level signal.
    this.checkAndSetAttention(agent);
    const shouldPersist =
      options?.persist !== false && !this.agentsAwaitingInitialSnapshotPersist.has(agent.id);
    if (shouldPersist) {
      this.enqueueBackgroundPersist(agent);
    }

    this.sessionState.syncFeatures(agent);

    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
        persist: shouldPersist,
      },
      "agent.manager.emit_state",
    );

    this.dispatch({
      type: "agent_state",
      agent: { ...agent },
    });
  }

  private checkAndSetAttention(agent: ManagedAgent): void {
    const previousStatus = this.previousStatuses.get(agent.id);
    const currentStatus = agent.lifecycle;

    // Track the new status
    this.previousStatuses.set(agent.id, currentStatus);

    // Skip attention tracking for internal agents
    if (agent.internal) {
      return;
    }

    // Skip if already requires attention
    if (agent.attention.requiresAttention) {
      return;
    }

    // Check if agent transitioned from running to idle (finished)
    if (previousStatus === "running" && currentStatus === "idle") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "finished");
      return;
    }

    // Check if agent entered error state
    if (previousStatus !== "error" && currentStatus === "error") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "error",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "error");
      return;
    }
  }

  private enqueueBackgroundPersist(agent: ManagedAgent): void {
    const task = this.persistSnapshot(agent).catch((err) => {
      this.logger.error({ err, agentId: agent.id }, "Failed to persist agent snapshot");
    });
    this.trackBackgroundTask(task);
  }

  private trackBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
  }

  /**
   * Flush any background persistence work (best-effort).
   * Used by daemon shutdown paths to avoid unhandled rejections after cleanup.
   */
  async flush(): Promise<void> {
    this.agentStreamCoalescer.flushAll();
    // Drain tasks, including tasks spawned while awaiting.
    while (this.backgroundTasks.size > 0) {
      const pending = Array.from(this.backgroundTasks);
      await Promise.allSettled(pending);
    }
  }

  private broadcastAgentAttention(
    agent: ManagedAgent,
    reason: "finished" | "error" | "permission",
  ): void {
    this.onAgentAttention?.({
      agentId: agent.id,
      provider: agent.provider,
      reason,
    });
  }

  private dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void {
    const agent = this.agents.get(agentId);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        metadata,
        event,
      },
      "agent.manager.dispatch_stream",
    );
    this.dispatch({ type: "agent_stream", agentId, event, ...metadata });
  }

  private dispatch(event: AgentManagerEvent): void {
    this.eventBus.dispatch(event);
  }

  private requireAgent(id: string): ActiveManagedAgent {
    const normalizedId = validateAgentId(id, "requireAgent");
    const agent = this.agents.get(normalizedId);
    if (!agent) {
      throw new Error(`Unknown agent '${normalizedId}'`);
    }
    return agent;
  }

  private requireSessionAgent(id: string): ActiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.session === null) {
      throw new Error(`Agent '${agent.id}' has no managed session`);
    }
    return agent;
  }
}
