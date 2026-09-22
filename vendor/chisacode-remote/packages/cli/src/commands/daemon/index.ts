import { Command, Option } from "commander";
import { startCommand } from "./start.js";
import { runStatusCommand } from "./status.js";
import { runStopCommand } from "./stop.js";
import { runRestartCommand } from "./restart.js";
import { runSetPasswordCommand } from "./set-password.js";
import { runDiagnosticsCommand } from "./diagnostics.js";
import { pairCommand } from "./pair.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import { tCli } from "../../i18n.js";

function resolveHostnamesOption(hostnames: unknown, allowedHosts: unknown): string | undefined {
  if (typeof hostnames === "string") return hostnames;
  if (typeof allowedHosts === "string") return allowedHosts;
  return undefined;
}

export function createDaemonCommand(): Command {
  const daemon = new Command("daemon").description(tCli("daemon.description"));

  daemon.addCommand(startCommand());
  daemon.addCommand(pairCommand());

  addJsonOption(daemon.command("status").description(tCli("daemon.status.description")))
    .option("--home <path>", tCli("option.home"))
    .action(withOutput(runStatusCommand));

  addJsonAndDaemonHostOptions(
    daemon.command("diagnostics").description(tCli("daemon.diagnostics.description")),
  )
    .option("--logs", tCli("daemon.diagnostics.logs"))
    .option("--log-lines <count>", tCli("daemon.diagnostics.logLines"))
    .action(withOutput(runDiagnosticsCommand));

  addJsonOption(daemon.command("stop").description(tCli("daemon.stop.description")))
    .option("--home <path>", tCli("option.home"))
    .option("--timeout <seconds>", tCli("daemon.option.timeoutStop"))
    .option("--force", tCli("option.forceKill"))
    .option("--kill-timeout <seconds>", tCli("daemon.option.killTimeout"))
    .action(withOutput(runStopCommand));

  addJsonOption(daemon.command("restart").description(tCli("daemon.restart.description")))
    .option("--home <path>", tCli("option.home"))
    .option("--timeout <seconds>", tCli("option.timeoutForce"))
    .option("--force", tCli("option.forceKill"))
    .option("--listen <listen>", tCli("option.listenRestart"))
    .option("--port <port>", tCli("option.portRestart"))
    .option("--no-relay", tCli("option.noRelayRestart"))
    .option("--no-mcp", tCli("option.noMcpRestart"))
    .option("--no-inject-mcp", tCli("daemon.option.noInjectMcp"))
    .option("--hostnames <hosts>", tCli("option.hostnames"))
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(
      withOutput((...args) => {
        const [options, command] = args.slice(-2) as [(typeof args)[number], Command];
        return runRestartCommand(
          {
            ...options,
            hostnames: resolveHostnamesOption(options.hostnames, options.allowedHosts),
          },
          command,
        );
      }),
    );

  addJsonOption(daemon.command("set-password").description(tCli("daemon.setPassword.description")))
    .option("--home <path>", tCli("option.home"))
    .action(withOutput(runSetPasswordCommand));

  return daemon;
}
