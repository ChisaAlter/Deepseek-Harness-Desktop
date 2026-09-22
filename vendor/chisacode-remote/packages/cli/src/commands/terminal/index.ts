import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addDaemonHostOption, addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCaptureCommand } from "./capture.js";
import { runCreateCommand } from "./create.js";
import { runKillCommand } from "./kill.js";
import { runLsCommand } from "./ls.js";
import { runSendKeysCommand } from "./send-keys.js";
import { tCli } from "../../i18n.js";

export function createTerminalCommand(): Command {
  const terminal = new Command("terminal").description(tCli("terminal.description"));

  addJsonAndDaemonHostOptions(
    terminal
      .command("ls")
      .description(tCli("terminal.ls.description"))
      .option("--all", tCli("terminal.ls.all"))
      .option("--cwd <path>", tCli("terminal.cwd")),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    terminal
      .command("create")
      .description(tCli("terminal.create.description"))
      .option("--cwd <path>", tCli("terminal.cwd"))
      .option("--name <name>", tCli("terminal.name")),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    terminal
      .command("kill")
      .description(tCli("terminal.kill.description"))
      .argument("<terminal-id>", tCli("terminal.id")),
  ).action(withOutput(runKillCommand));

  addDaemonHostOption(
    terminal
      .command("capture")
      .description(tCli("terminal.capture.description"))
      .argument("<terminal-id>", tCli("terminal.id"))
      .option("--start <n>", tCli("terminal.capture.start"))
      .option("--end <n>", tCli("terminal.capture.end"))
      .option("-S, --scrollback", tCli("terminal.capture.scrollback"))
      .option("--ansi", tCli("terminal.capture.ansi"))
      .option("--json", tCli("option.json")),
  ).action(runCaptureCommand);

  addDaemonHostOption(
    terminal
      .command("send-keys")
      .description(tCli("terminal.send.description"))
      .argument("<terminal-id>", tCli("terminal.id"))
      .argument("<keys...>", tCli("terminal.keys"))
      .option("-l, --literal", tCli("terminal.literal"))
      .option("--json", tCli("option.json")),
  ).action(runSendKeysCommand);

  return terminal;
}
