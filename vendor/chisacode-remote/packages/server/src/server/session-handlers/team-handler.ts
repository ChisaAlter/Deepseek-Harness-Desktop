/**
 * TeamHandler — Lead/Worker multi-agent collaboration RPC handler.
 *
 * Manages team lifecycle, worker creation, message queue, and focus switching.
 */

import { randomUUID } from "node:crypto";
import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import {
  createTeam,
  endTeam,
  createWorker,
  setWorkerStatus,
  setFocusedWorker,
  queueMessage,
  listQueuedMessages,
  cancelQueuedMessage,
  consumeMessage,
  TeamError,
  type TeamState,
  type WorkerState,
  type QueuedMessage,
} from "../team-service.js";

/** In-memory team store. */
export class TeamManager {
  private team: TeamState | null = null;
  private workers: WorkerState[] = [];
  private messageQueue: QueuedMessage[] = [];
  /**
   * Per-worker serialization chains for queue mutations. Without this, a
   * concurrent enqueue (lead sends a message) and drain (worker went idle)
   * race on `messageQueue` reassignment: the enqueue pushes onto the old array
   * reference, then the drain's `consumeMessage` reassigns to a new array and
   * the enqueued message is silently lost.
   */
  private readonly queueLocks = new Map<string, Promise<unknown>>();

  getTeam(): TeamState | null {
    return this.team;
  }

  getWorkers(): WorkerState[] {
    return this.workers;
  }

  startTeam(leadSessionId: string, now: number): TeamState {
    if (this.team && this.team.status === "active") {
      throw new TeamError("ALREADY_HAS_TEAM", "This session already has an active team.");
    }
    this.team = createTeam(randomUUID(), leadSessionId, now);
    this.workers = [];
    this.messageQueue = [];
    return this.team;
  }

  endActiveTeam(status: "completed" | "cancelled", now: number): TeamState {
    if (!this.team) {
      throw new TeamError("TEAM_NOT_FOUND", "No active team.");
    }
    this.team = endTeam(this.team, status, now);
    return this.team;
  }

  addWorker(input: { id: string; sessionId: string; role?: string; label: string }, now: number) {
    if (!this.team || this.team.status !== "active") {
      throw new TeamError("TEAM_NOT_FOUND", "No active team.");
    }
    const result = createWorker({ ...input, teamId: this.team.id }, this.workers, undefined, now);
    this.workers.push(result.worker);
    return result;
  }

  archiveWorker(workerId: string, now: number): WorkerState {
    const worker = this.workers.find((w) => w.id === workerId);
    if (!worker) {
      throw new TeamError("WORKER_NOT_FOUND", `Worker "${workerId}" not found.`);
    }
    const updated = setWorkerStatus(worker, "archived", now);
    this.workers = this.workers.map((w) => (w.id === workerId ? updated : w));
    return updated;
  }

  switchFocus(workerId: string): WorkerState[] {
    this.workers = setFocusedWorker(this.workers, workerId);
    return this.workers;
  }

  getWorker(workerId: string): WorkerState | null {
    return this.workers.find((w) => w.id === workerId) ?? null;
  }

  /**
   * Returns the live agent sessionId backing a worker (if any), so callers can
   * terminate the agent when the worker is archived or the team ends. Workers
   * created without a real spawn (no spawnWorker callback) have a synthetic
   * sessionId indistinguishable from a real one — callers should only terminate
   * when spawnWorker was used. We expose the sessionId and let the caller decide.
   */
  getWorkerSessionId(workerId: string): string | null {
    return this.workers.find((w) => w.id === workerId)?.sessionId ?? null;
  }

  /** SessionIds of all non-archived workers, for endActiveTeam teardown. */
  getActiveWorkerSessionIds(): string[] {
    return this.workers.filter((w) => w.status !== "archived").map((w) => w.sessionId);
  }

