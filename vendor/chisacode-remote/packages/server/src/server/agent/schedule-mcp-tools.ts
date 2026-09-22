import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ScheduleRunSchema,
  ScheduleSummarySchema,
  StoredScheduleSchema,
  type ScheduleCadence,
  type UpdateScheduleInput,
} from "@chisacode/protocol/schedule/types";
import { z } from "zod/v3";
import { ensureValidJson } from "../json-utils.js";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../path-utils.js";
import type { ScheduleService } from "../schedule/service.js";
import type { ManagedAgent } from "./agent-manager.js";
import {
  AgentProviderEnum,
  parseDurationString,
  resolveProviderAndOptionalModel,
  toScheduleSummary,
} from "./mcp-shared.js";

/** Schedule operations exposed through the agent MCP server. */
export type ScheduleMcpService = Pick<
  ScheduleService,
  "create" | "list" | "inspect" | "pause" | "resume" | "delete" | "runOnce" | "update" | "logs"
>;

/** Dependencies required to register schedule MCP tools. */
export interface RegisterScheduleMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  scheduleService?: ScheduleMcpService | null;
  callerAgentId?: string;
  resolveCallerAgent: () => ManagedAgent | null;
  resolveScopedCwd: (requestedCwd?: string) => string;
}

interface ScheduleUpdateToolInput {
  id: string;
  every?: string;
  cron?: string;
  name?: string | null;
  prompt?: string;
  maxRuns?: number | null;
  provider?: string;
  model?: string | null;
  mode?: string | null;
  cwd?: string;
  expiresIn?: string;
  clearExpires?: boolean;
}

