import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";
import { getAgentStatusPriority } from "@chisacode/protocol/agent-state-bucket";
import {
  type AgentSnapshotPayload,
  type ProjectPlacementPayload,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "../messages.js";
import {
  projectTimelineRows,
  selectTimelineWindowByProjectedLimit,
  type TimelineProjectionMode,
} from "../agent/timeline-projection.js";
import {
  listImportableProviderSessions,
  ImportSessionsRequestError,
} from "../agent/import-sessions.js";
import {
  ensureAgentLoaded,
  preloadAgents,
  selectAgentsForPreload,
} from "../agent/agent-loading.js";
import { normalizeWorkspaceId as normalizePersistedWorkspaceId } from "../workspace-registry-model.js";
import {
  FETCH_AGENTS_SORT_KEYS,
  resolveSubscriptionId,
  buildWorkspaceCheckout,
} from "../session-helpers.js";
import { CursorError } from "../pagination/cursor.js";
import { SortablePager, type SortSpec } from "../pagination/sortable-pager.js";
import type {
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  ManagedAgent,
} from "../agent/agent-manager.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type {
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "../agent/agent-timeline-store-types.js";
import type { AgentDirectoryHandlerContext, DisposableHandler } from "./session-context.js";
import { resolveProjectDisplayName } from "../workspace-registry.js";
import type { PersistedProjectRecord } from "../workspace-registry.js";

export type { AgentDirectoryHandlerContext } from "./session-context.js";

type FetchAgentsRequestMessage = Extract<SessionInboundMessage, { type: "fetch_agents_request" }>;
type FetchAgentHistoryRequestMessage = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_history_request" }
>;
export type AgentDirectoryRequestMessage =
  | FetchAgentsRequestMessage
  | FetchAgentHistoryRequestMessage;
type FetchAgentsRequestFilter = NonNullable<FetchAgentsRequestMessage["filter"]>;
type FetchAgentsRequestSort = NonNullable<FetchAgentsRequestMessage["sort"]>[number];
type FetchAgentsResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"];
type FetchAgentsResponseEntry = FetchAgentsResponsePayload["entries"][number];
type FetchAgentsResponsePageInfo = FetchAgentsResponsePayload["pageInfo"];
type AgentUpdatePayload = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];
type AgentUpdatesFilter = FetchAgentsRequestFilter;

interface AgentUpdatesSubscriptionState {
  subscriptionId: string;
  filter?: AgentUpdatesFilter;
  isBootstrapping: boolean;
  pendingUpdatesByAgentId: Map<string, AgentUpdatePayload>;
}

interface VisibleTimelineSelectionInput {
  rows: AgentTimelineRow[];
  direction: AgentTimelineFetchDirection;
  limit: number;
  useProjectedLimit: boolean;
}

function selectVisibleTimelineRows(input: VisibleTimelineSelectionInput): AgentTimelineRow[] {
  if (input.limit === 0) return input.rows;
  if (input.useProjectedLimit) {
    return selectTimelineWindowByProjectedLimit({
      rows: input.rows,
      direction: input.direction,
      limit: input.limit,
      collapseToolLifecycle: false,
    }).selectedRows;
  }
  if (input.direction === "after") return input.rows.slice(0, input.limit);
  return input.rows.slice(Math.max(0, input.rows.length - input.limit));
}

function hasVisibleRowsAfter(input: {
  rows: AgentTimelineRow[];
  selectedRows: AgentTimelineRow[];
  direction: AgentTimelineFetchDirection;
  beforeSeq: number;
  reset: boolean;
}): boolean {
  if (input.reset || input.direction === "tail") return false;
  if (input.direction === "before") {
    return input.rows.some((row) => row.seq >= input.beforeSeq);
  }
  const lastSelectedRow = input.selectedRows[input.selectedRows.length - 1];
  const lastVisibleRow = input.rows[input.rows.length - 1];
  return (
    lastSelectedRow !== undefined &&
    lastVisibleRow !== undefined &&
    lastSelectedRow.seq < lastVisibleRow.seq
  );
}

