import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { z } from "zod/v3";

import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { ensureValidJson } from "../json-utils.js";
import { AgentPermissionRequestPayloadSchema } from "../messages.js";
import type { VoiceCallerContext } from "../voice-types.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { CreateChisaCodeWorktreeWorkflowFn } from "../worktree-session.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { createAgentCommand, type CreateAgentFromMcpInput } from "./create-agent/create.js";
import {
  AgentProviderEnum,
  AgentStatusEnum,
  ProviderModeSchema,
  resolveRequiredProviderModel,
  sanitizePermissionRequest,
  waitForAgentWithTimeout,
} from "./mcp-shared.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

const ProviderModelInputSchema = AgentProviderEnum.trim()
  .refine((value) => value.includes("/"), {
    message: "provider must be provider/model, for example codex/gpt-5.4",
  })
  .refine(
    (value) => {
      try {
        resolveRequiredProviderModel(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "provider must be provider/model, for example codex/gpt-5.4" },
  );

const CreateAgentSettingsInputSchema = z
  .object({
    modeId: z.string().optional().describe("Session mode to configure before the first run."),
    thinkingOptionId: z.string().optional().describe("Thinking option ID."),
    features: z
      .record(z.unknown())
      .optional()
      .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
  })
  .strict();

const agentToAgentInputSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Optional working directory. Defaults to the caller agent working directory."),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(60, "Title must be 60 characters or fewer")
    .describe("Short descriptive title (<= 60 chars) summarizing the agent's focus."),
  provider: ProviderModelInputSchema.describe(
    "Required provider/model pair, for example codex/gpt-5.4.",
  ),
  relationKind: z
    .enum(["subagent", "detached", "handoff", "team-slot"])
    .optional()
    .describe("Relationship to the caller agent. Defaults to subagent for agent-scoped calls."),
  labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
  settings: CreateAgentSettingsInputSchema.optional().describe(
    "Initial runtime settings for the new agent.",
  ),
  initialPrompt: z
    .string()
    .trim()
    .min(1, "initialPrompt is required")
    .describe("Required first task to run immediately after creation."),
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
      "Send a notification prompt to the caller agent when this agent finishes, errors, or needs permission. Requires a caller agent context.",
    ),
};

const topLevelInputSchema = {
  cwd: z.string().describe("Required working directory for the agent (absolute, relative, or ~)."),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(60, "Title must be 60 characters or fewer")
    .describe("Short descriptive title (<= 60 chars) summarizing the agent's focus."),
  provider: ProviderModelInputSchema.describe(
    "Required provider/model pair, for example codex/gpt-5.4.",
  ),
  labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
  settings: CreateAgentSettingsInputSchema.optional().describe(
    "Initial runtime settings for the new agent.",
  ),
  initialPrompt: z
    .string()
    .trim()
    .min(1, "initialPrompt is required")
    .describe("Required first task to run immediately after creation."),
  worktreeName: z
    .string()
    .optional()
    .describe("Optional git worktree branch name (lowercase alphanumerics + hyphen)."),
  baseBranch: z
    .string()
    .optional()
    .describe("Required when worktreeName is set: the base branch to diff/merge against."),
  refName: z.string().min(1).optional().describe("Optional source ref for worktree creation."),
  action: z
    .enum(["branch-off", "checkout"])
    .optional()
    .describe("Optional worktree creation action."),
  githubPrNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional GitHub pull request number to checkout."),
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
      "Send a notification prompt to the caller agent when this agent finishes, errors, or needs permission. Requires a caller agent context.",
    ),
};

const agentToAgentCreateAgentArgsSchema = z.object(agentToAgentInputSchema).strict();
const topLevelCreateAgentArgsSchema = z.object(topLevelInputSchema).strict();

type AgentToAgentCreateAgentArgs = z.infer<typeof agentToAgentCreateAgentArgsSchema>;
type TopLevelCreateAgentArgs = z.infer<typeof topLevelCreateAgentArgsSchema>;

/** Dependencies required to register the create_agent MCP tool. */
export interface RegisterCreateAgentMcpToolOptions {
  registerTool: McpServer["registerTool"];
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager?: TerminalManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  callerAgentId?: string;
  callerContext?: VoiceCallerContext | null;
  logger: Logger;
  chisacodeHome?: string;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot"
  >;
  createChisaCodeWorktree?: CreateChisaCodeWorktreeWorkflowFn;
}

