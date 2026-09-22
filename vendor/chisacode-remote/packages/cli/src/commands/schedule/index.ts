import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runInspectCommand } from "./inspect.js";
import { runLogsCommand } from "./logs.js";
import { runPauseCommand } from "./pause.js";
import { runResumeCommand } from "./resume.js";
import { runDeleteCommand } from "./delete.js";
import { runRunOnceCommand } from "./run-once.js";
import { runUpdateCommand } from "./update.js";
import { tCli } from "../../i18n.js";

export function createScheduleCommand(): Command {
  const schedule = new Command("schedule").description(tCli("schedule.description"));

  addJsonAndDaemonHostOptions(
    schedule
      .command("create")
      .description(tCli("schedule.create.description"))
      .argument("<prompt>", tCli("schedule.prompt"))
      .option("--every <duration>", tCli("schedule.every"))
      .option("--cron <expr>", tCli("schedule.cron"))
      .option("--name <name>", tCli("schedule.name"))
      .option("--target <self|new-agent|agent-id>", tCli("schedule.target"))
      .option("--provider <provider>", tCli("agent.run.provider"))
      .option("--mode <mode>", tCli("agent.run.mode"))
      .option("--cwd <path>", tCli("schedule.cwd"))
      .option("--run-now", tCli("schedule.runNow"))
      .option("--no-run-now", tCli("schedule.noRunNow"))
      .option("--max-runs <n>", tCli("schedule.maxRuns"))
      .option("--expires-in <duration>", tCli("schedule.expiresIn")),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    schedule.command("ls").description(tCli("schedule.ls.description")),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("inspect")
      .description(tCli("schedule.inspect.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runInspectCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("logs")
      .description(tCli("schedule.logs.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runLogsCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("pause")
      .description(tCli("schedule.pause.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runPauseCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("resume")
      .description(tCli("schedule.resume.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runResumeCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("delete")
      .description(tCli("schedule.delete.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runDeleteCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("run-once")
      .description(tCli("schedule.trigger.description"))
      .argument("<id>", tCli("schedule.id")),
  ).action(withOutput(runRunOnceCommand));

  addJsonAndDaemonHostOptions(
    schedule
      .command("update")
      .description(tCli("schedule.update.description"))
      .argument("<id>", tCli("schedule.id"))
      .option("--every <duration>", tCli("schedule.update.every"))
      .option("--cron <expr>", tCli("schedule.update.cron"))
      .option("--name <name>", tCli("schedule.update.name"))
      .option("--prompt <text>", tCli("schedule.update.prompt"))
      .option("--provider <provider>", tCli("agent.run.provider"))
      .option("--model <model>", tCli("schedule.update.model"))
      .option("--mode <mode>", tCli("schedule.update.mode"))
      .option("--cwd <path>", tCli("schedule.update.cwd"))
      .option("--max-runs <n>", tCli("schedule.update.maxRuns"))
      .option("--no-max-runs", tCli("schedule.update.noMaxRuns"))
      .option("--expires-in <duration>", tCli("schedule.update.expiresIn"))
      .option("--no-expires-in", tCli("schedule.update.noExpiresIn")),
  ).action(withOutput(runUpdateCommand));

  return schedule;
}