function shouldLimitByProjectedWindow(input: {
  supportsGenerativeUi: boolean;
  projection: TimelineProjectionMode;
  direction: AgentTimelineFetchDirection;
  requestedLimit: number | undefined;
}): boolean {
  return (
    input.supportsGenerativeUi &&
    input.projection === "canonical" &&
    input.direction === "tail" &&
    typeof input.requestedLimit === "number" &&
    input.requestedLimit > 0
  );
}

class SessionRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionRequestError";
  }
}

/** Owns agent directory queries, timeline reads, pagination, and live list subscription state. */
export class AgentDirectoryHandler implements DisposableHandler {
  private readonly context: AgentDirectoryHandlerContext;

  private get agentUpdatesSubscription(): AgentUpdatesSubscriptionState | null {
    return this.context.getAgentUpdatesSubscription() as AgentUpdatesSubscriptionState | null;
  }

  private set agentUpdatesSubscription(value: AgentUpdatesSubscriptionState | null) {
    this.context.setAgentUpdatesSubscription(value);
  }

  private readonly agentsPager = new SortablePager<
    AgentSnapshotPayload,
    FetchAgentsRequestSort["key"]
  >({
    validKeys: FETCH_AGENTS_SORT_KEYS,
    defaultSort: [{ key: "updated_at", direction: "desc" }],
    label: "fetch_agents",
    getId: (agent) => agent.id,
    getSortValue: (agent, key): number | string => {
      switch (key) {
        case "status_priority":
          // Static import — a bare require() here threw ReferenceError in ESM.
          return getAgentStatusPriority({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
            requiresAttention: agent.requiresAttention,
            attentionReason: agent.attentionReason ?? null,
          });
        case "created_at":
          return Date.parse(agent.createdAt);
        case "updated_at":
          return Date.parse(agent.updatedAt);
        case "title":
          return agent.title?.toLocaleLowerCase() ?? "";
      }
    },
  });

  constructor(context: AgentDirectoryHandlerContext) {
    this.context = context;
  }

