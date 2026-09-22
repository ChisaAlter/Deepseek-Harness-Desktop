import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LoopListItemSchema,
  LoopLogEntrySchema,
  LoopRecordSchema,
} from "@chisacode/protocol/loop/rpc-schemas";
import { AgentProviderSchema } from "@chisacode/protocol/provider-manifest";
import { z } from "zod/v3";
import { ensureValidJson } from "../json-utils.js";
import type { LoopService } from "../loop-service.js";

export type LoopMcpService = Pick<
  LoopService,
  "runLoop" | "listLoops" | "inspectLoop" | "getLoopLogs" | "stopLoop"
>;

export interface RegisterLoopMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  loopService?: LoopMcpService | null;
  resolveScopedCwd: (requestedCwd?: string) => string;
}

export function registerLoopMcpTools(options: RegisterLoopMcpToolsOptions): void {
  const requireService = (): LoopMcpService => {
    if (!options.loopService) {
      throw new Error("Loop service is not configured");
    }
    return options.loopService;
  };

  options.registerTool(
    "run_loop",
    {
      title: "Run loop",
      description: "Start an iterative worker and verifier loop.",
      inputSchema: {
        prompt: z.string().trim().min(1),
        cwd: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Required for top-level MCP; agent-scoped calls inherit the caller cwd."),
        provider: AgentProviderSchema.optional(),
        model: z.string().trim().min(1).optional(),
        modeId: z.string().trim().min(1).optional(),
        workerProvider: AgentProviderSchema.optional(),
        workerModel: z.string().trim().min(1).optional(),
        verifierProvider: AgentProviderSchema.optional(),
        verifierModel: z.string().trim().min(1).optional(),
        verifierModeId: z.string().trim().min(1).optional(),
        verifyPrompt: z.string().trim().min(1).optional(),
        verifyChecks: z.array(z.string().trim().min(1)).optional(),
        archive: z.boolean().optional(),
        name: z.string().trim().min(1).optional(),
        sleepMs: z.number().int().nonnegative().optional(),
        maxIterations: z.number().int().positive().optional(),
        maxTimeMs: z.number().int().positive().optional(),
      },
      outputSchema: LoopRecordSchema.shape,
    },
    async ({ cwd, ...input }) => ({
      content: [],
      structuredContent: ensureValidJson(
        await requireService().runLoop({ ...input, cwd: options.resolveScopedCwd(cwd) }),
      ),
    }),
  );

  options.registerTool(
    "list_loops",
    {
      title: "List loops",
      description: "List loop runs ordered by creation time.",
      inputSchema: {},
      outputSchema: { loops: z.array(LoopListItemSchema) },
    },
    async () => ({
      content: [],
      structuredContent: ensureValidJson({ loops: await requireService().listLoops() }),
    }),
  );

  options.registerTool(
    "inspect_loop",
    {
      title: "Inspect loop",
      description: "Inspect a loop by id or unambiguous id prefix.",
      inputSchema: { id: z.string().trim().min(1) },
      outputSchema: LoopRecordSchema.shape,
    },
    async ({ id }) => ({
      content: [],
      structuredContent: ensureValidJson(await requireService().inspectLoop(id)),
    }),
  );

  options.registerTool(
    "loop_logs",
    {
      title: "Loop logs",
      description: "Read cursor-based loop logs and the current loop snapshot.",
      inputSchema: {
        id: z.string().trim().min(1),
        afterSeq: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        loop: LoopRecordSchema,
        entries: z.array(LoopLogEntrySchema),
        nextCursor: z.number().int().nonnegative(),
      },
    },
    async ({ id, afterSeq }) => {
      const result = await requireService().getLoopLogs(id, afterSeq ?? 0);
      return {
        content: [],
        structuredContent: ensureValidJson({
          loop: result.loop,
          entries: result.entries,
          nextCursor: result.nextCursor,
        }),
      };
    },
  );

  options.registerTool(
    "stop_loop",
    {
      title: "Stop loop",
      description: "Stop a running loop and wait for its active agents to settle.",
      inputSchema: { id: z.string().trim().min(1) },
      outputSchema: LoopRecordSchema.shape,
    },
    async ({ id }) => ({
      content: [],
      structuredContent: ensureValidJson(await requireService().stopLoop(id)),
    }),
  );
}
