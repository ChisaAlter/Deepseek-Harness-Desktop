import type { SessionInboundMessage } from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

type RequestOf<TType extends SessionInboundMessage["type"]> = Extract<
  SessionInboundMessage,
  { type: TType }
>;
type WithoutEnvelope<T extends { requestId: string }> = Omit<T, "type" | "requestId"> & {
  requestId?: string;
};

// ── Goal options ──────────────────────────────────────────────────────────

type GoalSetOptions = WithoutEnvelope<RequestOf<"goal/set">>;
type GoalCancelOptions = WithoutEnvelope<RequestOf<"goal/cancel">>;
type GoalInspectOptions = WithoutEnvelope<RequestOf<"goal/inspect">>;

// ── Team options ──────────────────────────────────────────────────────────

type TeamCreateWorkerOptions = WithoutEnvelope<RequestOf<"team/create-worker">>;
type TeamSendToWorkerOptions = WithoutEnvelope<RequestOf<"team/send-to-worker">>;
type TeamListQueueOptions = WithoutEnvelope<RequestOf<"team/list-queue">>;
type TeamCancelMessageOptions = WithoutEnvelope<RequestOf<"team/cancel-message">>;
type TeamArchiveWorkerOptions = WithoutEnvelope<RequestOf<"team/archive-worker">>;
type TeamSwitchFocusOptions = WithoutEnvelope<RequestOf<"team/switch-focus">>;
type TeamWorkerStatusOptions = WithoutEnvelope<RequestOf<"team/worker-status">>;

// ── Context options ───────────────────────────────────────────────────────

type ContextBuildOptions = WithoutEnvelope<RequestOf<"context/build">>;
type ContextInspectOptions = WithoutEnvelope<RequestOf<"context/inspect">>;
type ContextInvalidateOptions = WithoutEnvelope<RequestOf<"context/invalidate">>;

// ── Snapshot options ──────────────────────────────────────────────────────

type SnapshotCreateOptions = WithoutEnvelope<RequestOf<"snapshot/create">>;
type SnapshotListOptions = WithoutEnvelope<RequestOf<"snapshot/list">>;
type SnapshotRewindOptions = WithoutEnvelope<RequestOf<"snapshot/rewind">>;
type SnapshotStatusOptions = WithoutEnvelope<RequestOf<"snapshot/status">>;

// ── Migration options ─────────────────────────────────────────────────────

type MigrationDetectOptions = WithoutEnvelope<RequestOf<"migration/detect">>;
type MigrationApplyOptions = WithoutEnvelope<RequestOf<"migration/apply">>;

// ── Learn options ─────────────────────────────────────────────────────────

type LearnStartOptions = WithoutEnvelope<RequestOf<"learn/start">>;
type LearnInspectOptions = WithoutEnvelope<RequestOf<"learn/inspect">>;
type LearnApplyOptions = WithoutEnvelope<RequestOf<"learn/apply">>;
type LearnDiscardOptions = WithoutEnvelope<RequestOf<"learn/discard">>;
type LearnCancelOptions = WithoutEnvelope<RequestOf<"learn/cancel">>;

// ── Response payload types ────────────────────────────────────────────────

type GoalSetPayload = DaemonCommandResponsePayload<"goal/set/response">;
type GoalCancelPayload = DaemonCommandResponsePayload<"goal/cancel/response">;
type GoalInspectPayload = DaemonCommandResponsePayload<"goal/inspect/response">;
type GoalListPayload = DaemonCommandResponsePayload<"goal/list/response">;

type TeamStartPayload = DaemonCommandResponsePayload<"team/start/response">;
type TeamEndPayload = DaemonCommandResponsePayload<"team/end/response">;
type TeamCreateWorkerPayload = DaemonCommandResponsePayload<"team/create-worker/response">;
type TeamListWorkersPayload = DaemonCommandResponsePayload<"team/list-workers/response">;
type TeamSendToWorkerPayload = DaemonCommandResponsePayload<"team/send-to-worker/response">;
type TeamListQueuePayload = DaemonCommandResponsePayload<"team/list-queue/response">;
type TeamCancelMessagePayload = DaemonCommandResponsePayload<"team/cancel-message/response">;
type TeamArchiveWorkerPayload = DaemonCommandResponsePayload<"team/archive-worker/response">;
type TeamSwitchFocusPayload = DaemonCommandResponsePayload<"team/switch-focus/response">;
type TeamWorkerStatusPayload = DaemonCommandResponsePayload<"team/worker-status/response">;

