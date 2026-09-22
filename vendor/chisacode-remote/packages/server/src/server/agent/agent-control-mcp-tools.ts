import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { z } from "zod/v3";

import {
  AgentListItemPayloadSchema,
  AgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema,
} from "../messages.js";
import type { AgentListItemPayload } from "../messages.js";
import { ensureValidJson } from "../json-utils.js";
import { isStoredAgentProviderAvailable } from "../persistence-hooks.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import { curateAgentActivity } from "./activity-curator.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import type { AgentManager, WaitForAgentResult } from "./agent-manager.js";
import {
  buildStoredAgentPayload,
  toAgentListItemPayload,
  toAgentPayload,
} from "./agent-projections.js";
import { sendPromptToAgent, setupFinishNotification } from "./agent-prompt.js";
import type { AgentStorage } from "./agent-storage.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "./lifecycle-command.js";
import {
  AgentStatusEnum,
  sanitizePermissionRequest,
  serializeSnapshotWithMetadata,
  waitForAgentWithTimeout,
} from "./mcp-shared.js";
import { respondToAgentPermission } from "./permission-response.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import { selectItemsByProjectedLimit } from "./timeline-projection.js";
import { WaitForAgentTracker } from "./wait-for-agent-tracker.js";

const UpdateAgentSettingsInputSchema = z
  .object({
    modeId: z.string().optional().describe("Session mode ID."),
    model: z.string().nullable().optional().describe("Model ID. Pass null to clear."),
    thinkingOptionId: z
      .string()
      .nullable()
      .optional()
      .describe("Thinking option ID. Pass null to clear."),
    features: z
      .record(z.unknown())
      .optional()
      .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
  })
  .strict();

/** Dependencies and workspace-scope policy for Agent MCP control tools. */
export interface RegisterAgentControlMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  callerAgentId?: string;
  logger: Logger;
  resolveScopedCwd(requestedCwd?: string, options?: { required?: boolean }): string;
  resolveScopeRoot(): string | null;
}