function resolveScheduleUpdateProviderAndModel(params: {
  provider?: string;
  model?: string | null;
}): { provider?: string; model?: string | null } {
  const providerInput = params.provider?.trim();
  const modelInput = typeof params.model === "string" ? params.model.trim() : params.model;

  if (params.model !== undefined && modelInput === "") {
    throw new Error("model cannot be empty");
  }
  if (!providerInput) {
    return params.model !== undefined ? { model: modelInput } : {};
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      ...(params.model !== undefined ? { model: modelInput } : {}),
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }
  if (params.model === null) {
    throw new Error("provider specifies a model but model is null");
  }
  if (typeof modelInput === "string" && modelInput !== modelFromProvider) {
    throw new Error("Conflicting model values provided");
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}

function normalizeScheduleCadenceArg(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveScheduleUpdateCadence(input: ScheduleUpdateToolInput): ScheduleCadence | undefined {
  const every = normalizeScheduleCadenceArg(input.every);
  const cron = normalizeScheduleCadenceArg(input.cron);
  if (every !== undefined && cron !== undefined) {
    throw new Error("Specify at most one of every or cron");
  }
  if (every !== undefined) {
    return { type: "every", everyMs: parseDurationString(every) };
  }
  if (cron !== undefined) {
    return { type: "cron", expression: cron };
  }
  return undefined;
}

function resolveScheduleUpdateExpiresAt(input: ScheduleUpdateToolInput): string | null | undefined {
  if (input.expiresIn !== undefined && input.clearExpires) {
    throw new Error("Specify at most one of expiresIn or clearExpires");
  }
  if (input.expiresIn !== undefined) {
    return new Date(Date.now() + parseDurationString(input.expiresIn)).toISOString();
  }
  return input.clearExpires ? null : undefined;
}

function buildScheduleUpdateInput(
  input: ScheduleUpdateToolInput,
  resolveScopedCwd: (requestedCwd?: string) => string,
): UpdateScheduleInput {
  const cadence = resolveScheduleUpdateCadence(input);
  const expiresAt = resolveScheduleUpdateExpiresAt(input);
  const providerModelPatch = resolveScheduleUpdateProviderAndModel({
    provider: input.provider,
    model: input.model,
  });
  const newAgentConfig = {
    ...(providerModelPatch.provider !== undefined ? { provider: providerModelPatch.provider } : {}),
    ...(providerModelPatch.model !== undefined ? { model: providerModelPatch.model } : {}),
    ...(input.mode !== undefined ? { modeId: input.mode } : {}),
    ...(input.cwd !== undefined ? { cwd: resolveScopedCwd(input.cwd) } : {}),
  };

  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(Object.keys(newAgentConfig).length > 0 ? { newAgentConfig } : {}),
  };
}

function buildCallerAgentScheduleConfigExtras(callerAgent: ManagedAgent): Record<string, unknown> {
  return {
    ...(callerAgent.config.thinkingOptionId
      ? { thinkingOptionId: callerAgent.config.thinkingOptionId }
      : {}),
    ...(callerAgent.config.approvalPolicy
      ? { approvalPolicy: callerAgent.config.approvalPolicy }
      : {}),
    ...(callerAgent.config.sandboxMode ? { sandboxMode: callerAgent.config.sandboxMode } : {}),
    ...(typeof callerAgent.config.networkAccess === "boolean"
      ? { networkAccess: callerAgent.config.networkAccess }
      : {}),
    ...(typeof callerAgent.config.webSearch === "boolean"
      ? { webSearch: callerAgent.config.webSearch }
      : {}),
    ...(callerAgent.config.title ? { title: callerAgent.config.title } : {}),
    ...(callerAgent.config.extra ? { extra: callerAgent.config.extra } : {}),
    ...(callerAgent.config.featureValues
      ? { featureValues: callerAgent.config.featureValues }
      : {}),
    ...(callerAgent.config.systemPrompt ? { systemPrompt: callerAgent.config.systemPrompt } : {}),
    ...(callerAgent.config.mcpServers ? { mcpServers: callerAgent.config.mcpServers } : {}),
  };
}

function buildCallerAgentScheduleConfig(options: {
  callerAgent: ManagedAgent;
  provider?: string;
  cwd?: string;
  resolveScopedCwd: (requestedCwd?: string) => string;
}) {
  const hasProviderOverride = options.provider !== undefined;
  const resolvedProviderModel = hasProviderOverride
    ? resolveProviderAndOptionalModel(options.provider, options.callerAgent.provider)
    : null;
  const resolvedProvider = resolvedProviderModel?.provider ?? options.callerAgent.provider;
  const resolvedModel =
    resolvedProviderModel?.model ??
    (!hasProviderOverride ? options.callerAgent.config.model : undefined);

  return {
    provider: resolvedProvider,
    cwd: options.resolveScopedCwd(options.cwd),
    ...(options.callerAgent.currentModeId && options.callerAgent.provider === resolvedProvider
      ? { modeId: options.callerAgent.currentModeId }
      : {}),
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...buildCallerAgentScheduleConfigExtras(options.callerAgent),
  };
}

function isSamePath(left: string, right: string): boolean {
  return isSameOrDescendantPath(left, right) && isSameOrDescendantPath(right, left);
}

/** Registers schedule lifecycle and execution tools on an MCP server. */
export function registerScheduleMcpTools(options: RegisterScheduleMcpToolsOptions): void {
  const requireService = (): ScheduleMcpService => {
    if (!options.scheduleService) {
      throw new Error("Schedule service is not configured");
    }
    return options.scheduleService;
  };

  const resolveNewAgentScheduleTarget = (params?: { provider?: string; cwd?: string }) => {
    if (!params?.provider?.trim()) {
      throw new Error("provider is required when target is new-agent");
    }

    const callerAgent = options.resolveCallerAgent();
    if (callerAgent) {
      return {
        type: "new-agent" as const,
        config: buildCallerAgentScheduleConfig({
          callerAgent,
          provider: params.provider,
          cwd: params.cwd,
          resolveScopedCwd: options.resolveScopedCwd,
        }),
      };
    }

    const resolvedProviderModel = resolveProviderAndOptionalModel(params.provider, params.provider);
    return {
      type: "new-agent" as const,
      config: {
        provider: resolvedProviderModel.provider,
        cwd: params.cwd?.trim() ? expandUserPath(params.cwd) : process.cwd(),
        ...(resolvedProviderModel.model ? { model: resolvedProviderModel.model } : {}),
      },
    };
  };

  options.registerTool(
    "create_schedule",
    {
      title: "Create schedule",
      description: "Create a recurring schedule that runs on an agent or a new agent.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        every: z.string().optional(),
        cron: z.string().optional(),
        name: z.string().optional(),
        target: z.enum(["self", "new-agent"]).optional(),
        provider: AgentProviderEnum.optional().describe(
          "Provider, or provider/model (for example: codex or codex/gpt-5.4).",
        ),
        cwd: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({ prompt, every, cron, name, target, provider, cwd, maxRuns, expiresIn }) => {
      const normalizedEvery = normalizeScheduleCadenceArg(every);
      const normalizedCron = normalizeScheduleCadenceArg(cron);
      const cadenceCount =
        Number(normalizedEvery !== undefined) + Number(normalizedCron !== undefined);
      if (cadenceCount !== 1) {
        throw new Error("Specify exactly one of every or cron");
      }

      const scheduleTarget =
        target === "self"
          ? (() => {
              const callerAgent = options.resolveCallerAgent();
              if (!options.callerAgentId || !callerAgent) {
                throw new Error("target=self requires a caller agent");
              }
              const trimmedCwd = cwd?.trim();
              if (
                trimmedCwd &&
                !isSamePath(callerAgent.cwd, resolvePathFromBase(callerAgent.cwd, trimmedCwd))
              ) {
                throw new Error("cwd can only differ from the caller agent when target=new-agent");
              }
              if (provider !== undefined) {
                const resolved = resolveProviderAndOptionalModel(provider, callerAgent.provider);
                if (
                  resolved.provider !== callerAgent.provider ||
                  (resolved.model !== undefined && resolved.model !== callerAgent.config.model)
                ) {
                  throw new Error(
                    "provider can only differ from the caller agent when target=new-agent",
                  );
                }
              }
              return { type: "agent" as const, agentId: options.callerAgentId };
            })()
          : resolveNewAgentScheduleTarget({ provider, cwd });

      const schedule = await requireService().create({
        prompt: prompt.trim(),
        cadence:
          normalizedEvery !== undefined
            ? { type: "every" as const, everyMs: parseDurationString(normalizedEvery) }
            : { type: "cron" as const, expression: normalizedCron! },
        target: scheduleTarget,
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresIn === undefined
          ? {}
          : { expiresAt: new Date(Date.now() + parseDurationString(expiresIn)).toISOString() }),
      });
      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  options.registerTool(
    "list_schedules",
    {
      title: "List schedules",
      description: "List all schedules managed by the daemon.",
      inputSchema: {},
      outputSchema: { schedules: z.array(ScheduleSummarySchema) },
    },
    async () => ({
      content: [],
      structuredContent: ensureValidJson({
        schedules: (await requireService().list()).map((schedule) => toScheduleSummary(schedule)),
      }),
    }),
  );

  options.registerTool(
    "inspect_schedule",
    {
      title: "Inspect schedule",
      description: "Inspect a schedule and its run history.",
      inputSchema: { id: z.string() },
      outputSchema: StoredScheduleSchema.shape,
    },
    async ({ id }) => ({
      content: [],
      structuredContent: ensureValidJson(await requireService().inspect(id)),
    }),
  );

  options.registerTool(
    "run_schedule",
    {
      title: "Run schedule",
      description: "Trigger one immediate run of a schedule.",
      inputSchema: { id: z.string() },
      outputSchema: StoredScheduleSchema.shape,
    },
    async ({ id }) => ({
      content: [],
      structuredContent: ensureValidJson(await requireService().runOnce(id)),
    }),
  );

  for (const tool of [
    {
      name: "pause_schedule",
      title: "Pause schedule",
      description: "Pause an active schedule.",
      action: "pause" as const,
    },
    {
      name: "resume_schedule",
      title: "Resume schedule",
      description: "Resume a paused schedule.",
      action: "resume" as const,
    },
    {
      name: "delete_schedule",
      title: "Delete schedule",
      description: "Delete a schedule permanently.",
      action: "delete" as const,
    },
  ]) {
    options.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: { id: z.string() },
        outputSchema: { success: z.boolean() },
      },
      async ({ id }) => {
        await requireService()[tool.action](id);
        return { content: [], structuredContent: ensureValidJson({ success: true }) };
      },
    );
  }

  options.registerTool(
    "update_schedule",
    {
      title: "Update schedule",
      description:
        "Update an existing schedule. Only provided fields are changed; omitted fields remain unchanged.",
      inputSchema: {
        id: z.string(),
        every: z.string().optional().describe("New interval duration string (e.g. 5m, 1h)."),
        cron: z.string().optional().describe("New cron expression."),
        name: z.string().nullable().optional().describe("New name (null to clear)."),
        prompt: z.string().trim().min(1).optional().describe("New prompt text."),
        maxRuns: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("New max runs limit (null to clear)."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider for new-agent target."),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model for new-agent target (null to clear)."),
        mode: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New mode for new-agent target (null to clear)."),
        cwd: z.string().trim().min(1).optional().describe("New cwd for new-agent target."),
        expiresIn: z
          .string()
          .optional()
          .describe("New relative expiry duration (for example: 1h, 2d)."),
        clearExpires: z.boolean().optional().describe("Clear any schedule expiry."),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async (input) => ({
      content: [],
      structuredContent: ensureValidJson(
        await requireService().update(buildScheduleUpdateInput(input, options.resolveScopedCwd)),
      ),
    }),
  );

  options.registerTool(
    "schedule_logs",
    {
      title: "Schedule logs",
      description: "Get the run history (logs) for a schedule.",
      inputSchema: { id: z.string() },
      outputSchema: { runs: z.array(ScheduleRunSchema) },
    },
    async ({ id }) => ({
      content: [],
      structuredContent: ensureValidJson({ runs: await requireService().logs(id) }),
    }),
  );
}