type ContextBuildPayload = DaemonCommandResponsePayload<"context/build/response">;
type ContextInspectPayload = DaemonCommandResponsePayload<"context/inspect/response">;
type ContextInvalidatePayload = DaemonCommandResponsePayload<"context/invalidate/response">;

type SnapshotCreatePayload = DaemonCommandResponsePayload<"snapshot/create/response">;
type SnapshotListPayload = DaemonCommandResponsePayload<"snapshot/list/response">;
type SnapshotRewindPayload = DaemonCommandResponsePayload<"snapshot/rewind/response">;
type SnapshotStatusPayload = DaemonCommandResponsePayload<"snapshot/status/response">;

type MigrationDetectPayload = DaemonCommandResponsePayload<"migration/detect/response">;
type MigrationApplyPayload = DaemonCommandResponsePayload<"migration/apply/response">;

type LearnStartPayload = DaemonCommandResponsePayload<"learn/start/response">;
type LearnListPayload = DaemonCommandResponsePayload<"learn/list/response">;
type LearnInspectPayload = DaemonCommandResponsePayload<"learn/inspect/response">;
type LearnApplyPayload = DaemonCommandResponsePayload<"learn/apply/response">;
type LearnDiscardPayload = DaemonCommandResponsePayload<"learn/discard/response">;
type LearnCancelPayload = DaemonCommandResponsePayload<"learn/cancel/response">;

