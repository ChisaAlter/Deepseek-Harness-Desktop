import { z } from "zod/v3";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const ChisaCodeLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const ChisaCodeScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const ChisaCodeWorktreeConfigRawSchema = z
  .object({
    setup: ChisaCodeLifecycleCommandRawSchema.optional(),
    teardown: ChisaCodeLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const ChisaCodeMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const ChisaCodeMetadataGenerationSchema = z
  .object({
    agentTitle: ChisaCodeMetadataGenerationEntrySchema.optional(),
    branchName: ChisaCodeMetadataGenerationEntrySchema.optional(),
    commitMessage: ChisaCodeMetadataGenerationEntrySchema.optional(),
    pullRequest: ChisaCodeMetadataGenerationEntrySchema.optional(),
  })
  .passthrough()
  .catch({});

export const ChisaCodeConfigRawSchema = z
  .object({
    worktree: ChisaCodeWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), ChisaCodeScriptEntryRawSchema).optional(),
    metadataGeneration: ChisaCodeMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = ChisaCodeWorktreeConfigRawSchema.extend({
  setup: z.unknown().transform(normalizeLifecycleCommands),
  teardown: z.unknown().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = ChisaCodeScriptEntryRawSchema.catch({});

export const ChisaCodeConfigSchema = ChisaCodeConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: ChisaCodeMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const ChisaCodeConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: ChisaCodeConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type ChisaCodeScriptEntryRaw = z.infer<typeof ChisaCodeScriptEntryRawSchema>;
export type ChisaCodeMetadataGenerationEntry = z.infer<
  typeof ChisaCodeMetadataGenerationEntrySchema
>;
export type ChisaCodeMetadataGeneration = z.infer<typeof ChisaCodeMetadataGenerationSchema>;
export type ChisaCodeConfigRaw = z.infer<typeof ChisaCodeConfigRawSchema>;
export type ChisaCodeConfig = z.infer<typeof ChisaCodeConfigSchema>;
export type ChisaCodeConfigRevision = z.infer<typeof ChisaCodeConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
