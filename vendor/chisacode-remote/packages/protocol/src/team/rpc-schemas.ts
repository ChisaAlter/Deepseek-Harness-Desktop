import { z } from "zod/v3";
import { AgentProviderSchema } from "@chisacode/protocol/provider-manifest";

// ── Shared types ──────────────────────────────────────────────────────────

export const WorkerStatusSchema = z.enum(["idle", "running", "done", "error", "archived"]);

export const TeamStatusSchema = z.enum(["active", "completed", "cancelled"]);

export const WorkerRecordSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  sessionId: z.string(),
  role: z.string(),
  label: z.string(),
  status: WorkerStatusSchema,
  focused: z.boolean(),
  idleSince: z.string().nullable(),
  createdAt: z.string(),
});

export const TeamRecordSchema = z.object({
  id: z.string(),
  leadSessionId: z.string(),
  status: TeamStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const QueuedMessageSchema = z.object({
  id: z.string(),
  workerId: z.string(),
  content: z.string(),
  source: z.literal("lead"),
  queuedAt: z.string(),
  consumed: z.boolean(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const TeamStartRequestSchema = z.object({
  type: z.literal("team/start"),
  requestId: z.string(),
});

export const TeamEndRequestSchema = z.object({
  type: z.literal("team/end"),
  requestId: z.string(),
  status: z.enum(["completed", "cancelled"]).optional(),
});

export const TeamCreateWorkerRequestSchema = z.object({
  type: z.literal("team/create-worker"),
  requestId: z.string(),
  label: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/),
  role: z.string().trim().min(1).max(32).optional(),
  provider: AgentProviderSchema.optional(),
  model: z.string().trim().min(1).optional(),
  initialTask: z.string().trim().min(1).optional(),
});

export const TeamListWorkersRequestSchema = z.object({
  type: z.literal("team/list-workers"),
  requestId: z.string(),
});

export const TeamSendToWorkerRequestSchema = z.object({
  type: z.literal("team/send-to-worker"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const TeamListQueueRequestSchema = z.object({
  type: z.literal("team/list-queue"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
});

export const TeamCancelMessageRequestSchema = z.object({
  type: z.literal("team/cancel-message"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
});

export const TeamArchiveWorkerRequestSchema = z.object({
  type: z.literal("team/archive-worker"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
});

export const TeamSwitchFocusRequestSchema = z.object({
  type: z.literal("team/switch-focus"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
});

export const TeamWorkerStatusRequestSchema = z.object({
  type: z.literal("team/worker-status"),
  requestId: z.string(),
  workerId: z.string().trim().min(1),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const TeamStartResponseSchema = z.object({
  type: z.literal("team/start/response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamEndResponseSchema = z.object({
  type: z.literal("team/end/response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamCreateWorkerResponseSchema = z.object({
  type: z.literal("team/create-worker/response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerRecordSchema.nullable(),
    softLimitExceeded: z.boolean(),
    queuedMessageId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamListWorkersResponseSchema = z.object({
  type: z.literal("team/list-workers/response"),
  payload: z.object({
    requestId: z.string(),
    team: TeamRecordSchema.nullable(),
    workers: z.array(WorkerRecordSchema),
    error: z.string().nullable(),
  }),
});

export const TeamSendToWorkerResponseSchema = z.object({
  type: z.literal("team/send-to-worker/response"),
  payload: z.object({
    requestId: z.string(),
    queuedMessageId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamListQueueResponseSchema = z.object({
  type: z.literal("team/list-queue/response"),
  payload: z.object({
    requestId: z.string(),
    messages: z.array(QueuedMessageSchema),
    error: z.string().nullable(),
  }),
});

export const TeamCancelMessageResponseSchema = z.object({
  type: z.literal("team/cancel-message/response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

export const TeamArchiveWorkerResponseSchema = z.object({
  type: z.literal("team/archive-worker/response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamSwitchFocusResponseSchema = z.object({
  type: z.literal("team/switch-focus/response"),
  payload: z.object({
    requestId: z.string(),
    workers: z.array(WorkerRecordSchema),
    error: z.string().nullable(),
  }),
});

export const TeamWorkerStatusResponseSchema = z.object({
  type: z.literal("team/worker-status/response"),
  payload: z.object({
    requestId: z.string(),
    worker: WorkerRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;
export type TeamStatus = z.infer<typeof TeamStatusSchema>;
export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;
export type TeamRecord = z.infer<typeof TeamRecordSchema>;
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;
export type TeamStartRequest = z.infer<typeof TeamStartRequestSchema>;
export type TeamEndRequest = z.infer<typeof TeamEndRequestSchema>;
export type TeamCreateWorkerRequest = z.infer<typeof TeamCreateWorkerRequestSchema>;
export type TeamListWorkersRequest = z.infer<typeof TeamListWorkersRequestSchema>;
export type TeamSendToWorkerRequest = z.infer<typeof TeamSendToWorkerRequestSchema>;
export type TeamListQueueRequest = z.infer<typeof TeamListQueueRequestSchema>;
export type TeamCancelMessageRequest = z.infer<typeof TeamCancelMessageRequestSchema>;
export type TeamArchiveWorkerRequest = z.infer<typeof TeamArchiveWorkerRequestSchema>;
export type TeamSwitchFocusRequest = z.infer<typeof TeamSwitchFocusRequestSchema>;
export type TeamWorkerStatusRequest = z.infer<typeof TeamWorkerStatusRequestSchema>;
export type TeamStartResponse = z.infer<typeof TeamStartResponseSchema>;
export type TeamEndResponse = z.infer<typeof TeamEndResponseSchema>;
export type TeamCreateWorkerResponse = z.infer<typeof TeamCreateWorkerResponseSchema>;
export type TeamListWorkersResponse = z.infer<typeof TeamListWorkersResponseSchema>;
export type TeamSendToWorkerResponse = z.infer<typeof TeamSendToWorkerResponseSchema>;
export type TeamListQueueResponse = z.infer<typeof TeamListQueueResponseSchema>;
export type TeamCancelMessageResponse = z.infer<typeof TeamCancelMessageResponseSchema>;
export type TeamArchiveWorkerResponse = z.infer<typeof TeamArchiveWorkerResponseSchema>;
export type TeamSwitchFocusResponse = z.infer<typeof TeamSwitchFocusResponseSchema>;
export type TeamWorkerStatusResponse = z.infer<typeof TeamWorkerStatusResponseSchema>;
