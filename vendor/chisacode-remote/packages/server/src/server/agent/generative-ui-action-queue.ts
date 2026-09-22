/** Validated generative UI action accepted by the manager-owned queue. */
export interface GenerativeUiQueuedAction {
  instanceId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

export const MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES = 64 * 1024;
export const MAX_GENERATIVE_UI_QUEUE_BATCHES = 32;
export const MAX_GENERATIVE_UI_QUEUE_ACTIONS = 128;
export const MAX_GENERATIVE_UI_QUEUE_RETAINED_BYTES = 512 * 1024;

/** Raised when one action payload exceeds the shared serialized payload limit. */
export class GenerativeUiActionPayloadTooLargeError extends Error {
  readonly code = "GENERATIVE_UI_ACTION_PAYLOAD_TOO_LARGE";

  constructor() {
    super("Generative UI action payload is too large");
    this.name = "GenerativeUiActionPayloadTooLargeError";
  }
}

/** Returns the UTF-8 byte length of a serialized generative UI action payload. */
export function getGenerativeUiActionPayloadBytes(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new GenerativeUiActionPayloadTooLargeError();
  return Buffer.byteLength(serialized, "utf8");
}
/** Raised when accepting the newest action would exceed a per-agent queue budget. */
export class GenerativeUiActionQueueFullError extends Error {
  readonly code = "GENERATIVE_UI_ACTION_QUEUE_FULL";

  constructor() {
    super("Generative UI action queue is full");
    this.name = "GenerativeUiActionQueueFullError";
  }
}

type AgentStatus = "initializing" | "idle" | "running" | "error" | "closed" | string;

interface QueueLogMetadata {
  agentId: string;
  actionCount: number;
  batchCount: number;
  reason: "agent_unavailable" | "dispatch_failed";
}

interface GenerativeUiActionQueueOptions {
  getAgentStatus: (agentId: string) => AgentStatus | undefined;
  dispatchPrompt: (agentId: string, prompt: string) => Promise<void>;
  log: (metadata: QueueLogMetadata) => void;
}

interface ActionBatch {
  actions: GenerativeUiQueuedAction[];
  actionBytes: number[];
  retainedBytes: number;
  changeIndexes: Map<string, number>;
  closed: boolean;
}

interface AgentQueueState {
  batches: ActionBatch[];
  inFlight: ActionBatch | null;
  batchCount: number;
  actionCount: number;
  retainedBytes: number;
  scheduled: boolean;
  dispatching: boolean;
}

function isUnavailableStatus(status: AgentStatus | undefined): boolean {
  return status === undefined || status === "closed" || status === "error";
}

function createBatch(): ActionBatch {
  return {
    actions: [],
    actionBytes: [],
    retainedBytes: 0,
    changeIndexes: new Map(),
    closed: false,
  };
}

function createState(): AgentQueueState {
  return {
    batches: [],
    inFlight: null,
    batchCount: 0,
    actionCount: 0,
    retainedBytes: 0,
    scheduled: false,
    dispatching: false,
  };
}

function retainedBytes(action: GenerativeUiQueuedAction): number {
  return Buffer.byteLength(JSON.stringify(action), "utf8");
}

function changeKey(action: GenerativeUiQueuedAction): string | null {
  if (action.action !== "change" || typeof action.payload !== "object" || action.payload === null) {
    return null;
  }
  const field = (action.payload as Record<string, unknown>).field;
  return typeof field === "string" ? `${action.instanceId}\u0000${field}` : null;
}

function assertWithinBudget(projected: { batches: number; actions: number; bytes: number }): void {
  if (
    projected.batches > MAX_GENERATIVE_UI_QUEUE_BATCHES ||
    projected.actions > MAX_GENERATIVE_UI_QUEUE_ACTIONS ||
    projected.bytes > MAX_GENERATIVE_UI_QUEUE_RETAINED_BYTES
  ) {
    throw new GenerativeUiActionQueueFullError();
  }
}

function formatPrompt(actions: readonly GenerativeUiQueuedAction[]): string {
  return [
    "User interacted with generative UI components.",
    `Actions: ${JSON.stringify(actions)}`,
  ].join("\n");
}

/**
 * Coalesces generative UI actions per agent without interrupting active turns.
 * Failed batches are dropped after one start attempt; later batches continue independently.
 */
export class GenerativeUiActionQueue {
  private readonly states = new Map<string, AgentQueueState>();