/** Implements stateless RPC commands for Goal, Team, Context, Snapshot, Migration, and Learn. */
export class CindyCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  // ── Goal ──────────────────────────────────────────────────────────────────

  async goalSet(options: GoalSetOptions): Promise<GoalSetPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/set",
        agentId: options.agentId,
        objective: options.objective,
        ...(options.limits ? { limits: options.limits } : {}),
      },
      responseType: "goal/set/response",
      timeout: 10000,
    });
  }

  async goalCancel(options: GoalCancelOptions): Promise<GoalCancelPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/cancel",
        agentId: options.agentId,
      },
      responseType: "goal/cancel/response",
      timeout: 10000,
    });
  }

  async goalInspect(options: GoalInspectOptions): Promise<GoalInspectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/inspect",
        agentId: options.agentId,
      },
      responseType: "goal/inspect/response",
      timeout: 10000,
    });
  }

  async goalList(requestId?: string): Promise<GoalListPayload> {
    return this.transport.request({
      requestId,
      message: { type: "goal/list" },
      responseType: "goal/list/response",
      timeout: 10000,
    });
  }

  // ── Team ──────────────────────────────────────────────────────────────────

  async teamStart(requestId?: string): Promise<TeamStartPayload> {
    return this.transport.request({
      requestId,
      message: { type: "team/start" },
      responseType: "team/start/response",
      timeout: 10000,
    });
  }

  async teamEnd(requestId?: string): Promise<TeamEndPayload> {
    return this.transport.request({
      requestId,
      message: { type: "team/end" },
      responseType: "team/end/response",
      timeout: 10000,
    });
  }

  async teamCreateWorker(options: TeamCreateWorkerOptions): Promise<TeamCreateWorkerPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/create-worker",
        label: options.label,
        ...(options.role ? { role: options.role } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.initialTask ? { initialTask: options.initialTask } : {}),
      },
      responseType: "team/create-worker/response",
      timeout: 15000,
    });
  }

  async teamListWorkers(requestId?: string): Promise<TeamListWorkersPayload> {
    return this.transport.request({
      requestId,
      message: { type: "team/list-workers" },
      responseType: "team/list-workers/response",
      timeout: 10000,
    });
  }

  async teamSendToWorker(options: TeamSendToWorkerOptions): Promise<TeamSendToWorkerPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/send-to-worker",
        workerId: options.workerId,
        message: options.message,
      },
      responseType: "team/send-to-worker/response",
      timeout: 10000,
    });
  }

  async teamListQueue(options: TeamListQueueOptions): Promise<TeamListQueuePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/list-queue",
        workerId: options.workerId,
      },
      responseType: "team/list-queue/response",
      timeout: 10000,
    });
  }

  async teamCancelMessage(options: TeamCancelMessageOptions): Promise<TeamCancelMessagePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/cancel-message",
        workerId: options.workerId,
        messageId: options.messageId,
      },
      responseType: "team/cancel-message/response",
      timeout: 10000,
    });
  }

  async teamArchiveWorker(options: TeamArchiveWorkerOptions): Promise<TeamArchiveWorkerPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/archive-worker",
        workerId: options.workerId,
      },
      responseType: "team/archive-worker/response",
      timeout: 10000,
    });
  }

  async teamSwitchFocus(options: TeamSwitchFocusOptions): Promise<TeamSwitchFocusPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/switch-focus",
        workerId: options.workerId,
      },
      responseType: "team/switch-focus/response",
      timeout: 10000,
    });
  }

  async teamWorkerStatus(options: TeamWorkerStatusOptions): Promise<TeamWorkerStatusPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/worker-status",
        workerId: options.workerId,
      },
      responseType: "team/worker-status/response",
      timeout: 10000,
    });
  }

  // ── Project Context ───────────────────────────────────────────────────────

  async contextBuild(options: ContextBuildOptions): Promise<ContextBuildPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/build",
        workDir: options.workDir,
      },
      responseType: "context/build/response",
      timeout: 30000,
    });
  }

  async contextInspect(options: ContextInspectOptions): Promise<ContextInspectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/inspect",
        workDir: options.workDir,
      },
      responseType: "context/inspect/response",
      timeout: 10000,
    });
  }

  async contextInvalidate(options: ContextInvalidateOptions): Promise<ContextInvalidatePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/invalidate",
        workDir: options.workDir,
      },
      responseType: "context/invalidate/response",
      timeout: 10000,
    });
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  async snapshotCreate(options: SnapshotCreateOptions): Promise<SnapshotCreatePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/create",
        cwd: options.cwd,
        ...(options.label ? { label: options.label } : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
      },
      responseType: "snapshot/create/response",
      timeout: 15000,
    });
  }

  async snapshotList(options: SnapshotListOptions): Promise<SnapshotListPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/list",
        cwd: options.cwd,
        ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
      },
      responseType: "snapshot/list/response",
      timeout: 10000,
    });
  }

  async snapshotRewind(options: SnapshotRewindOptions): Promise<SnapshotRewindPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/rewind",
        cwd: options.cwd,
        commitHash: options.commitHash,
      },
      responseType: "snapshot/rewind/response",
      timeout: 15000,
    });
  }

  async snapshotStatus(options: SnapshotStatusOptions): Promise<SnapshotStatusPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/status",
        cwd: options.cwd,
      },
      responseType: "snapshot/status/response",
      timeout: 10000,
    });
  }

  // ── Migration ─────────────────────────────────────────────────────────────

  async migrationDetect(options: MigrationDetectOptions): Promise<MigrationDetectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "migration/detect",
        workDir: options.workDir,
        targetAgent: options.targetAgent,
      },
      responseType: "migration/detect/response",
      timeout: 10000,
    });
  }

  async migrationApply(options: MigrationApplyOptions): Promise<MigrationApplyPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "migration/apply",
        workDir: options.workDir,
        targetAgent: options.targetAgent,
      },
      responseType: "migration/apply/response",
      timeout: 15000,
    });
  }

  // ── Learn ─────────────────────────────────────────────────────────────────

  async learnStart(options: LearnStartOptions): Promise<LearnStartPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/start",
        diff: options.diff,
        files: options.files,
        ...(options.context ? { context: options.context } : {}),
      },
      responseType: "learn/start/response",
      timeout: 15000,
    });
  }

  async learnList(requestId?: string): Promise<LearnListPayload> {
    return this.transport.request({
      requestId,
      message: { type: "learn/list" },
      responseType: "learn/list/response",
      timeout: 10000,
    });
  }

  async learnInspect(options: LearnInspectOptions): Promise<LearnInspectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/inspect",
        runId: options.runId,
      },
      responseType: "learn/inspect/response",
      timeout: 10000,
    });
  }

  async learnApply(options: LearnApplyOptions): Promise<LearnApplyPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/apply",
        runId: options.runId,
        ...(options.fingerprints ? { fingerprints: options.fingerprints } : {}),
      },
      responseType: "learn/apply/response",
      timeout: 15000,
    });
  }

  async learnDiscard(options: LearnDiscardOptions): Promise<LearnDiscardPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/discard",
        runId: options.runId,
      },
      responseType: "learn/discard/response",
      timeout: 10000,
    });
  }

  async learnCancel(options: LearnCancelOptions): Promise<LearnCancelPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/cancel",
        runId: options.runId,
      },
      responseType: "learn/cancel/response",
      timeout: 10000,
    });
  }
}
