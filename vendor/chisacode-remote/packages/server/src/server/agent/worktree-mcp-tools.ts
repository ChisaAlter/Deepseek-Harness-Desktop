import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { z } from "zod/v3";

import type { GitHubService } from "../../services/github-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import {
  killTerminalsUnderPath,
  type ArchiveChisaCodeWorktreeDependencies,
} from "../chisacode-worktree-archive-service.js";
import type { CreateChisaCodeWorktreeWorkflowFn } from "../worktree-session.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import { ensureValidJson } from "../json-utils.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import { WorktreeRequestError } from "../worktree-errors.js";
import {
  archiveChisaCodeWorktreeCommand,
  type ArchiveChisaCodeWorktreeCommandDependencies,
  createChisaCodeWorktreeCommand,
  type CreateChisaCodeWorktreeCommandInput,
  listChisaCodeWorktreesCommand,
} from "../worktree/commands.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";

const WorktreeSummarySchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  branchName: z.string().optional(),
  head: z.string().optional(),
});

type McpCreateWorktreeTarget =
  | { mode: "branch-off"; newBranch: string; base?: string }
  | { mode: "checkout-branch"; branch: string }
  | { mode: "checkout-pr"; prNumber: number };

/** Dependencies and caller-scope policy for worktree MCP tools. */
export interface RegisterWorktreeMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager?: TerminalManager | null;
  github?: GitHubService;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot"
  >;
  archiveWorkspaceRecord?: ArchiveChisaCodeWorktreeDependencies["archiveWorkspaceRecord"];
  emitWorkspaceUpdatesForWorkspaceIds?: ArchiveChisaCodeWorktreeDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
  markWorkspaceArchiving?: ArchiveChisaCodeWorktreeDependencies["markWorkspaceArchiving"];
  clearWorkspaceArchiving?: ArchiveChisaCodeWorktreeDependencies["clearWorkspaceArchiving"];
  createChisaCodeWorktree?: CreateChisaCodeWorktreeWorkflowFn;
  chisacodeHome?: string;
  logger: Logger;
  resolveScopedCwd(requestedCwd?: string, options?: { required?: boolean }): string;
  resolveScopeRoot(): string | null;
}