/** Registers create_agent while delegating lifecycle and scope policy to createAgentCommand. */
export function registerCreateAgentMcpTool(options: RegisterCreateAgentMcpToolOptions): void {
  const inputSchema = options.callerAgentId ? agentToAgentInputSchema : topLevelInputSchema;

  options.registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create an agent tied to a working directory. Requires provider/model, for example codex/gpt-5.4. Do not guess; call list_providers and list_models first if uncertain. Optionally run an initial prompt immediately or create a git worktree for the agent.",
      inputSchema,
      outputSchema: {
        agentId: z.string(),
        type: AgentProviderEnum,
        status: AgentStatusEnum,
        cwd: z.string(),
        currentModeId: z.string().nullable(),
        availableModes: z.array(ProviderModeSchema),
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
      },
    },
    async (args: unknown) => {
      const { parsedArgs, worktree } = resolveCreateAgentToolArgs(args, options.callerAgentId);
      const { snapshot, background, initialPromptStarted } = await createAgentCommand(
        {
          agentManager: options.agentManager,
          agentStorage: options.agentStorage,
          logger: options.logger,
          chisacodeHome: options.chisacodeHome,
          workspaceGitService: options.workspaceGitService,
          terminalManager: options.terminalManager,
          providerSnapshotManager: options.providerSnapshotManager,
          createChisaCodeWorktree: options.createChisaCodeWorktree,
        },
        {
          kind: "mcp",
          provider: parsedArgs.provider,
          title: parsedArgs.title,
          initialPrompt: parsedArgs.initialPrompt,
          cwd: parsedArgs.cwd,
          thinking: parsedArgs.settings?.thinkingOptionId,
          features: parsedArgs.settings?.features,
          labels: parsedArgs.labels,
          relationKind: "relationKind" in parsedArgs ? parsedArgs.relationKind : undefined,
          mode: parsedArgs.settings?.modeId,
          background: parsedArgs.background ?? false,
          notifyOnFinish: parsedArgs.notifyOnFinish ?? false,
          callerAgentId: options.callerAgentId,
          callerContext: options.callerContext,
          worktree,
        },
      );

      try {
        if (!background && initialPromptStarted) {
          const result = await waitForAgentWithTimeout(options.agentManager, snapshot.id, {
            waitForActive: true,
          });
          const liveSnapshot = options.agentManager.getAgent(snapshot.id) ?? snapshot;
          return {
            content: [],
            structuredContent: ensureValidJson({
              agentId: snapshot.id,
              type: snapshot.provider,
              status: result.status,
              cwd: liveSnapshot.cwd,
              currentModeId: liveSnapshot.currentModeId,
              availableModes: liveSnapshot.availableModes,
              lastMessage: result.lastMessage,
              permission: sanitizePermissionRequest(result.permission),
            }),
          };
        }
      } catch (error) {
        options.logger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
        throw error;
      }

      const currentSnapshot = options.agentManager.getAgent(snapshot.id) ?? snapshot;
      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId: currentSnapshot.id,
          type: snapshot.provider,
          status: currentSnapshot.lifecycle,
          cwd: currentSnapshot.cwd,
          currentModeId: currentSnapshot.currentModeId,
          availableModes: currentSnapshot.availableModes,
          lastMessage: null,
          permission: null,
        }),
      };
    },
  );
}

function resolveCreateAgentToolArgs(
  args: unknown,
  callerAgentId?: string,
): {
  parsedArgs: AgentToAgentCreateAgentArgs | TopLevelCreateAgentArgs;
  worktree: CreateAgentFromMcpInput["worktree"];
} {
  if (callerAgentId) {
    return {
      parsedArgs: agentToAgentCreateAgentArgsSchema.parse(args),
      worktree: undefined,
    };
  }
  const parsedArgs = topLevelCreateAgentArgsSchema.parse(args);
  return {
    parsedArgs,
    worktree: resolveTopLevelCreateAgentWorktree(parsedArgs),
  };
}

function resolveTopLevelCreateAgentWorktree(
  args: TopLevelCreateAgentArgs,
): CreateAgentFromMcpInput["worktree"] {
  return {
    worktreeName: args.worktreeName,
    baseBranch: args.baseBranch,
    refName: args.refName,
    action: args.action,
    githubPrNumber: args.githubPrNumber,
  };
}
