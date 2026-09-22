import { Command, Option } from "commander";
import chalk from "chalk";
import {
  startLocalDaemonForeground,
  startLocalDaemonDetached,
  type DaemonStartOptions as StartOptions,
} from "./local-daemon.js";
import { getErrorMessage } from "../../utils/errors.js";
import { tCli } from "../../i18n.js";

export type { DaemonStartOptions as StartOptions } from "./local-daemon.js";

type RawStartCommandOptions = StartOptions & {
  allowedHosts?: string;
};

export function startCommand(): Command {
  return new Command("start")
    .description(tCli("daemon.start.description"))
    .option("--listen <listen>", tCli("daemon.option.listen"))
    .option("--port <port>", tCli("daemon.option.port"))
    .option("--home <path>", tCli("option.home"))
    .option("--foreground", tCli("daemon.option.foreground"))
    .option("--no-relay", tCli("daemon.option.noRelay"))
    .option("--relay-use-tls", tCli("daemon.option.relayTls"))
    .option("--no-mcp", tCli("daemon.option.noMcp"))
    .option("--no-inject-mcp", tCli("daemon.option.noInjectMcp"))
    .option("--hostnames <hosts>", tCli("option.hostnames"))
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(async (options: RawStartCommandOptions) => {
      await runStart({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

export async function runStart(options: StartOptions): Promise<void> {
  if (options.listen && options.port) {
    console.error(chalk.red(tCli("daemon.error.listenPort")));
    process.exit(1);
  }

  if (!options.foreground) {
    try {
      const startup = await startLocalDaemonDetached(options);
      console.log(chalk.green(tCli("daemon.start.background", { pid: startup.pid ?? "unknown" })));
      console.log(chalk.dim(tCli("daemon.start.logs", { path: startup.logPath })));
    } catch (err) {
      exitWithError(getErrorMessage(err));
    }
    return;
  }
  try {
    const status = startLocalDaemonForeground(options);
    process.exit(status);
  } catch (err) {
    const message = getErrorMessage(err);
    exitWithError(tCli("daemon.start.failed", { message }));
  }
}

function exitWithError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}
