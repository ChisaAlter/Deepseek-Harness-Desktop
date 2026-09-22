import path from "path";
import type { Command } from "commander";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";
import { tCli } from "../../i18n.js";

/** Result type for worktree archive command */
export interface WorktreeArchiveResult {
  name: string;
  status: "archived";
  removedAgents: string[];
}

/** Schema for archive command output */
export const archiveSchema: OutputSchema<WorktreeArchiveResult> = {
  idField: "name",
  columns: [
    { header: "NAME", field: "name" },
    { header: "STATUS", field: "status" },
    {
      header: "REMOVED AGENTS",
      field: (item) => (item.removedAgents.length > 0 ? item.removedAgents.join(", ") : "-"),
    },
  ],
};

export interface WorktreeArchiveOptions extends CommandOptions {
  host?: string;
}

export type WorktreeArchiveCommandResult = SingleResult<WorktreeArchiveResult>;

export async function runArchiveCommand(
  nameArg: string,
  options: WorktreeArchiveOptions,
  _command: Command,
): Promise<WorktreeArchiveCommandResult> {
  const host = getDaemonHost({ host: options.host });

  // Validate arguments
  if (!nameArg || nameArg.trim().length === 0) {
    const error: CommandError = {
      code: "MISSING_WORKTREE_NAME",
      message: tCli("worktree.error.nameRequired"),
      details: tCli("worktree.error.archiveUsage"),
    };
    throw error;
  }

  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: tCli("worktree.error.connect", { host, message }),
      details: tCli("worktree.error.startDaemon"),
    };
    throw error;
  }

  try {
    // Get the list of worktrees first to resolve the name
    const listResponse = await client.getChisaCodeWorktreeList({});

    if (listResponse.error) {
      const error: CommandError = {
        code: "WORKTREE_LIST_FAILED",
        message: tCli("worktree.error.listFailed", { message: listResponse.error.message }),
      };
      throw error;
    }

    // Find the worktree by name or branch
    const worktree = listResponse.worktrees.find((wt) => {
      const name = path.basename(wt.worktreePath);
      return name === nameArg || wt.branchName === nameArg;
    });

    if (!worktree) {
      const error: CommandError = {
        code: "WORKTREE_NOT_FOUND",
        message: tCli("worktree.error.notFound", { name: nameArg }),
        details: tCli("worktree.error.listHint"),
      };
      throw error;
    }

    // Archive the worktree
    const response = await client.archiveChisaCodeWorktree({
      worktreePath: worktree.worktreePath,
    });

    await client.close();

    if (response.error) {
      const error: CommandError = {
        code: "WORKTREE_ARCHIVE_FAILED",
        message: tCli("worktree.error.archiveFailed", { message: response.error.message }),
      };
      throw error;
    }

    const worktreeName = path.basename(worktree.worktreePath) || nameArg;

    return {
      type: "single",
      data: {
        name: worktreeName,
        status: "archived",
        removedAgents: response.removedAgents ?? [],
      },
      schema: archiveSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});

    // Re-throw CommandError as-is
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "WORKTREE_ARCHIVE_FAILED",
      message: tCli("worktree.error.archiveFailed", { message }),
    };
    throw error;
  }
}
