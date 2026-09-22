import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runArchiveCommand } from "./archive.js";
import { runCreateCommand } from "./create.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { tCli } from "../../i18n.js";

export function createWorktreeCommand(): Command {
  const worktree = new Command("worktree").description(tCli("worktree.description"));

  addJsonAndDaemonHostOptions(
    worktree.command("ls").description(tCli("worktree.ls.description")),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    worktree
      .command("create")
      .description(tCli("worktree.create.description"))
      .option("--mode <mode>", tCli("worktree.create.mode"))
      .option("--new-branch <name>", tCli("worktree.create.newBranch"))
      .option("--base <ref>", tCli("worktree.create.base"))
      .option("--branch <name>", tCli("worktree.create.branch"))
      .option("--pr-number <n>", tCli("worktree.create.pr"))
      .option("--cwd <path>", tCli("worktree.create.cwd")),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    worktree
      .command("archive")
      .description(tCli("worktree.archive.description"))
      .argument("<name>", tCli("worktree.name")),
  ).action(withOutput(runArchiveCommand));

  return worktree;
}
