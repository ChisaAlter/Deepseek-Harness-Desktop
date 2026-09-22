import { z } from "zod/v3";
import { ensureValidJson } from "../json-utils.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type { Logger } from "pino";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createAgentCommand } from "./create-agent/create.js";
import { resolveRequiredProviderModel } from "./mcp-shared.js";
import { cancelAgentRunCommand } from "./lifecycle-command.js";
import { mapDelegationStatus, summarizeDelegationResult } from "./delegation-task-status.js";

export interface CompanionMcpToolDependencies {
  server: McpServer;
  parentAgentId: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  logger: Logger;
  registerTool: McpServer["registerTool"];
}

const RelationKindSchema = z.enum(["subagent", "detached", "handoff", "team-slot"]);

export function registerCompanionMcpTools(deps: CompanionMcpToolDependencies): void {
  deps.registerTool(
    "delegate_to_agent",
    {
      title: "Delegate to agent",
      description: "Create a scoped child agent and optionally run an initial prompt.",
      inputSchema: {
        title: z.string().trim().min(1).max(60),
        initialPrompt: z.string().trim().min(1),
        provider: z.string().trim().min(1).optional(),
        modeId: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        cwd: z.string().trim().min(1).optional(),
        relationKind: RelationKindSchema.optional(),
        background: z.boolean().optional().default(true),
      },
      outputSchema: {
        taskId: z.string(),
        agentId: z.string(),
        status: z.string(),
        title: z.string(),
      },
    },
    async (input) => {
      const parent = deps.agentManager.getAgent(deps.parentAgentId);
      if (!parent) {
        throw new Error(`Parent agent ${deps.parentAgentId} not found`);
      }
      let providerInput = parent.provider;
      if (parent.config.model) {
        providerInput = `${parent.provider}/${parent.config.model}`;
      }
      if (input.provider) {
        providerInput = input.model ? `${input.provider}/${input.model}` : input.provider;
      }
      const resolvedProviderModel = resolveRequiredProviderModel(providerInput);
      const result = await createAgentCommand(
        {
          agentManager: deps.agentManager,
          agentStorage: deps.agentStorage,
          logger: deps.logger,
          providerSnapshotManager: deps.providerSnapshotManager,
        },
        {
          kind: "mcp",
          provider: resolvedProviderModel.model
            ? `${resolvedProviderModel.provider}/${resolvedProviderModel.model}`
            : resolvedProviderModel.provider,
          title: input.title,
          initialPrompt: input.initialPrompt,
          cwd: input.cwd,
          mode: input.modeId ?? parent.currentModeId ?? undefined,
          background: input.background ?? true,
          notifyOnFinish: false,
          callerAgentId: deps.parentAgentId,
          relationKind: input.relationKind ?? "subagent",
        },
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          taskId: result.snapshot.id,
          agentId: result.snapshot.id,
          status: result.snapshot.lifecycle,
          title: input.title,
        }),
      };
    },
  );

  deps.registerTool(
    "get_delegation_status",
    {
      title: "Get delegation status",
      description: "Return the lifecycle-derived status for a delegated child agent.",
      inputSchema: { taskId: z.string() },
      outputSchema: {
        taskId: z.string(),
        agentId: z.string(),
        status: z.string(),
      },
    },
    async ({ taskId }) => {
      const agent = deps.agentManager.getAgent(taskId);
      const record = await deps.agentStorage.get(taskId);
      const timeline = agent ? deps.agentManager.getTimeline(taskId) : [];
      return {
        content: [],
        structuredContent: ensureValidJson({
          taskId,
          agentId: taskId,
          status: mapDelegationStatus({ agent, record, timeline }),
        }),
      };
    },
  );

  deps.registerTool(
    "cancel_delegation",
    {
      title: "Cancel delegation",
      description: "Interrupt a delegated child agent if it is currently running.",
      inputSchema: { taskId: z.string() },
      outputSchema: {
        taskId: z.string(),
        agentId: z.string(),
        status: z.string(),
        canceled: z.boolean(),
      },
    },
    async ({ taskId }) => {
      const record = await deps.agentStorage.get(taskId);
      if (record) {
        await deps.agentStorage.upsert({
          ...record,
          labels: { ...record.labels, "chisacode.delegation-status": "canceled" },
          updatedAt: new Date().toISOString(),
        });
      }
      let canceled = false;
      if (deps.agentManager.getAgent(taskId)) {
        canceled = (await cancelAgentRunCommand(deps, taskId)).cancelled;
      }
      return {
        content: [],
        structuredContent: ensureValidJson({
          taskId,
          agentId: taskId,
          status: "canceled",
          canceled,
        }),
      };
    },
  );

  deps.registerTool(
    "get_agent_result",
    {
      title: "Get agent result",
      description: "Return the last assistant text for a delegated child agent.",
      inputSchema: { taskId: z.string() },
      outputSchema: {
        taskId: z.string(),
        agentId: z.string(),
        status: z.string(),
        text: z.string(),
      },
    },
    async ({ taskId }) => {
      const agent = deps.agentManager.getAgent(taskId);
      const record = await deps.agentStorage.get(taskId);
      const timeline = agent ? deps.agentManager.getTimeline(taskId) : [];
      const status = mapDelegationStatus({ agent, record, timeline });
      return {
        content: [],
        structuredContent: ensureValidJson({
          taskId,
          agentId: taskId,
          status,
          text: summarizeDelegationResult(timeline),
        }),
      };
    },
  );
}