  enqueueMessage(workerId: string, content: string, now: number): QueuedMessage {
    const msg = queueMessage(randomUUID(), workerId, content, now);
    this.messageQueue.push(msg);
    return msg;
  }

  getQueue(workerId: string): QueuedMessage[] {
    return listQueuedMessages(this.messageQueue, workerId);
  }

  cancelMessage(messageId: string): void {
    this.messageQueue = cancelQueuedMessage(this.messageQueue, messageId);
  }

  /**
   * Serialize a queue-touching async operation per worker so concurrent
   * enqueue-vs-drain mutations cannot drop messages or interleave half-delivered.
   */
  private withWorkerQueueLock<T>(workerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queueLocks.get(workerId) ?? Promise.resolve();
    const chained = previous.then(task, task);
    const sentinel = chained.then(
      () => undefined,
      () => undefined,
    );
    this.queueLocks.set(workerId, sentinel);
    sentinel.finally(() => {
      if (this.queueLocks.get(workerId) === sentinel) {
        this.queueLocks.delete(workerId);
      }
    });
    return chained;
  }

  /**
   * Deliver every unconsumed queued message for a worker, marking each consumed
   * once `deliver` resolves. Returns the number of messages delivered. Serialized
   * per worker so a concurrent enqueue cannot push onto a stale array reference.
   */
  async flushQueue(workerId: string, deliver: (content: string) => Promise<void>): Promise<number> {
    return this.withWorkerQueueLock(workerId, async () => {
      const pending = listQueuedMessages(this.messageQueue, workerId);
      let delivered = 0;
      for (const message of pending) {
        await deliver(message.content);
        this.messageQueue = consumeMessage(this.messageQueue, message.id);
        delivered++;
      }
      return delivered;
    });
  }
}

export interface TeamHandlerContext {
  readonly sessionLogger: {
    error(obj: unknown, msg: string): void;
    info(obj: unknown, msg: string): void;
  };
  readonly teamManager: TeamManager;
  /** The lead session id this team belongs to. */
  readonly sessionId: string;
  emit(message: unknown): void;
  /** Spawn a real agent session for a worker. Returns the agent ID. */
  spawnWorker?(options: {
    label: string;
    role: string;
    provider?: string;
    model?: string;
    initialPrompt?: string;
    cwd: string;
  }): Promise<string>;
  /** Send a message to a running worker agent. */
  sendToAgent?(agentId: string, message: string): Promise<void>;
  /**
   * Terminate a worker agent session when its worker is archived or the team
   * ends, so spawned agent processes (Claude/Codex CLI) do not outlive the team
   * and leak handles/ports. Best-effort: errors are logged and swallowed.
   */
  terminateWorker?(agentId: string): Promise<void>;
}

/** Handles team collaboration RPC operations. */
export class TeamHandler implements DisposableHandler {
  private readonly context: TeamHandlerContext;

