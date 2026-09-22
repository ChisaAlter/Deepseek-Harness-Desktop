import { z } from "zod/v3";

// ── Shared types ──────────────────────────────────────────────────────────

export const GoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "complete",
  "budgetLimited",
  // Terminal failure/cancellation states. A goal whose agent crashed or was
  // cancelled by the user now has a dedicated literal instead of being
  // mislabeled as "blocked" or "paused". Additive over the prior enum, so old
  // clients that switch on status simply get an unknown branch they must
  // default-handle (no parse failure — zod enum widen is forward-compatible).
  "failed",
  "cancelled",
]);

export const GoalLimitsSchema = z.object({
  maxTurns: z.number().int().positive().nullable(),
  budgetTokens: z.number().int().positive().nullable(),
  noProgressLimit: z.number().int().positive().nullable(),
});

export const GoalRecordSchema = z.object({
  agentId: z.string(),
  objective: z.string(),
  status: GoalStatusSchema,
  limits: GoalLimitsSchema,
  turnsUsed: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  noProgressStreak: z.number().int().nonnegative(),
  lastReason: z.string().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export const GoalListItemSchema = z.object({
  agentId: z.string(),
  objective: z.string(),
  status: GoalStatusSchema,
  turnsUsed: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const GoalSetRequestSchema = z.object({
  type: z.literal("goal/set"),
  requestId: z.string(),
  agentId: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  limits: GoalLimitsSchema.partial().optional(),
});

export const GoalCancelRequestSchema = z.object({
  type: z.literal("goal/cancel"),
  requestId: z.string(),
  agentId: z.string().trim().min(1),
});

export const GoalInspectRequestSchema = z.object({
  type: z.literal("goal/inspect"),
  requestId: z.string(),
  agentId: z.string().trim().min(1),
});

export const GoalListRequestSchema = z.object({
  type: z.literal("goal/list"),
  requestId: z.string(),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const GoalSetResponseSchema = z.object({
  type: z.literal("goal/set/response"),
  payload: z.object({
    requestId: z.string(),
    goal: GoalRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const GoalCancelResponseSchema = z.object({
  type: z.literal("goal/cancel/response"),
  payload: z.object({
    requestId: z.string(),
    goal: GoalRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const GoalInspectResponseSchema = z.object({
  type: z.literal("goal/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    goal: GoalRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const GoalListResponseSchema = z.object({
  type: z.literal("goal/list/response"),
  payload: z.object({
    requestId: z.string(),
    goals: z.array(GoalListItemSchema),
    error: z.string().nullable(),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type GoalLimits = z.infer<typeof GoalLimitsSchema>;
export type GoalRecord = z.infer<typeof GoalRecordSchema>;
export type GoalListItem = z.infer<typeof GoalListItemSchema>;
export type GoalSetRequest = z.infer<typeof GoalSetRequestSchema>;
export type GoalCancelRequest = z.infer<typeof GoalCancelRequestSchema>;
export type GoalInspectRequest = z.infer<typeof GoalInspectRequestSchema>;
export type GoalListRequest = z.infer<typeof GoalListRequestSchema>;
export type GoalSetResponse = z.infer<typeof GoalSetResponseSchema>;
export type GoalCancelResponse = z.infer<typeof GoalCancelResponseSchema>;
export type GoalInspectResponse = z.infer<typeof GoalInspectResponseSchema>;
export type GoalListResponse = z.infer<typeof GoalListResponseSchema>;
