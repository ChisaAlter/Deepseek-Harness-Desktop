import { z } from "zod/v3";

// ── Shared types ──────────────────────────────────────────────────────────

export const MigrationItemSchema = z.object({
  kind: z.enum(["agents-md"]),
  direction: z.enum(["to-claude", "to-codex"]),
  label: z.string(),
  source: z.string(),
  target: z.string(),
});

export const MigrationOutcomeSchema = z.object({
  status: z.enum(["success", "skipped", "failed"]),
  detail: z.string().optional(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const MigrationDetectRequestSchema = z.object({
  type: z.literal("migration/detect"),
  requestId: z.string(),
  workDir: z.string().trim().min(1),
  targetAgent: z.enum(["claude-code", "codex"]),
});

export const MigrationApplyRequestSchema = z.object({
  type: z.literal("migration/apply"),
  requestId: z.string(),
  workDir: z.string().trim().min(1),
  targetAgent: z.enum(["claude-code", "codex"]),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const MigrationDetectResponseSchema = z.object({
  type: z.literal("migration/detect/response"),
  payload: z.object({
    requestId: z.string(),
    items: z.array(MigrationItemSchema),
    error: z.string().nullable(),
  }),
});

export const MigrationApplyResponseSchema = z.object({
  type: z.literal("migration/apply/response"),
  payload: z.object({
    requestId: z.string(),
    outcomes: z.array(MigrationOutcomeSchema),
    error: z.string().nullable(),
  }),
});

// ── Server-push notification ─────────────────────────────────────────────

export const MigrationAvailableNotificationSchema = z.object({
  type: z.literal("migration/available"),
  payload: z.object({
    items: z.array(MigrationItemSchema),
    workDir: z.string(),
    targetAgent: z.enum(["claude-code", "codex"]),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type MigrationItem = z.infer<typeof MigrationItemSchema>;
export type MigrationOutcome = z.infer<typeof MigrationOutcomeSchema>;
export type MigrationDetectRequest = z.infer<typeof MigrationDetectRequestSchema>;
export type MigrationApplyRequest = z.infer<typeof MigrationApplyRequestSchema>;
export type MigrationDetectResponse = z.infer<typeof MigrationDetectResponseSchema>;
export type MigrationApplyResponse = z.infer<typeof MigrationApplyResponseSchema>;
export type MigrationAvailableNotification = z.infer<typeof MigrationAvailableNotificationSchema>;
