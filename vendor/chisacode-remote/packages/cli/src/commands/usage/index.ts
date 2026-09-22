import { Command } from "commander";

import { tCli } from "../../i18n.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runUsageClearCommand } from "./clear.js";
import { runUsageExportCommand } from "./export.js";
import { runUsageSummaryCommand } from "./summary.js";

/** Creates local usage reporting commands. */
export function createUsageCommand(): Command {
  const usage = new Command("usage").description(tCli("usage.description"));

  addJsonAndDaemonHostOptions(
    usage
      .command("summary")
      .description(tCli("usage.summary.description"))
      .option("--range <days>", tCli("usage.summary.range"), "30"),
  ).action(withOutput(runUsageSummaryCommand));

  addJsonAndDaemonHostOptions(
    usage
      .command("export")
      .description(tCli("usage.export.description"))
      .option("--type <format>", tCli("usage.export.format"), "json")
      .requiredOption("--output <path>", tCli("usage.export.output"))
      .option("--force", tCli("usage.export.force")),
  ).action(withOutput(runUsageExportCommand));

  addJsonAndDaemonHostOptions(
    usage
      .command("clear")
      .description(tCli("usage.clear.description"))
      .option("--yes", tCli("usage.clear.yes")),
  ).action(withOutput(runUsageClearCommand));
  return usage;
}
