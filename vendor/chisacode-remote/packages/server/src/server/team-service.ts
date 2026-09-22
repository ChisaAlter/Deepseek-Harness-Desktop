/**
 * Team Service — Lead/Worker multi-agent collaboration.
 *
 * A Lead session delegates tasks to Worker sessions. Workers are full
 * persistent sessions (not disposable subagents) with their own model,
 * effort, and context. The Lead dispatches tasks, Workers execute and
 * report back. Messages queue when Workers are busy.
 *
 * Design adapted from Cindy's Orca architecture (Apache-2.0):
 * - Four-service separation: Lifecycle, WorkerCreation, Team, Dispatcher
 * - Soft/hard worker limits
 * - Message queue with list/update/cancel before consumption
 * - MCP control surface (16 tools in Cindy; core subset here)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type WorkerStatus = "idle" | "running" | "done" | "error" | "archived";

export type OrcaRole = "lead" | "worker";

export interface TeamState {
  id: string;
  leadSessionId: string;
  status: "active" | "completed" | "cancelled";
  createdAt: number;
  updatedAt: number;
}

export interface WorkerState {
  id: string;
  teamId: string;
  sessionId: string;
  role: string;
  label: string;
  status: WorkerStatus;
  focused: boolean;
  idleSince: number | null;
  createdAt: number;
}

export interface QueuedMessage {
  id: string;
  workerId: string;
  content: string;
  source: "lead";
  queuedAt: number;
  consumed: boolean;
}

export interface WorkerLimits {
  /** Warn when this many workers exist (still allow creation). */
  softLimit: number;
  /** Reject creation at this count. */
  hardLimit: number;
}

export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  softLimit: 5,
  hardLimit: 10,
};

// ── Error codes ────────────────────────────────────────────────────────────

export type TeamErrorCode =
  | "TEAM_NOT_FOUND"
  | "ALREADY_HAS_TEAM"
  | "DUPLICATE_LABEL"
  | "WORKER_LIMIT_HARD_EXCEEDED"
  | "WORKER_NOT_FOUND"
  | "QUEUED_MESSAGE_NOT_FOUND"
  | "MESSAGE_ALREADY_CONSUMED"
  | "INVALID_PARAMS";

export class TeamError extends Error {
  constructor(
    public readonly code: TeamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

// ── Team lifecycle ─────────────────────────────────────────────────────────

/** Create a new team with the given lead session. */
export function createTeam(id: string, leadSessionId: string, now: number): TeamState {
  return {
    id,
    leadSessionId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** End a team (complete or cancel). */
export function endTeam(
  team: TeamState,
  status: "completed" | "cancelled",
  now: number,
): TeamState {
  return { ...team, status, updatedAt: now };
}

// ── Worker management ──────────────────────────────────────────────────────

export interface CreateWorkerInput {
  id: string;
  teamId: string;
  sessionId: string;
  role?: string;
  label: string;
}

/**
 * Validate and create a worker within a team.
 * Checks: label uniqueness, hard limit.
 */
export function createWorker(
  input: CreateWorkerInput,
  existingWorkers: WorkerState[],
  limits: WorkerLimits = DEFAULT_WORKER_LIMITS,
  now: number,
): { worker: WorkerState; softLimitExceeded: boolean } {
  // Check hard limit (archived workers don't count)
  const activeCount = existingWorkers.filter((w) => w.status !== "archived").length;
  if (activeCount >= limits.hardLimit) {
    throw new TeamError(
      "WORKER_LIMIT_HARD_EXCEEDED",
      `Worker limit reached (${activeCount}/${limits.hardLimit}). Archive workers or increase the limit.`,
    );
  }

  // Check label uniqueness (case-insensitive, among non-archived)
  const labelLower = input.label.toLowerCase();
  if (
    existingWorkers.some((w) => w.status !== "archived" && w.label.toLowerCase() === labelLower)
  ) {
    throw new TeamError(
      "DUPLICATE_LABEL",
      `Worker label "${input.label}" already exists in this team.`,
    );
  }

  const worker: WorkerState = {
    id: input.id,
    teamId: input.teamId,
    sessionId: input.sessionId,
    role: input.role ?? "developer",
    label: input.label,
    status: "idle",
    focused: existingWorkers.filter((w) => w.status !== "archived").length === 0,
    idleSince: now,
    createdAt: now,
  };

  return { worker, softLimitExceeded: activeCount + 1 > limits.softLimit };
}

/** Set a worker's status. */
export function setWorkerStatus(
  worker: WorkerState,
  status: WorkerStatus,
  now: number,
): WorkerState {
  return {
    ...worker,
    status,
    idleSince: status === "idle" ? now : null,
    focused: status === "archived" ? false : worker.focused,
  };
}

/** Set the focused worker (unfocuses all others in the team). */
export function setFocusedWorker(workers: WorkerState[], workerId: string): WorkerState[] {
  return workers.map((w) => ({
    ...w,
    focused: w.id === workerId && w.status !== "archived",
  }));
}

// ── Message queue ──────────────────────────────────────────────────────────

/** Queue a message for a worker. */
export function queueMessage(
  id: string,
  workerId: string,
  content: string,
  now: number,
): QueuedMessage {
  return {
    id,
    workerId,
    content,
    source: "lead",
    queuedAt: now,
    consumed: false,
  };
}

/** List unconsumed queued messages for a worker. */
export function listQueuedMessages(queue: QueuedMessage[], workerId: string): QueuedMessage[] {
  return queue.filter((m) => m.workerId === workerId && !m.consumed);
}

/** Update a queued message's content (before consumption). */
export function updateQueuedMessage(
  queue: QueuedMessage[],
  messageId: string,
  newContent: string,
): QueuedMessage[] {
  return queue.map((m) => {
    if (m.id !== messageId) return m;
    if (m.consumed) {
      throw new TeamError("MESSAGE_ALREADY_CONSUMED", "Cannot update a consumed message.");
    }
    return { ...m, content: newContent };
  });
}

/** Cancel (remove) a queued message (before consumption). */
export function cancelQueuedMessage(queue: QueuedMessage[], messageId: string): QueuedMessage[] {
  const target = queue.find((m) => m.id === messageId);
  if (!target) {
    throw new TeamError("QUEUED_MESSAGE_NOT_FOUND", `Queued message "${messageId}" not found.`);
  }
  if (target.consumed) {
    throw new TeamError("MESSAGE_ALREADY_CONSUMED", "Cannot cancel a consumed message.");
  }
  return queue.filter((m) => m.id !== messageId);
}

/** Mark a message as consumed (worker picked it up). */
export function consumeMessage(queue: QueuedMessage[], messageId: string): QueuedMessage[] {
  return queue.map((m) => (m.id === messageId ? { ...m, consumed: true } : m));
}
