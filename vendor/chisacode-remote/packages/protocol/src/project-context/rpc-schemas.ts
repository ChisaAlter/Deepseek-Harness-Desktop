import { z } from "zod/v3";

// ── Shared types ──────────────────────────────────────────────────────────

export const DiscoveredModuleSchema = z.object({
  dir: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const ProjectContextRecordSchema = z.object({
  workDir: z.string(),
  projectName: z.string(),
  modules: z.array(DiscoveredModuleSchema),
  toc: z.string(),
  builtAt: z.string(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const ContextBuildRequestSchema = z.object({
  type: z.literal("context/build"),
  requestId: z.string(),
  workDir: z.string().trim().min(1),
});

export const ContextInspectRequestSchema = z.object({
  type: z.literal("context/inspect"),
  requestId: z.string(),
  workDir: z.string().trim().min(1),
});

export const ContextInvalidateRequestSchema = z.object({
  type: z.literal("context/invalidate"),
  requestId: z.string(),
  workDir: z.string().trim().min(1),
});

// ── Responses ─────────────────────────────────────────────────────────────

export const ContextBuildResponseSchema = z.object({
  type: z.literal("context/build/response"),
  payload: z.object({
    requestId: z.string(),
    context: ProjectContextRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ContextInspectResponseSchema = z.object({
  type: z.literal("context/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    context: ProjectContextRecordSchema.nullable(),
    cached: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const ContextInvalidateResponseSchema = z.object({
  type: z.literal("context/invalidate/response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type DiscoveredModule = z.infer<typeof DiscoveredModuleSchema>;
export type ProjectContextRecord = z.infer<typeof ProjectContextRecordSchema>;
export type ContextBuildRequest = z.infer<typeof ContextBuildRequestSchema>;
export type ContextInspectRequest = z.infer<typeof ContextInspectRequestSchema>;
export type ContextInvalidateRequest = z.infer<typeof ContextInvalidateRequestSchema>;
export type ContextBuildResponse = z.infer<typeof ContextBuildResponseSchema>;
export type ContextInspectResponse = z.infer<typeof ContextInspectResponseSchema>;
export type ContextInvalidateResponse = z.infer<typeof ContextInvalidateResponseSchema>;
