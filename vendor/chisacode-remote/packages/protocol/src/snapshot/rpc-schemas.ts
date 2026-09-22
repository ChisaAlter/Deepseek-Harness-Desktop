import { z } from "zod/v3";

// ── Shared types ──────────────────────────────────────────────────────────

export const SnapshotKindSchema = z.enum([
  "before-edit",
  "after-edit",
  "manual",
  "pre-rollback",
  "rewind-blocked",
]);

export const SnapshotEntrySchema = z.object({
  commitHash: z.string(),
  kind: SnapshotKindSchema,
  sessionId: z.string().nullable(),
  agentId: z.string().nullable(),
  label: z.string().nullable(),
  createdAt: z.string(),
});

export const SnapshotBlockedSchema = z.object({
  reason: z.enum(["merge", "rebase", "cherry-pick", "revert", "conflict"]),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const SnapshotCreateRequestSchema = z.object({
  type: z.literal("snapshot/create"),
  requestId: z.string(),
  cwd: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
});

export const SnapshotListRequestSchema = z.object({
  type: z.literal("snapshot/list"),
  requestId: z.string(),
  cwd: z.string().trim().min(1),
  limit: z.number().int().positive().max(100).optional(),
});

export const SnapshotRewindRequestSchema = z.object({
  type: z.literal("snapshot/rewind"),
  requestId: z.string(),
  cwd: z.string().trim().min(1),
  // Hex-only to prevent git argument injection (e.g. --output=<path> writes the
  // log to an arbitrary file). Accept 40 (sha1) or 64 (sha256) hex chars.
  commitHash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{40,64}$/i, "commitHash must be a 40- or 64-char hex SHA"),
});

export const SnapshotStatusRequestSchema = z.object({
  type: z.literal("snapshot/status"),
  requestId: z.string(),
  cwd: z.string().trim().min(1),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const SnapshotCreateResponseSchema = z.object({
  type: z.literal("snapshot/create/response"),
  payload: z.object({
    requestId: z.string(),
    commitHash: z.string().nullable(),
    excludedFiles: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export const SnapshotListResponseSchema = z.object({
  type: z.literal("snapshot/list/response"),
  payload: z.object({
    requestId: z.string(),
    snapshots: z.array(SnapshotEntrySchema),
    error: z.string().nullable(),
  }),
});

export const SnapshotRewindResponseSchema = z.object({
  type: z.literal("snapshot/rewind/response"),
  payload: z.object({
    requestId: z.string(),
    restoredFiles: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export const SnapshotStatusResponseSchema = z.object({
  type: z.literal("snapshot/status/response"),
  payload: z.object({
    requestId: z.string(),
    blocked: SnapshotBlockedSchema.nullable(),
    latestSnapshot: SnapshotEntrySchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;
export type SnapshotBlocked = z.infer<typeof SnapshotBlockedSchema>;
export type SnapshotCreateRequest = z.infer<typeof SnapshotCreateRequestSchema>;
export type SnapshotListRequest = z.infer<typeof SnapshotListRequestSchema>;
export type SnapshotRewindRequest = z.infer<typeof SnapshotRewindRequestSchema>;
export type SnapshotStatusRequest = z.infer<typeof SnapshotStatusRequestSchema>;
export type SnapshotCreateResponse = z.infer<typeof SnapshotCreateResponseSchema>;
export type SnapshotListResponse = z.infer<typeof SnapshotListResponseSchema>;
export type SnapshotRewindResponse = z.infer<typeof SnapshotRewindResponseSchema>;
export type SnapshotStatusResponse = z.infer<typeof SnapshotStatusResponseSchema>;