  constructor(context: TeamHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  /**
   * Drain queued messages for the worker backed by the given agent session.
   * Called when a worker agent becomes idle so buffered lead messages are
   * delivered instead of sitting in the queue forever. No-op if the agent is
   * not a team worker.
   */
  async flushWorkerQueueByAgent(
    agentId: string,
    deliver: (content: string) => Promise<void>,
  ): Promise<void> {
    const worker = this.context.teamManager
      .getWorkers()
      .find((w) => w.sessionId === agentId && w.status !== "archived");
    if (!worker) return;
    await this.context.teamManager.flushQueue(worker.id, deliver);
  }

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Team request failed";
    const code = error instanceof TeamError ? error.code : "team_request_failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "team",
        code,
      },
      "Team request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: { requestId: request.requestId, requestType: request.type, error: message, code },
    });
  }

  async handleTeamStartRequest(
    request: Extract<SessionInboundMessage, { type: "team/start" }>,
  ): Promise<void> {
    try {
      const team = this.context.teamManager.startTeam(this.context.sessionId, Date.now());
      this.context.emit({
        type: "team/start/response",
        payload: { requestId: request.requestId, team: serializeTeam(team), error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamEndRequest(
    request: Extract<SessionInboundMessage, { type: "team/end" }>,
  ): Promise<void> {
    try {
      // Terminate all live worker agent sessions before ending the team so
      // spawned processes do not leak past team lifecycle.
      if (this.context.terminateWorker) {
        for (const sessionId of this.context.teamManager.getActiveWorkerSessionIds()) {
          try {
            await this.context.terminateWorker(sessionId);
          } catch (err) {
            this.context.sessionLogger.error(
              { err, sessionId },
              "Failed to terminate worker agent on team end",
            );
          }
        }
      }
      const team = this.context.teamManager.endActiveTeam(
        request.status ?? "completed",
        Date.now(),
      );
      this.context.emit({
        type: "team/end/response",
        payload: { requestId: request.requestId, team: serializeTeam(team), error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamCreateWorkerRequest(
    request: Extract<SessionInboundMessage, { type: "team/create-worker" }>,
  ): Promise<void> {
    try {
      const now = Date.now();

      // Spawn a real agent session if the callback is available
      let agentId: string | null = null;
      let spawnError: string | null = null;
      if (this.context.spawnWorker) {
        try {
          agentId = await this.context.spawnWorker({
            label: request.label,
            role: request.role ?? "developer",
            provider: request.provider,
            model: request.model,
            initialPrompt: request.initialTask,
            cwd: process.cwd(),
          });
          this.context.sessionLogger.info(
            { label: request.label, agentId },
            "Team worker agent spawned",
          );
        } catch (spawnError_) {
          // Record the failure and surface it in the response. Do NOT fall back
          // to a fake sessionId — an orphan worker record pointing at no real
          // agent would queue messages forever with nothing to drain them.
          spawnError =
            spawnError_ instanceof Error ? spawnError_.message : "Failed to spawn worker agent";
          this.context.sessionLogger.error(
            { err: spawnError_, label: request.label },
            "Failed to spawn worker agent",
          );
          this.context.emit({
            type: "team/create-worker/response",
            payload: {
              requestId: request.requestId,
              worker: null,
              softLimitExceeded: false,
              queuedMessageId: null,
              error: spawnError,
            },
          });
          return;
        }
      }

      const result = this.context.teamManager.addWorker(
        {
          id: randomUUID(),
          sessionId: agentId ?? randomUUID(),
          role: request.role,
          label: request.label,
        },
        now,
      );
      let queuedMessageId: string | null = null;
      if (request.initialTask && !agentId) {
        // Only queue if we didn't already pass it as initialPrompt to the agent
        const msg = this.context.teamManager.enqueueMessage(
          result.worker.id,
          request.initialTask,
          now,
        );
        queuedMessageId = msg.id;
      }
      this.context.emit({
        type: "team/create-worker/response",
        payload: {
          requestId: request.requestId,
          worker: serializeWorker(result.worker),
          softLimitExceeded: result.softLimitExceeded,
          queuedMessageId,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamListWorkersRequest(
    request: Extract<SessionInboundMessage, { type: "team/list-workers" }>,
  ): Promise<void> {
    try {
      const team = this.context.teamManager.getTeam();
      const workers = this.context.teamManager.getWorkers();
      this.context.emit({
        type: "team/list-workers/response",
        payload: {
          requestId: request.requestId,
          team: team ? serializeTeam(team) : null,
          workers: workers.map(serializeWorker),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamSendToWorkerRequest(
    request: Extract<SessionInboundMessage, { type: "team/send-to-worker" }>,
  ): Promise<void> {
    try {
      // Try to deliver directly to the agent session if available
      const worker = this.context.teamManager.getWorker(request.workerId);
      if (worker && this.context.sendToAgent) {
        try {
          await this.context.sendToAgent(worker.sessionId, request.message);
          this.context.emit({
            type: "team/send-to-worker/response",
            payload: { requestId: request.requestId, queuedMessageId: null, error: null },
          });
          return;
        } catch {
          // Fall through to queue if direct delivery fails
        }
      }
      const msg = this.context.teamManager.enqueueMessage(
        request.workerId,
        request.message,
        Date.now(),
      );
      this.context.emit({
        type: "team/send-to-worker/response",
        payload: { requestId: request.requestId, queuedMessageId: msg.id, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamListQueueRequest(
    request: Extract<SessionInboundMessage, { type: "team/list-queue" }>,
  ): Promise<void> {
    try {
      const messages = this.context.teamManager.getQueue(request.workerId);
      this.context.emit({
        type: "team/list-queue/response",
        payload: {
          requestId: request.requestId,
          messages: messages.map(serializeQueuedMessage),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamCancelMessageRequest(
    request: Extract<SessionInboundMessage, { type: "team/cancel-message" }>,
  ): Promise<void> {
    try {
      this.context.teamManager.cancelMessage(request.messageId);
      this.context.emit({
        type: "team/cancel-message/response",
        payload: { requestId: request.requestId, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamArchiveWorkerRequest(
    request: Extract<SessionInboundMessage, { type: "team/archive-worker" }>,
  ): Promise<void> {
    try {
      // Terminate the live agent session before archiving so the worker process
      // does not keep running after the user removes it from the team.
      if (this.context.terminateWorker) {
        const sessionId = this.context.teamManager.getWorkerSessionId(request.workerId);
        if (sessionId) {
          try {
            await this.context.terminateWorker(sessionId);
          } catch (err) {
            this.context.sessionLogger.error(
              { err, workerId: request.workerId },
              "Failed to terminate worker agent on archive",
            );
          }
        }
      }
      const worker = this.context.teamManager.archiveWorker(request.workerId, Date.now());
      this.context.emit({
        type: "team/archive-worker/response",
        payload: { requestId: request.requestId, worker: serializeWorker(worker), error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamSwitchFocusRequest(
    request: Extract<SessionInboundMessage, { type: "team/switch-focus" }>,
  ): Promise<void> {
    try {
      const workers = this.context.teamManager.switchFocus(request.workerId);
      this.context.emit({
        type: "team/switch-focus/response",
        payload: {
          requestId: request.requestId,
          workers: workers.map(serializeWorker),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleTeamWorkerStatusRequest(
    request: Extract<SessionInboundMessage, { type: "team/worker-status" }>,
  ): Promise<void> {
    try {
      const worker = this.context.teamManager.getWorker(request.workerId);
      this.context.emit({
        type: "team/worker-status/response",
        payload: {
          requestId: request.requestId,
          worker: worker ? serializeWorker(worker) : null,
          error: worker ? null : `Worker "${request.workerId}" not found`,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}

function serializeTeam(team: TeamState) {
  return {
    id: team.id,
    leadSessionId: team.leadSessionId,
    status: team.status,
    createdAt: new Date(team.createdAt).toISOString(),
    updatedAt: new Date(team.updatedAt).toISOString(),
  };
}

function serializeWorker(worker: WorkerState) {
  return {
    id: worker.id,
    teamId: worker.teamId,
    sessionId: worker.sessionId,
    role: worker.role,
    label: worker.label,
    status: worker.status,
    focused: worker.focused,
    idleSince: worker.idleSince ? new Date(worker.idleSince).toISOString() : null,
    createdAt: new Date(worker.createdAt).toISOString(),
  };
}

function serializeQueuedMessage(msg: QueuedMessage) {
  return {
    id: msg.id,
    workerId: msg.workerId,
    content: msg.content,
    source: msg.source,
    queuedAt: new Date(msg.queuedAt).toISOString(),
    consumed: msg.consumed,
  };
}
