import { z } from "zod/v3";

// ── Shared types ──────────────────────────────────────────────────────────

export const LearnRunStatusSchema = z.enum([
  "collecting",
  "distilling",
  "staging",
  "awaiting-review",
  "applied",
  "discarded",
  "failed",
  "cancelled",
]);

export const LearnProposalSchema = z.object({
  // Bound the length so a hallucinating distill agent cannot emit a huge path
  // string; path-traversal (`..`) is rejected by deriveSkillName at staging time.
  filename: z.string().max(256),
  content: z.string(),
  fingerprint: z.string(),
});

export const LearnRunSchema = z.object({
  id: z.string(),
  status: LearnRunStatusSchema,
  evidence: z
    .object({
      diff: z.string(),
      files: z.array(z.string()),
      context: z.string().optional(),
    })
    .nullable(),
  proposals: z.array(LearnProposalSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const LearnListItemSchema = z.object({
  id: z.string(),
  status: LearnRunStatusSchema,
  proposalCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const LearnStartRequestSchema = z.object({
  type: z.literal("learn/start"),
  requestId: z.string(),
  diff: z.string().trim().min(1),
  files: z.array(z.string().trim().min(1)).min(1),
  context: z.string().optional(),
});

export const LearnListRequestSchema = z.object({
  type: z.literal("learn/list"),
  requestId: z.string(),
});

export const LearnInspectRequestSchema = z.object({
  type: z.literal("learn/inspect"),
  requestId: z.string(),
  runId: z.string().trim().min(1),
});

export const LearnApplyRequestSchema = z.object({
  type: z.literal("learn/apply"),
  requestId: z.string(),
  runId: z.string().trim().min(1),
  /** Specific proposal fingerprints to apply. If omitted, applies all. */
  fingerprints: z.array(z.string()).optional(),
});

export const LearnDiscardRequestSchema = z.object({
  type: z.literal("learn/discard"),
  requestId: z.string(),
  runId: z.string().trim().min(1),
});

export const LearnCancelRequestSchema = z.object({
  type: z.literal("learn/cancel"),
  requestId: z.string(),
  runId: z.string().trim().min(1),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const LearnStartResponseSchema = z.object({
  type: z.literal("learn/start/response"),
  payload: z.object({
    requestId: z.string(),
    run: LearnRunSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const LearnListResponseSchema = z.object({
  type: z.literal("learn/list/response"),
  payload: z.object({
    requestId: z.string(),
    runs: z.array(LearnListItemSchema),
    error: z.string().nullable(),
  }),
});

export const LearnInspectResponseSchema = z.object({
  type: z.literal("learn/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    run: LearnRunSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const LearnApplyResponseSchema = z.object({
  type: z.literal("learn/apply/response"),
  payload: z.object({
    requestId: z.string(),
    run: LearnRunSchema.nullable(),
    appliedFiles: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export const LearnDiscardResponseSchema = z.object({
  type: z.literal("learn/discard/response"),
  payload: z.object({
    requestId: z.string(),
    run: LearnRunSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const LearnCancelResponseSchema = z.object({
  type: z.literal("learn/cancel/response"),
  payload: z.object({
    requestId: z.string(),
    run: LearnRunSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type LearnRunStatus = z.infer<typeof LearnRunStatusSchema>;
export type LearnProposal = z.infer<typeof LearnProposalSchema>;
export type LearnRun = z.infer<typeof LearnRunSchema>;
export type LearnListItem = z.infer<typeof LearnListItemSchema>;
export type LearnStartRequest = z.infer<typeof LearnStartRequestSchema>;
export type LearnListRequest = z.infer<typeof LearnListRequestSchema>;
export type LearnInspectRequest = z.infer<typeof LearnInspectRequestSchema>;
export type LearnApplyRequest = z.infer<typeof LearnApplyRequestSchema>;
export type LearnDiscardRequest = z.infer<typeof LearnDiscardRequestSchema>;
export type LearnCancelRequest = z.infer<typeof LearnCancelRequestSchema>;
export type LearnStartResponse = z.infer<typeof LearnStartResponseSchema>;
export type LearnListResponse = z.infer<typeof LearnListResponseSchema>;
export type LearnInspectResponse = z.infer<typeof LearnInspectResponseSchema>;
export type LearnApplyResponse = z.infer<typeof LearnApplyResponseSchema>;
export type LearnDiscardResponse = z.infer<typeof LearnDiscardResponseSchema>;
export type LearnCancelResponse = z.infer<typeof LearnCancelResponseSchema>;