/** Registers Agent query, lifecycle, activity, and permission tools. */
export function registerAgentControlMcpTools(options: RegisterAgentControlMcpToolsOptions): void {
  const { agentManager, agentStorage, providerSnapshotManager, callerAgentId, logger } = options;
  const waitTracker = new WaitForAgentTracker(logger);

  options.registerTool(
    "wait_for_agent",
    {
      title: "Wait for agent",
      description:
        "Block until the agent requests permission or the current run completes. Returns the pending permission (if any) and recent activity summary.",
      inputSchema: {
        agentId: z.string().describe("Agent identifier returned by the create_agent tool"),
      },
      outputSchema: {
        agentId: z.string(),
        status: AgentStatusEnum,
        permission: AgentPermissionRequestPayloadSchema.nullable(),
        lastMessage: z.string().nullable(),
      },
    },
    async ({ agentId }, { signal }) => {
      await assertAgentInScope(options, agentId);
      const abortController = new AbortController();
      const cleanupFns: Array<() => void> = [];

      const cleanup = () => {
        while (cleanupFns.length) {
          const fn = cleanupFns.pop();
          try {
            fn?.();
          } catch {
            // Ignore cleanup errors.
          }
        }
      };

      const forwardExternalAbort = () => {
        if (!abortController.signal.aborted) {
          const reason = signal?.reason ?? new Error("wait_for_agent aborted");
          abortController.abort(reason);
        }
      };

      if (signal) {
        if (signal.aborted) {
          forwardExternalAbort();
        } else {
          signal.addEventListener("abort", forwardExternalAbort, { once: true });
          cleanupFns.push(() => signal.removeEventListener("abort", forwardExternalAbort));
        }
      }

      const unregister = waitTracker.register(agentId, (reason) => {
        if (!abortController.signal.aborted) {
          abortController.abort(new Error(reason ?? "wait_for_agent cancelled"));
        }
      });
      cleanupFns.push(unregister);

      try {
        const result: WaitForAgentResult = await waitForAgentWithTimeout(agentManager, agentId, {
          signal: abortController.signal,
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            agentId,
            status: result.status,
            permission: sanitizePermissionRequest(result.permission),
            lastMessage: result.lastMessage,
          }),
        };
      } finally {
        cleanup();
      }
    },
  );

  options.registerTool(
    "send_agent_prompt",
    {
      title: "Send agent prompt",
      description:
        "Send a task to a running agent. Returns immediately after the agent begins processing.",
      inputSchema: {
        agentId: z.string(),
        prompt: z.string(),
        sessionMode: z
          .string()
          .optional()
          .describe("Optional mode to set before running the prompt."),
        background: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
          ),
        notifyOnFinish: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Send a notification prompt to the caller agent when this agent finishes, errors, or needs permission.",
          ),
      },
      outputSchema: {
        success: z.boolean(),
        status: AgentStatusEnum,
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
      },
    },
    async ({ agentId, prompt, sessionMode, background = false, notifyOnFinish = false }) => {
      await assertAgentInScope(options, agentId);
      if (agentManager.hasInFlightRun(agentId)) {
        waitTracker.cancel(agentId, "Agent run interrupted by new prompt");
      }

      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        logger,
      });

      if (notifyOnFinish && callerAgentId) {
        setupFinishNotification({
          agentManager,
          agentStorage,
          childAgentId: agentId,
          callerAgentId,
          logger,
        });
      }

      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, agentId, {
          waitForActive: true,
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            success: true,
            status: result.status,
            lastMessage: result.lastMessage,
            permission: sanitizePermissionRequest(result.permission),
          }),
        };
      }

      const currentSnapshot = agentManager.getAgent(agentId);
      return {
        content: [],
        structuredContent: ensureValidJson({
          success: true,
          status: currentSnapshot?.lifecycle ?? "idle",
          lastMessage: null,
          permission: null,
        }),
      };
    },
  );

  options.registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description:
        "Return the latest snapshot for an agent, including lifecycle state, capabilities, and pending permissions.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        status: AgentStatusEnum,
        snapshot: AgentSnapshotPayloadSchema,
      },
    },
    async ({ agentId }) => {
      await assertAgentInScope(options, agentId);
      const snapshot = agentManager.getAgent(agentId);
      if (snapshot) {
        const structuredSnapshot = await serializeSnapshotWithMetadata(
          agentStorage,
          snapshot,
          logger,
        );
        return {
          content: [],
          structuredContent: ensureValidJson({
            status: snapshot.lifecycle,
            snapshot: structuredSnapshot,
          }),
        };
      }

      const record = await agentStorage.get(agentId);
      if (!record || record.internal) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const structuredSnapshot = buildStoredAgentPayload(
        record,
        providerSnapshotManager.listRegisteredProviderIds(),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          status: structuredSnapshot.status,
          snapshot: structuredSnapshot,
        }),
      };
    },
  );

  options.registerTool(
    "list_agents",
    {
      title: "List agents",
      description: "List recent agents as compact metadata.",
      inputSchema: {
        includeArchived: z.boolean().optional().default(false),
        cwd: z.string().optional(),
        sinceHours: z
          .number()
          .int()
          .positive()
          .max(24 * 30)
          .optional()
          .default(48),
        statuses: z.array(AgentStatusEnum).optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
      },
      outputSchema: {
        agents: z.array(AgentListItemPayloadSchema),
      },
    },
    async ({ includeArchived = false, cwd, sinceHours = 48, statuses, limit = 50 }) => {
      const requestedCwd = resolveListAgentsCwd(options, cwd);
      const statusFilter = statuses && statuses.length > 0 ? new Set(statuses) : null;
      const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
      const liveSnapshots = agentManager.listAgents();
      const liveAgents = await Promise.all(
        liveSnapshots.map((snapshot) =>
          serializeSnapshotWithMetadata(agentStorage, snapshot, logger),
        ),
      );
      const liveIds = new Set(liveSnapshots.map((snapshot) => snapshot.id));
      const storedRecords = await agentStorage.list();
      const registeredProviderIds = providerSnapshotManager.listRegisteredProviderIds();
      const storedAgents = storedRecords
        .filter((record) => !record.internal && !liveIds.has(record.id))
        .filter((record) => includeArchived || !record.archivedAt)
        .filter(
          (record) =>
            includeArchived || isStoredAgentProviderAvailable(record, registeredProviderIds),
        )
        .map((record) => buildStoredAgentPayload(record, registeredProviderIds));
      const agents = [...liveAgents, ...storedAgents]
        .map(toAgentListItemPayload)
        .filter((agent) => !requestedCwd || isSameOrDescendantPath(requestedCwd, agent.cwd))
        .filter((agent) => !statusFilter || statusFilter.has(agent.status))
        .filter((agent) => !agent.archivedAt || resolveAgentListActivityTime(agent) >= sinceMs)
        .sort(compareAgentListItems)
        .slice(0, limit);

      return {
        content: [],
        structuredContent: ensureValidJson({ agents }),
      };
    },
  );

  options.registerTool(
    "cancel_agent",
    {
      title: "Cancel agent run",
      description: "Abort the agent's current run but keep the agent alive for future tasks.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await assertAgentInScope(options, agentId);
      const { cancelled } = await cancelAgentRunCommand({ agentManager, logger }, agentId);
      if (cancelled) {
        waitTracker.cancel(agentId, "Agent run cancelled");
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ success: cancelled }),
      };
    },
  );

  options.registerTool(
    "archive_agent",
    {
      title: "Archive agent",
      description:
        "Archive an agent (soft-delete). The agent is interrupted if running and removed from the active list.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await assertAgentInScope(options, agentId);
      await archiveAgentCommand({ agentManager, agentStorage, logger }, agentId);
      waitTracker.cancel(agentId, "Agent archived");
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  options.registerTool(
    "kill_agent",
    {
      title: "Kill agent",
      description: "Terminate an agent session permanently.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await assertAgentInScope(options, agentId);
      await closeAgentCommand({ agentManager }, agentId);
      waitTracker.cancel(agentId, "Agent terminated");
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  options.registerTool(
    "update_agent",
    {
      title: "Update agent",
      description: "Update an agent name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the agent.",
        ),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, name, labels, settings }) => {
      await assertAgentInScope(options, agentId);
      if (settings?.modeId !== undefined) {
        await agentManager.setAgentMode(agentId, settings.modeId);
      }
      if (settings?.model !== undefined) {
        await agentManager.setAgentModel(agentId, settings.model);
      }
      if (settings?.thinkingOptionId !== undefined) {
        await agentManager.setAgentThinkingOption(agentId, settings.thinkingOptionId);
      }
      if (settings?.features) {
        for (const [featureId, value] of Object.entries(settings.features)) {
          await agentManager.setAgentFeature(agentId, featureId, value);
        }
      }

      await updateAgentCommand({ agentManager }, { agentId, name, labels });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  options.registerTool(
    "get_agent_activity",
    {
      title: "Get agent activity",
      description: "Return recent agent timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .optional()
          .describe("Optional limit for number of activities to include (most recent first)."),
      },
      outputSchema: {
        agentId: z.string(),
        updateCount: z.number(),
        currentModeId: z.string().nullable(),
        content: z.string(),
      },
    },
    async ({ agentId, limit }) => {
      await assertAgentInScope(options, agentId);
      await ensureAgentLoaded(agentId, { agentManager, agentStorage, logger });
      const timeline = agentManager.getTimeline(agentId);
      const snapshot = agentManager.getAgent(agentId);
      const selection = selectItemsByProjectedLimit({
        items: timeline,
        direction: "tail",
        limit: limit ?? 0,
      });
      const curatedContent = curateAgentActivity(selection.items);
      const { totalProjected, shownProjected } = selection;
      const noun = totalProjected === 1 ? "activity" : "activities";
      const countHeader =
        limit && shownProjected < totalProjected
          ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
          : `Showing all ${totalProjected} ${noun}`;

      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          updateCount: timeline.length,
          currentModeId: snapshot?.currentModeId ?? null,
          content: `${countHeader}\n\n${curatedContent}`,
        }),
      };
    },
  );

  options.registerTool(
    "set_agent_mode",
    {
      title: "Set agent session mode",
      description:
        "Switch the agent's session mode (plan, bypassPermissions, read-only, auto, etc.).",
      inputSchema: {
        agentId: z.string(),
        modeId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
        newMode: z.string(),
      },
    },
    async ({ agentId, modeId }) => {
      await assertAgentInScope(options, agentId);
      const result = await setAgentModeCommand({ agentManager }, { agentId, modeId });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true, newMode: result.modeId }),
      };
    },
  );

  options.registerTool(
    "list_pending_permissions",
    {
      title: "List pending permissions",
      description:
        "Return pending permission requests across all agents permitted by the caller workspace scope.",
      inputSchema: {},
      outputSchema: {
        permissions: z.array(
          z.object({
            agentId: z.string(),
            status: AgentStatusEnum,
            request: AgentPermissionRequestPayloadSchema,
          }),
        ),
      },
    },
    async () => {
      const scopeRoot = options.resolveScopeRoot();
      const permissions = agentManager
        .listAgents()
        .filter((agent) => !scopeRoot || isSameOrDescendantPath(scopeRoot, agent.cwd))
        .flatMap((agent) => {
          const payload = toAgentPayload(agent);
          return payload.pendingPermissions.map((request) => ({
            agentId: agent.id,
            status: payload.status,
            request,
          }));
        });

      return {
        content: [],
        structuredContent: ensureValidJson({ permissions }),
      };
    },
  );

  options.registerTool(
    "respond_to_permission",
    {
      title: "Respond to permission",
      description:
        "Approve or deny a pending permission request with an AgentManager-compatible response payload.",
      inputSchema: {
        agentId: z.string(),
        requestId: z.string(),
        response: AgentPermissionResponseSchema,
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, requestId, response }) => {
      await assertAgentInScope(options, agentId);
      await respondToAgentPermission({
        agentManager,
        agentId,
        requestId,
        response,
        logger,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );
}

async function assertAgentInScope(
  options: RegisterAgentControlMcpToolsOptions,
  agentId: string,
): Promise<void> {
  const liveAgent = options.agentManager.getAgent(agentId);
  if (liveAgent?.internal) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const scopeRoot = options.resolveScopeRoot();
  if (!scopeRoot) {
    return;
  }

  const storedAgent = liveAgent ? null : await options.agentStorage.get(agentId);
  if (!liveAgent && (!storedAgent || storedAgent.internal)) {
    throw new Error(`Agent ${agentId} not found`);
  }
  const cwd = liveAgent?.cwd ?? storedAgent?.cwd;
  if (!cwd || !isSameOrDescendantPath(scopeRoot, cwd)) {
    throw new Error(`Agent ${agentId} is outside the caller workspace scope`);
  }
}

function resolveListAgentsCwd(
  options: RegisterAgentControlMcpToolsOptions,
  requestedCwd?: string,
): string | undefined {
  if (requestedCwd?.trim()) {
    return options.resolveScopedCwd(requestedCwd, { required: true });
  }
  if (options.callerAgentId) {
    return options.resolveScopedCwd(undefined, { required: true });
  }
  return undefined;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveAgentListActivityTime(agent: AgentListItemPayload): number {
  return Math.max(
    parseTimestamp(agent.updatedAt),
    parseTimestamp(agent.lastUserMessageAt),
    parseTimestamp(agent.attentionTimestamp),
    parseTimestamp(agent.archivedAt),
    parseTimestamp(agent.createdAt),
  );
}

function compareAgentListItems(a: AgentListItemPayload, b: AgentListItemPayload): number {
  const attentionDelta =
    Number(b.requiresAttention ?? false) - Number(a.requiresAttention ?? false);
  if (attentionDelta !== 0) {
    return attentionDelta;
  }

  const statusOrder = {
    running: 0,
    initializing: 1,
    idle: 2,
    error: 3,
    closed: 4,
  } as Record<string, number>;
  const statusDelta = (statusOrder[a.status] ?? 999) - (statusOrder[b.status] ?? 999);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return resolveAgentListActivityTime(b) - resolveAgentListActivityTime(a);
}