  dispose(): void {
    this.agentUpdatesSubscription = null;
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "fetch_agents_request":
        return this.handleFetchAgents(msg);
      case "fetch_agent_request":
        return this.handleFetchAgent(msg.agentId, msg.requestId);
      case "fetch_agent_history_request":
        return this.handleFetchAgentHistory(msg);
      case "fetch_recent_provider_sessions_request":
        return this.handleFetchRecentProviderSessions(msg);
      case "fetch_agent_timeline_request":
        return this.handleFetchAgentTimelineRequest(msg);
      default:
        return undefined;
    }
  }
  private async handleFetchAgents(
    request: Extract<SessionInboundMessage, { type: "fetch_agents_request" }>,
  ): Promise<void> {
    const requestedSubscriptionId = request.subscribe?.subscriptionId?.trim();
    const subscriptionId = resolveSubscriptionId(request.subscribe, requestedSubscriptionId);

    try {
      if (subscriptionId) {
        this.agentUpdatesSubscription = {
          subscriptionId,
          filter: request.filter,
          isBootstrapping: true,
          pendingUpdatesByAgentId: new Map(),
        };
      }

      const payload = await this.listFetchAgentsEntries(request);
      const snapshotUpdatedAtByAgentId = new Map<string, number>();
      for (const entry of payload.entries) {
        const parsedUpdatedAt = Date.parse(entry.agent.updatedAt);
        if (!Number.isNaN(parsedUpdatedAt)) {
          snapshotUpdatedAtByAgentId.set(entry.agent.id, parsedUpdatedAt);
        }
      }

      this.context.emit({
        type: "fetch_agents_response",
        payload: {
          requestId: request.requestId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...payload,
        },
      });

      // Background-preload the most recent active agents so the first send
      // does not pay createSession/resume cost on the critical path.
      if (request.scope === "active" && payload.entries.length > 0) {
        const preloadIds = selectAgentsForPreload(
          payload.entries.map((entry) => ({
            id: entry.agent.id,
            updatedAt: entry.agent.updatedAt,
          })),
        );
        preloadAgents(preloadIds, {
          agentManager: this.context.agentManager,
          agentStorage: this.context.agentStorage,
          logger: this.context.sessionLogger,
        });
      }

      if (subscriptionId && this.agentUpdatesSubscription?.subscriptionId === subscriptionId) {
        this.flushBootstrappedAgentUpdates({ snapshotUpdatedAtByAgentId });
      }
    } catch (error) {
      if (subscriptionId && this.agentUpdatesSubscription?.subscriptionId === subscriptionId) {
        this.agentUpdatesSubscription = null;
      }
      const code = error instanceof SessionRequestError ? error.code : "fetch_agents_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch agents";
      this.context.sessionLogger.error({ err: error }, "Failed to handle fetch_agents_request");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchAgentHistory(
    request: Extract<SessionInboundMessage, { type: "fetch_agent_history_request" }>,
  ): Promise<void> {
    try {
      const payload = await this.listFetchAgentsEntries(request);
      this.context.emit({
        type: "fetch_agent_history_response",
        payload: {
          requestId: request.requestId,
          ...payload,
        },
      });
    } catch (error) {
      const code = error instanceof SessionRequestError ? error.code : "fetch_agent_history_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch agent history";
      this.context.sessionLogger.error(
        { err: error },
        "Failed to handle fetch_agent_history_request",
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchRecentProviderSessions(
    request: Extract<SessionInboundMessage, { type: "fetch_recent_provider_sessions_request" }>,
  ): Promise<void> {
    try {
      const result = await listImportableProviderSessions({
        request,
        agentManager: this.context.agentManager,
        agentStorage: this.context.agentStorage,
        providerSnapshotManager: this.context.providerSnapshotManager,
      });
      this.context.emit({
        type: "fetch_recent_provider_sessions_response",
        payload: {
          requestId: request.requestId,
          entries: result.entries,
          ...(result.filteredAlreadyImportedCount > 0
            ? { filteredAlreadyImportedCount: result.filteredAlreadyImportedCount }
            : {}),
        },
      });
    } catch (error) {
      const code =
        error instanceof ImportSessionsRequestError
          ? error.code
          : "fetch_recent_provider_sessions_failed";
      const message =
        error instanceof Error ? error.message : "Failed to fetch recent provider sessions";
      this.context.sessionLogger.error(
        { err: error },
        "Failed to handle fetch_recent_provider_sessions_request",
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchAgent(agentIdOrIdentifier: string, requestId: string): Promise<void> {
    const resolved = await this.context.resolveAgentIdentifier(agentIdOrIdentifier);
    if (!resolved.ok) {
      this.context.emit({
        type: "fetch_agent_response",
        payload: { requestId, agent: null, project: null, error: resolved.error },
      });
      return;
    }

    const agent = await this.getAgentPayloadById(resolved.agentId);
    if (!agent) {
      this.context.emit({
        type: "fetch_agent_response",
        payload: {
          requestId,
          agent: null,
          project: null,
          error: `Agent not found: ${resolved.agentId}`,
        },
      });
      return;
    }

    const project = (await this.context.buildProjectPlacementForCwd(
      agent.cwd,
    )) as ProjectPlacementPayload | null;
    this.context.emit({
      type: "fetch_agent_response",
      payload: { requestId, agent, project, error: null },
    });
  }

  private fetchTimelineForClient(params: {
    agentId: string;
    direction: AgentTimelineFetchDirection;
    cursor: AgentTimelineCursor | undefined;
    limit: number | undefined;
    useProjectedLimit: boolean;
  }): AgentTimelineFetchResult {
    if (this.context.supports(CLIENT_CAPS.generativeUi)) {
      return this.context.agentManager.fetchTimeline(params.agentId, {
        direction: params.direction,
        cursor: params.cursor,
        limit: params.limit,
      });
    }

    // AgentManager timelines are already fully resident in InMemoryAgentTimelineStore.
    // This creates one finite snapshot, then filters/selects without file I/O or mutation.
    const completeTimeline = this.context.agentManager.fetchTimeline(params.agentId, {
      direction: "tail",
      limit: 0,
    });
    const visibleRows = completeTimeline.rows.filter((row) => row.item.type !== "generative_ui");
    const staleCursor =
      params.cursor !== undefined && params.cursor.epoch !== completeTimeline.epoch;
    const gap =
      !staleCursor &&
      params.direction === "after" &&
      params.cursor !== undefined &&
      completeTimeline.rows.length > 0 &&
      params.cursor.seq < completeTimeline.window.minSeq - 1;
    const reset = staleCursor || gap;
    const beforeSeq = params.cursor?.seq ?? completeTimeline.window.nextSeq;
    const eligibleRows = reset
      ? visibleRows
      : visibleRows.filter((row) => {
          if (params.direction === "after") return row.seq > (params.cursor?.seq ?? 0);
          if (params.direction === "before") return row.seq < beforeSeq;
          return true;
        });
    const requestedLimit = params.limit === undefined ? 200 : Math.max(0, Math.floor(params.limit));
    const selectionDirection = reset ? "tail" : params.direction;
    const selectedRows = selectVisibleTimelineRows({
      rows: eligibleRows,
      direction: selectionDirection,
      limit: requestedLimit,
      useProjectedLimit: params.useProjectedLimit,
    });
    const firstVisibleRow = visibleRows[0];
    const lastVisibleRow = visibleRows[visibleRows.length - 1];
    const firstSelectedRow = selectedRows[0];

    return {
      epoch: completeTimeline.epoch,
      direction: params.direction,
      reset,
      staleCursor,
      gap,
      window: {
        minSeq: firstVisibleRow?.seq ?? 0,
        maxSeq: lastVisibleRow?.seq ?? 0,
        nextSeq: completeTimeline.window.nextSeq,
      },
      rows: selectedRows,
      hasOlder:
        firstSelectedRow !== undefined &&
        firstVisibleRow !== undefined &&
        firstSelectedRow.seq > firstVisibleRow.seq,
      hasNewer: hasVisibleRowsAfter({
        rows: visibleRows,
        selectedRows,
        direction: selectionDirection,
        beforeSeq,
        reset,
      }),
    };
  }

  private loadProjectedTimelineWindow(params: {
    agentId: string;
    direction: AgentTimelineFetchDirection;
    cursor: AgentTimelineCursor | undefined;
    requestedLimit: number;
    timeline: ReturnType<
      typeof import("../agent/agent-manager.js").AgentManager.prototype.fetchTimeline
    >;
  }): {
    timeline: ReturnType<
      typeof import("../agent/agent-manager.js").AgentManager.prototype.fetchTimeline
    >;
    selectedRows: ReturnType<typeof selectTimelineWindowByProjectedLimit>["selectedRows"];
    minSeq: number | null;
    maxSeq: number | null;
  } {
    const { agentId, direction, cursor, requestedLimit } = params;
    let timeline = params.timeline;
    const projectedLimit = Math.max(1, Math.floor(requestedLimit));
    let fetchLimit = projectedLimit;
    let projectedWindow = selectTimelineWindowByProjectedLimit({
      rows: timeline.rows,
      direction,
      limit: projectedLimit,
      collapseToolLifecycle: false,
    });

    while (timeline.hasOlder) {
      const needsMoreProjectedEntries = projectedWindow.projectedEntries.length < projectedLimit;
      const firstLoadedRow = timeline.rows[0];
      const firstSelectedRow = projectedWindow.selectedRows[0];
      const startsAtLoadedBoundary =
        firstLoadedRow != null &&
        firstSelectedRow != null &&
        firstSelectedRow.seq === firstLoadedRow.seq;
      const boundaryIsAssistantChunk =
        startsAtLoadedBoundary && firstLoadedRow.item.type === "assistant_message";

      if (!needsMoreProjectedEntries && !boundaryIsAssistantChunk) {
        break;
      }

      const maxRows = Math.max(0, timeline.window.maxSeq - timeline.window.minSeq + 1);
      const nextFetchLimit = Math.min(maxRows, fetchLimit * 2);
      if (nextFetchLimit <= fetchLimit) {
        break;
      }

      fetchLimit = nextFetchLimit;
      timeline = this.context.agentManager.fetchTimeline(agentId, {
        direction,
        cursor,
        limit: fetchLimit,
      });
      projectedWindow = selectTimelineWindowByProjectedLimit({
        rows: timeline.rows,
        direction,
        limit: projectedLimit,
        collapseToolLifecycle: false,
      });
    }

    return {
      timeline,
      selectedRows: projectedWindow.selectedRows,
      minSeq: projectedWindow.minSeq,
      maxSeq: projectedWindow.maxSeq,
    };
  }

  private async handleFetchAgentTimelineRequest(
    msg: Extract<SessionInboundMessage, { type: "fetch_agent_timeline_request" }>,
  ): Promise<void> {
    const direction: AgentTimelineFetchDirection = msg.direction ?? (msg.cursor ? "after" : "tail");
    const projection: TimelineProjectionMode = msg.projection ?? "projected";
    const requestedLimit = msg.limit;
    const limit = requestedLimit ?? (direction === "after" ? 0 : undefined);
    const shouldLimitProjectedWindow = shouldLimitByProjectedWindow({
      supportsGenerativeUi: this.context.supports(CLIENT_CAPS.generativeUi),
      projection,
      direction,
      requestedLimit,
    });
    const cursor: AgentTimelineCursor | undefined = msg.cursor
      ? {
          epoch: msg.cursor.epoch,
          seq: msg.cursor.seq,
        }
      : undefined;

    try {
      const snapshot = await ensureAgentLoaded(msg.agentId, {
        agentManager: this.context.agentManager,
        agentStorage: this.context.agentStorage,
        logger: this.context.sessionLogger,
      });
      // Background hydrate may still be seeding; wait briefly so first paint can
      // include history without blocking the send path.
      const hydrating = await this.waitForHydrationBriefly(msg.agentId);
      const agentPayload = await this.buildAgentPayload(snapshot);

      let timeline = this.fetchTimelineForClient({
        agentId: msg.agentId,
        direction,
        cursor,
        limit:
          shouldLimitProjectedWindow && typeof requestedLimit === "number"
            ? Math.max(1, Math.floor(requestedLimit))
            : limit,
        useProjectedLimit:
          projection === "canonical" &&
          direction === "tail" &&
          typeof requestedLimit === "number" &&
          requestedLimit > 0,
      });
      let hasOlder = timeline.hasOlder;
      let hasNewer = timeline.hasNewer;
      let startCursor: { epoch: string; seq: number } | null = null;
      let endCursor: { epoch: string; seq: number } | null = null;
      let entries: ReturnType<typeof projectTimelineRows>;

      if (shouldLimitProjectedWindow) {
        const projectedResult = this.loadProjectedTimelineWindow({
          agentId: msg.agentId,
          direction,
          cursor,
          requestedLimit: requestedLimit ?? 1,
          timeline,
        });
        timeline = projectedResult.timeline;
        entries = projectTimelineRows({ rows: projectedResult.selectedRows, mode: projection });
        if (projectedResult.minSeq !== null && projectedResult.maxSeq !== null) {
          startCursor = { epoch: timeline.epoch, seq: projectedResult.minSeq };
          endCursor = { epoch: timeline.epoch, seq: projectedResult.maxSeq };
          hasOlder = projectedResult.minSeq > timeline.window.minSeq;
          hasNewer = false;
        }
      } else {
        const firstRow = timeline.rows[0];
        const lastRow = timeline.rows[timeline.rows.length - 1];
        startCursor = firstRow ? { epoch: timeline.epoch, seq: firstRow.seq } : null;
        endCursor = lastRow ? { epoch: timeline.epoch, seq: lastRow.seq } : null;
        entries = projectTimelineRows({ rows: timeline.rows, mode: projection });
      }

      this.context.emit({
        type: "fetch_agent_timeline_response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          agent: agentPayload,
          direction,
          projection,
          epoch: timeline.epoch,
          reset: timeline.reset,
          staleCursor: timeline.staleCursor,
          gap: timeline.gap,
          window: timeline.window,
          startCursor,
          endCursor,
          hasOlder,
          hasNewer,
          entries: entries.map((entry) => ({
            provider: snapshot.provider,
            item: entry.item,
            timestamp: entry.timestamp,
            seqStart: entry.seqStart,
            seqEnd: entry.seqEnd,
            sourceSeqRanges: entry.sourceSeqRanges,
            collapsed: this.context.supports(CLIENT_CAPS.reasoningMergeEnum)
              ? entry.collapsed
              : entry.collapsed.filter((value) => value !== "reasoning_merge"),
          })),
          error: null,
          hydrating,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId: msg.agentId },
        "Failed to handle fetch_agent_timeline_request",
      );
      this.context.emit({
        type: "fetch_agent_timeline_response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          agent: null,
          direction,
          projection,
          epoch: "",
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
          startCursor: null,
          endCursor: null,
          hasOlder: false,
          hasNewer: false,
          entries: [],
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private flushBootstrappedAgentUpdates(options?: {
    snapshotUpdatedAtByAgentId?: Map<string, number>;
  }): void {
    this.context.flushBootstrappedAgentUpdates(options);
  }

  private async buildAgentPayload(agent: ManagedAgent): Promise<AgentSnapshotPayload> {
    return this.context.buildAgentPayload(agent) as Promise<AgentSnapshotPayload>;
  }

  private buildStoredAgentPayload(record: StoredAgentRecord): AgentSnapshotPayload {
    return this.context.buildStoredAgentPayload(record) as AgentSnapshotPayload;
  }

  private async getAgentPayloadById(agentId: string): Promise<AgentSnapshotPayload | null> {
    return this.context.getAgentPayloadById(agentId) as Promise<AgentSnapshotPayload | null>;
  }

  private async listAgentPayloads(filter?: {
    labels?: Record<string, string>;
    includeUnavailablePersisted?: boolean;
  }): Promise<AgentSnapshotPayload[]> {
    return this.context.listAgentPayloads(filter) as Promise<AgentSnapshotPayload[]>;
  }

  private matchesAgentFilter(options: {
    agent: AgentSnapshotPayload;
    project: ProjectPlacementPayload;
    filter?: AgentUpdatesFilter;
  }): boolean {
    return this.context.matchesAgentFilter(options);
  }

  private bufferOrEmitAgentUpdate(
    subscription: AgentUpdatesSubscriptionState,
    payload: AgentUpdatePayload,
  ): void {
    this.context.bufferOrEmitAgentUpdate(subscription, payload);
  }

  private async buildProjectPlacementForCwd(
    cwd: string,
    options?: { refreshGit?: boolean; fallback?: boolean },
  ): Promise<ProjectPlacementPayload | null> {
    return this.context.buildProjectPlacementForCwd(
      cwd,
      options,
    ) as Promise<ProjectPlacementPayload | null>;
  }

  async publishAgentUpdate(agent: ManagedAgent): Promise<void> {
    try {
      const subscription = this.agentUpdatesSubscription;
      const payload = await this.buildAgentPayload(agent);
      if (subscription) {
        const project = await this.buildProjectPlacementForCwd(payload.cwd, {
          refreshGit: false,
          fallback: true,
        });
        if (!project) {
          throw new Error(`Workspace not found for agent ${payload.id}`);
        }
        const matches = this.matchesAgentFilter({
          agent: payload,
          project,
          filter: subscription.filter,
        });

        this.bufferOrEmitAgentUpdate(
          subscription,
          matches
            ? { kind: "upsert", agent: payload, project }
            : { kind: "remove", agentId: payload.id },
        );
      }

      await this.context.emitWorkspaceUpdateForCwd(payload.cwd);
    } catch (error) {
      this.context.sessionLogger.error({ err: error }, "Failed to emit agent update");
    }
  }

  publishAgentRemoval(agentId: string): void {
    const subscription = this.agentUpdatesSubscription;
    if (!subscription) {
      return;
    }
    this.bufferOrEmitAgentUpdate(subscription, { kind: "remove", agentId });
  }

  async publishStoredAgentUpdate(record: StoredAgentRecord): Promise<void> {
    const subscription = this.agentUpdatesSubscription;
    if (!subscription) {
      return;
    }
    const payload = this.buildStoredAgentPayload(record);
    const project = await this.buildProjectPlacementForCwd(payload.cwd);
    if (project) {
      const matches = this.matchesAgentFilter({
        agent: payload,
        project,
        filter: subscription.filter,
      });
      this.bufferOrEmitAgentUpdate(
        subscription,
        matches
          ? { kind: "upsert", agent: payload, project }
          : { kind: "remove", agentId: payload.id },
      );
    } else {
      this.bufferOrEmitAgentUpdate(subscription, { kind: "remove", agentId: payload.id });
    }
    await this.context.emitWorkspaceUpdateForCwd(payload.cwd);
  }
  private async buildActiveProjectPlacementsByWorkspaceCwd(): Promise<
    Map<string, ProjectPlacementPayload>
  > {
    const [persistedWorkspaces, persistedProjects] = await Promise.all([
      this.context.workspaceRegistry.list(),
      this.context.projectRegistry.list(),
    ]);
    const activeProjects = new Map(
      persistedProjects
        .filter((project) => !project.archivedAt)
        .map((project) => [project.projectId, project] as const),
    );
    const placementsByCwd = new Map<string, ProjectPlacementPayload>();

    const pairs = persistedWorkspaces.flatMap((workspace) => {
      if (workspace.archivedAt) return [];
      const project = activeProjects.get(workspace.projectId);
      if (!project) return [];
      return [{ workspace, project }];
    });
    const placements = await Promise.all(
      pairs.map(({ workspace, project }) =>
        this.buildProjectPlacementForWorkspace(workspace, project),
      ),
    );
    for (let i = 0; i < pairs.length; i += 1) {
      placementsByCwd.set(normalizePersistedWorkspaceId(pairs[i].workspace.cwd), placements[i]);
    }

    return placementsByCwd;
  }

  private async buildProjectPlacementForWorkspace(
    workspace: import("../workspace-registry.js").PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<ProjectPlacementPayload> {
    const project = projectRecord ?? (await this.context.projectRegistry.get(workspace.projectId));
    if (!project) {
      throw new Error(`Project not found for workspace ${workspace.workspaceId}`);
    }
    const checkout = buildWorkspaceCheckout(workspace, project);
    return {
      projectKey: project.projectId,
      projectName: resolveProjectDisplayName(project),
      checkout,
    };
  }

  private async collectFetchAgentsEntries(params: {
    candidates: AgentSnapshotPayload[];
    limit: number;
    getPlacement: (cwd: string) => Promise<ProjectPlacementPayload | null>;
    filter: AgentUpdatesFilter | undefined;
  }): Promise<FetchAgentsResponseEntry[]> {
    const { candidates, limit, getPlacement, filter } = params;
    const matchedEntries: FetchAgentsResponseEntry[] = [];
    const batchSize = 25;
    for (
      let start = 0;
      start < candidates.length && matchedEntries.length <= limit;
      start += batchSize
    ) {
      const batch = candidates.slice(start, start + batchSize);
      const batchEntries = await Promise.all(
        batch.map(async (agent) => {
          const project = await getPlacement(agent.cwd);
          return project ? { agent, project } : null;
        }),
      );
      for (const entry of batchEntries) {
        if (!entry) {
          continue;
        }
        if (
          !this.matchesAgentFilter({
            agent: entry.agent,
            project: entry.project,
            filter,
          })
        ) {
          continue;
        }
        matchedEntries.push(entry);
        if (matchedEntries.length > limit) {
          break;
        }
      }
    }
    return matchedEntries;
  }

  /**
   * Fetch agents (live and/or persisted), paginate, and return matching entries
   * with their project placements. Used by both handleFetchAgents and
   * handleFetchAgentHistory.
   */
  async listFetchAgentsEntries(request: AgentDirectoryRequestMessage): Promise<{
    entries: FetchAgentsResponseEntry[];
    pageInfo: FetchAgentsResponsePageInfo;
  }> {
    const filter =
      request.type === "fetch_agent_history_request" &&
      request.filter?.includeArchived === undefined
        ? { ...request.filter, includeArchived: true }
        : request.filter;
    const scope = request.type === "fetch_agents_request" ? request.scope : undefined;
    const sort = this.agentsPager.normalizeSort(request.sort);

    let agents = await this.listAgentPayloads({
      labels: filter?.labels,
      includeUnavailablePersisted: request.type === "fetch_agent_history_request",
    });
    const activePlacementsByCwd =
      scope === "active" ? await this.buildActiveProjectPlacementsByWorkspaceCwd() : null;
    if (activePlacementsByCwd) {
      agents = agents.filter(
        (agent) =>
          !agent.archivedAt && activePlacementsByCwd.has(normalizePersistedWorkspaceId(agent.cwd)),
      );
    }

    const placementByCwd = new Map<string, Promise<ProjectPlacementPayload | null>>();
    const getPlacement = (cwd: string): Promise<ProjectPlacementPayload | null> => {
      if (activePlacementsByCwd) {
        return Promise.resolve(
          activePlacementsByCwd.get(normalizePersistedWorkspaceId(cwd)) ?? null,
        );
      }
      const existing = placementByCwd.get(cwd);
      if (existing) {
        return existing;
      }
      const placementPromise = this.context.buildProjectPlacementForCwd(cwd, {
        refreshGit: false,
      }) as Promise<ProjectPlacementPayload | null>;
      placementByCwd.set(cwd, placementPromise);
      return placementPromise;
    };

    let candidates = [...agents];
    candidates.sort((left, right) => this.agentsPager.compare(left, right, sort));
    const cursorToken = request.page?.cursor;
    if (cursorToken) {
      const cursor = this.decodeAgentCursor(cursorToken, sort);
      candidates = candidates.filter(
        (agent) => this.agentsPager.compareWithCursor(agent, cursor, sort) > 0,
      );
    }

    const limit = request.page?.limit ?? 200;

    const matchedEntries = await this.collectFetchAgentsEntries({
      candidates,
      limit,
      getPlacement,
      filter,
    });

    const pagedEntries = matchedEntries.slice(0, limit);
    const hasMore = matchedEntries.length > limit;
    const nextCursor =
      hasMore && pagedEntries.length > 0
        ? this.agentsPager.encode(pagedEntries[pagedEntries.length - 1].agent, sort)
        : null;

    return {
      entries: pagedEntries,
      pageInfo: {
        nextCursor,
        prevCursor: request.page?.cursor ?? null,
        hasMore,
      },
    };
  }

  private decodeAgentCursor(token: string, sort: SortSpec<FetchAgentsRequestSort["key"]>[]) {
    try {
      return this.agentsPager.decode(token, sort);
    } catch (error) {
      if (error instanceof CursorError) {
        throw new SessionRequestError("invalid_cursor", error.message);
      }
      throw error;
    }
  }

  /**
   * Wait briefly for background provider-history hydration.
   * @returns true when hydration is still in flight after the wait window
   */
  private async waitForHydrationBriefly(agentId: string, timeoutMs = 800): Promise<boolean> {
    const state = this.context.agentManager.getHydrationState(agentId);
    if (state !== "hydrating") {
      return false;
    }
    const pending = this.context.agentManager.getHydrationPromise(agentId);
    if (!pending) {
      return this.context.agentManager.getHydrationState(agentId) === "hydrating";
    }
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
    return this.context.agentManager.getHydrationState(agentId) === "hydrating";
  }
}
