import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runAllowCommand } from "./allow.js";
import { runDenyCommand } from "./deny.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { tCli } from "../../i18n.js";

export function createPermitCommand(): Command {
  const permit = new Command("permit").description(tCli("permit.description"));

  addJsonAndDaemonHostOptions(
    permit.command("ls").description(tCli("permit.ls.description")),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    permit
      .command("allow")
      .description(tCli("permit.allow.description"))
      .argument("<agent>", tCli("permit.agent"))
      .argument("[req_id]", tCli("permit.request"))
      .option("--all", tCli("permit.allowAll"))
      .option("--input <json>", tCli("permit.input")),
  ).action(withOutput(runAllowCommand));

  addJsonAndDaemonHostOptions(
    permit
      .command("deny")
      .description(tCli("permit.deny.description"))
      .argument("<agent>", tCli("permit.agent"))
      .argument("[req_id]", tCli("permit.request"))
      .option("--all", tCli("permit.denyAll"))
      .option("--message <msg>", tCli("permit.message"))
      .option("--interrupt", tCli("permit.interrupt")),
  ).action(withOutput(runDenyCommand));

  return permit;
}
