import { Command } from "commander";
import { runModeCommand } from "./mode.js";
import { addArchiveOptions, runArchiveCommand } from "./archive.js";
import { addDeleteOptions, runDeleteCommand } from "./delete.js";
import { addLsOptions, runLsCommand } from "./ls.js";
import { addRunOptions, runRunCommand } from "./run.js";
import { addLogsOptions, runLogsCommand } from "./logs.js";
import { addStopOptions, runStopCommand } from "./stop.js";
import { addSendOptions, runSendCommand } from "./send.js";
import { addInspectOptions, runInspectCommand } from "./inspect.js";
import { addWaitOptions, runWaitCommand } from "./wait.js";
import { addAttachOptions, runAttachCommand } from "./attach.js";
import { addReloadOptions, runReloadCommand } from "./reload.js";
import { addImportOptions, runImportCommand } from "./import.js";
import { runUpdateCommand } from "./update.js";
import { withOutput } from "../../output/index.js";
import {
  addDaemonHostOption,
  addJsonAndDaemonHostOptions,
  collectMultiple,
} from "../../utils/command-options.js";
import { tCli } from "../../i18n.js";

export function createAgentCommand(): Command {
  const agent = new Command("agent").description(tCli("agent.description"));

  // Primary agent commands (same as top-level)
  addJsonAndDaemonHostOptions(addLsOptions(agent.command("ls"))).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(addRunOptions(agent.command("run"))).action(
    withOutput(runRunCommand),
  );

  addJsonAndDaemonHostOptions(addImportOptions(agent.command("import"))).action(
    withOutput(runImportCommand),
  );

  addDaemonHostOption(addAttachOptions(agent.command("attach"))).action(runAttachCommand);

  addDaemonHostOption(addLogsOptions(agent.command("logs"))).action(runLogsCommand);

  addJsonAndDaemonHostOptions(addStopOptions(agent.command("stop"))).action(
    withOutput(runStopCommand),
  );

  addJsonAndDaemonHostOptions(addDeleteOptions(agent.command("delete"))).action(
    withOutput(runDeleteCommand),
  );

  addJsonAndDaemonHostOptions(addSendOptions(agent.command("send"))).action(
    withOutput(runSendCommand),
  );

  addJsonAndDaemonHostOptions(addInspectOptions(agent.command("inspect"))).action(
    withOutput(runInspectCommand),
  );

  addJsonAndDaemonHostOptions(addWaitOptions(agent.command("wait"))).action(
    withOutput(runWaitCommand),
  );

  // Advanced agent commands (less common operations)
  addJsonAndDaemonHostOptions(
    agent
      .command("mode")
      .description(tCli("agent.mode.description"))
      .argument("<id>", tCli("agent.id"))
      .argument("[mode]", tCli("agent.mode.value"))
      .option("--list", tCli("agent.mode.list")),
  ).action(withOutput(runModeCommand));

  addJsonAndDaemonHostOptions(addArchiveOptions(agent.command("archive"))).action(
    withOutput(runArchiveCommand),
  );

  addJsonAndDaemonHostOptions(addReloadOptions(agent.command("reload"))).action(
    withOutput(runReloadCommand),
  );

  addJsonAndDaemonHostOptions(
    agent
      .command("update")
      .description(tCli("agent.update.description"))
      .argument("<id>", tCli("agent.id"))
      .option("--name <name>", tCli("agent.update.name"))
      .option("--label <label>", tCli("agent.update.label"), collectMultiple, []),
  ).action(withOutput(runUpdateCommand));

  return agent;
}
