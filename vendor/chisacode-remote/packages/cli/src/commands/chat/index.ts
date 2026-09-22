import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runInspectCommand } from "./inspect.js";
import { runDeleteCommand } from "./delete.js";
import { runPostCommand } from "./post.js";
import { runReadCommand } from "./read.js";
import { runWaitCommand } from "./wait.js";
import { tCli } from "../../i18n.js";

export function createChatCommand(): Command {
  const chat = new Command("chat").description(tCli("chat.description"));

  addJsonAndDaemonHostOptions(
    chat
      .command("create")
      .description(tCli("chat.create.description"))
      .argument("<name>", tCli("chat.roomName"))
      .option("--purpose <text>", tCli("chat.purpose")),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(chat.command("ls").description(tCli("chat.ls.description"))).action(
    withOutput(runLsCommand),
  );

  addJsonAndDaemonHostOptions(
    chat
      .command("inspect")
      .description(tCli("chat.inspect.description"))
      .argument("<name-or-id>", tCli("chat.roomId")),
  ).action(withOutput(runInspectCommand));

  addJsonAndDaemonHostOptions(
    chat
      .command("delete")
      .description(tCli("chat.delete.description"))
      .argument("<name-or-id>", tCli("chat.roomId")),
  ).action(withOutput(runDeleteCommand));

  addJsonAndDaemonHostOptions(
    chat
      .command("post")
      .description(tCli("chat.post.description"))
      .argument("<name-or-id>", tCli("chat.roomId"))
      .argument("<message>", tCli("chat.message"))
      .option("--reply-to <msg-id>", tCli("chat.replyTo")),
  ).action(withOutput(runPostCommand));

  addJsonAndDaemonHostOptions(
    chat
      .command("read")
      .description(tCli("chat.read.description"))
      .argument("<name-or-id>", tCli("chat.roomId"))
      .option("--limit <n>", tCli("chat.limit"))
      .option("--since <duration-or-timestamp>", tCli("chat.since"))
      .option("--agent <agent-id>", tCli("chat.agent")),
  ).action(withOutput(runReadCommand));

  addJsonAndDaemonHostOptions(
    chat
      .command("wait")
      .description(tCli("chat.wait.description"))
      .argument("<name-or-id>", tCli("chat.roomId"))
      .option("--timeout <duration>", tCli("chat.timeout")),
  ).action(withOutput(runWaitCommand));

  return chat;
}