  constructor(private readonly options: GenerativeUiActionQueueOptions) {}

  enqueue(agentId: string, action: GenerativeUiQueuedAction): void {
    if (
      getGenerativeUiActionPayloadBytes(action.payload) > MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES
    ) {
      throw new GenerativeUiActionPayloadTooLargeError();
    }
    const state = this.states.get(agentId) ?? createState();
    const existingBatch = state.batches.at(-1);
    const needsBatch = !existingBatch || existingBatch.closed;
    const batch = needsBatch ? createBatch() : existingBatch;

    const bytes = retainedBytes(action);
    const key = changeKey(action);
    const existingIndex = key === null ? undefined : batch.changeIndexes.get(key);
    const previousBytes = existingIndex === undefined ? 0 : batch.actionBytes[existingIndex];
    const projected = {
      batches: state.batchCount + (needsBatch ? 1 : 0),
      actions: state.actionCount + (existingIndex === undefined ? 1 : 0),
      bytes: state.retainedBytes - previousBytes + bytes,
    };
    assertWithinBudget(projected);

    if (needsBatch) {
      state.batches.push(batch);
      state.batchCount += 1;
    }
    if (existingIndex !== undefined) {
      batch.actions[existingIndex] = action;
      batch.actionBytes[existingIndex] = bytes;
      batch.retainedBytes += bytes - previousBytes;
      state.retainedBytes += bytes - previousBytes;
    } else {
      if (key !== null) batch.changeIndexes.set(key, batch.actions.length);
      batch.actions.push(action);
      batch.actionBytes.push(bytes);
      batch.retainedBytes += bytes;
      state.actionCount += 1;
      state.retainedBytes += bytes;
    }
    if (action.action === "submit") batch.closed = true;
    this.states.set(agentId, state);
    this.scheduleIfIdle(agentId, state);
  }

  onAgentTerminal(agentId: string): void {
    const state = this.states.get(agentId);
    if (state) this.scheduleIfIdle(agentId, state);
  }

  clearAgent(agentId: string): void {
    const state = this.states.get(agentId);
    if (state) this.dropAll(agentId, state, "agent_unavailable");
  }

  hasPending(agentId: string): boolean {
    return (this.states.get(agentId)?.batchCount ?? 0) > 0;
  }

  private scheduleIfIdle(agentId: string, state: AgentQueueState): void {
    if (state.scheduled || state.dispatching || state.batches.length === 0) return;
    const status = this.options.getAgentStatus(agentId);
    if (status !== "idle" && !isUnavailableStatus(status)) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      void this.dispatchNext(agentId, state);
    });
  }

  private async dispatchNext(agentId: string, state: AgentQueueState): Promise<void> {
    if (this.states.get(agentId) !== state || state.dispatching) return;
    const status = this.options.getAgentStatus(agentId);
    if (status !== "idle") {
      if (isUnavailableStatus(status)) this.dropAll(agentId, state, "agent_unavailable");
      return;
    }
    const batch = state.batches.shift();
    if (!batch) return;
    state.inFlight = batch;
    state.dispatching = true;
    try {
      await this.options.dispatchPrompt(agentId, formatPrompt(batch.actions));
    } catch {
      this.options.log({
        agentId,
        actionCount: batch.actions.length,
        batchCount: state.batchCount,
        reason: "dispatch_failed",
      });
    } finally {
      this.releaseInFlight(state, batch);
    }
    if (this.states.get(agentId) !== state) return;
    if (state.batchCount === 0) {
      this.states.delete(agentId);
      return;
    }
    const nextStatus = this.options.getAgentStatus(agentId);
    if (isUnavailableStatus(nextStatus)) {
      this.dropAll(agentId, state, "agent_unavailable");
      return;
    }
    this.scheduleIfIdle(agentId, state);
  }

  private releaseInFlight(state: AgentQueueState, batch: ActionBatch): void {
    if (state.inFlight !== batch) return;
    state.inFlight = null;
    state.dispatching = false;
    state.batchCount -= 1;
    state.actionCount -= batch.actions.length;
    state.retainedBytes -= batch.retainedBytes;
  }

  private dropAll(agentId: string, state: AgentQueueState, reason: "agent_unavailable"): void {
    this.states.delete(agentId);
    this.options.log({
      agentId,
      actionCount: state.actionCount,
      batchCount: state.batchCount,
      reason,
    });
  }
}