/** Registers worktree discovery and mutation tools with caller-workspace isolation. */
export function registerWorktreeMcpTools(options: RegisterWorktreeMcpToolsOptions): void {
  options.registerTool(
    "list_worktrees",
    {
      title: "List worktrees",
      description: "List ChisaCode-managed git worktrees for a repository.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to the caller agent cwd."),
      },
      outputSchema: {
        worktrees: z.array(WorktreeSummarySchema),
      },
    },
    async ({ cwd }) => {
      const resolvedCwd = options.resolveScopedCwd(cwd, { required: true });
      const workspaceGitService = requireWorkspaceGitService(options);
      const worktrees = await listChisaCodeWorktreesCommand(
        { workspaceGitService },
        {
          cwd: resolvedCwd,
          reason: "mcp:list-worktrees",
        },
      );
      const scopeRoot = options.resolveScopeRoot();
      const visibleWorktrees = scopeRoot
        ? worktrees.filter((worktree) => isSameOrDescendantPath(worktree.path, scopeRoot))
        : worktrees;

      return {
        content: [],
        structuredContent: ensureValidJson({ worktrees: visibleWorktrees }),
      };
    },
  );

  options.registerTool(
    "create_worktree",
    {
      title: "Create worktree",
      description:
        "Create a ChisaCode-managed git worktree. Branch off a new branch, check out an existing branch, or check out a GitHub PR.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository directory. Defaults to the agent's cwd."),
        target: z
          .discriminatedUnion("mode", [
            z
              .object({
                mode: z.literal("branch-off"),
                newBranch: z.string().min(1).describe("Name for the new branch."),
                base: z
                  .string()
                  .min(1)
                  .optional()
                  .describe("Base ref. Defaults to the repo's default branch."),
              })
              .describe("Create a new branch off a base."),
            z
              .object({
                mode: z.literal("checkout-branch"),
                branch: z.string().min(1).describe("Existing branch to check out."),
              })
              .describe("Check out an existing branch."),
            z
              .object({
                mode: z.literal("checkout-pr"),
                prNumber: z.number().int().positive().describe("Pull request number."),
              })
              .describe("Check out a GitHub pull request."),
          ])
          .describe("What the worktree should contain."),
      },
      outputSchema: {
        branchName: z.string(),
        worktreePath: z.string(),
      },
    },
    async ({ cwd, target }) => {
      if (options.resolveScopeRoot()) {
        throw new Error(
          "A workspace-scoped MCP caller cannot create worktrees outside its workspace scope",
        );
      }
      const repoRoot = options.resolveScopedCwd(cwd, { required: true });
      const commandResult = await createChisaCodeWorktreeCommand(
        {
          chisacodeHome: options.chisacodeHome,
          createChisaCodeWorktreeWorkflow: options.createChisaCodeWorktree,
        },
        createMcpWorktreeCommandInput(repoRoot, target),
      );
      if (!commandResult.ok) {
        throw new WorktreeRequestError(commandResult.error);
      }
      const { worktree } = commandResult.createdWorktree;
      await options.workspaceGitService?.listWorktrees?.(repoRoot, {
        force: true,
        reason: "mcp:create-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          branchName: worktree.branchName,
          worktreePath: worktree.worktreePath,
        }),
      };
    },
  );

  options.registerTool(
    "archive_worktree",
    {
      title: "Archive worktree",
      description: "Delete a ChisaCode-managed git worktree.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to the caller agent cwd."),
        worktreePath: z.string().optional(),
        worktreeSlug: z.string().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ cwd, worktreePath, worktreeSlug }) => {
      const resolvedCwd = options.resolveScopedCwd(cwd, { required: true });
      if (!worktreePath && !worktreeSlug) {
        throw new Error("worktreePath or worktreeSlug is required");
      }
      const workspaceGitService = requireWorkspaceGitService(options);
      const repoRoot = await workspaceGitService.resolveRepoRoot(resolvedCwd);
      const result = await archiveChisaCodeWorktreeCommand(buildArchiveDependencies(options), {
        requestId: "mcp:archive_worktree",
        repoRoot,
        worktreePath,
        worktreeSlug,
        allowedScopeRoot: options.resolveScopeRoot(),
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      await workspaceGitService.listWorktrees(repoRoot, {
        force: true,
        reason: "mcp:archive-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );
}

function requireWorkspaceGitService(
  options: RegisterWorktreeMcpToolsOptions,
): Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees" | "resolveRepoRoot"> {
  if (!options.workspaceGitService) {
    throw new Error("WorkspaceGitService is required for worktree operations");
  }
  return options.workspaceGitService;
}

function buildArchiveDependencies(
  options: RegisterWorktreeMcpToolsOptions,
): ArchiveChisaCodeWorktreeCommandDependencies {
  if (!options.github) {
    throw new Error("GitHub service is required to archive worktrees");
  }
  if (!options.archiveWorkspaceRecord) {
    throw new Error("Workspace registry archiver is required to archive worktrees");
  }
  if (!options.emitWorkspaceUpdatesForWorkspaceIds) {
    throw new Error("Workspace update emitter is required to archive worktrees");
  }
  if (!options.markWorkspaceArchiving) {
    throw new Error("Workspace archiving marker is required to archive worktrees");
  }
  if (!options.clearWorkspaceArchiving) {
    throw new Error("Workspace archiving clearer is required to archive worktrees");
  }

  return {
    chisacodeHome: options.chisacodeHome,
    github: options.github,
    workspaceGitService: requireWorkspaceGitService(options),
    agentManager: options.agentManager,
    agentStorage: options.agentStorage,
    archiveWorkspaceRecord: options.archiveWorkspaceRecord,
    emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
    markWorkspaceArchiving: options.markWorkspaceArchiving,
    clearWorkspaceArchiving: options.clearWorkspaceArchiving,
    isPathWithinRoot: isSameOrDescendantPath,
    killTerminalsUnderPath: (rootPath: string) =>
      killTerminalsUnderPath(
        {
          terminalManager: options.terminalManager ?? null,
          isPathWithinRoot: isSameOrDescendantPath,
          killTrackedTerminal: () => {},
          sessionLogger: options.logger,
        },
        rootPath,
      ),
    sessionLogger: options.logger,
  };
}

function createMcpWorktreeCommandInput(
  repoRoot: string,
  target: McpCreateWorktreeTarget,
): CreateChisaCodeWorktreeCommandInput {
  const base = { cwd: repoRoot } as const;
  switch (target.mode) {
    case "branch-off":
      return {
        ...base,
        worktreeSlug: target.newBranch,
        action: "branch-off",
        ...(target.base ? { refName: target.base } : {}),
      };
    case "checkout-branch":
      return { ...base, action: "checkout", refName: target.branch };
    case "checkout-pr":
      return { ...base, action: "checkout", githubPrNumber: target.prNumber };
    default:
      throw new Error("unreachable");
  }
}
