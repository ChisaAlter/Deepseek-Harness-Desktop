import { Command } from "commander";
import { runProviderInspectCommand } from "./inspect.js";
import { runLsCommand } from "./ls.js";
import { runModelsCommand } from "./models.js";
import {
  runProviderToolingCommand,
  type ProviderToolingAction,
  type ProviderToolingOptions,
} from "./tooling.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { tCli } from "../../i18n.js";

function addProviderToolingCommand(provider: Command, action: ProviderToolingAction): void {
  addJsonAndDaemonHostOptions(
    provider
      .command(action)
      .description(tCli(`provider.${action}.description`))
      .argument("<provider>", tCli("provider.tooling.provider")),
  ).action(
    withOutput((providerName: string, options: ProviderToolingOptions, command: Command) =>
      runProviderToolingCommand(action, providerName, options, command),
    ),
  );
}

export function createProviderCommand(): Command {
  const provider = new Command("provider").description(tCli("provider.description"));

  addJsonAndDaemonHostOptions(
    provider
      .command("ls")
      .description(tCli("provider.ls.description"))
      .option("--refresh", tCli("provider.ls.refresh")),
  ).action(withOutput(runLsCommand));
  addJsonAndDaemonHostOptions(
    provider
      .command("inspect")
      .description(tCli("provider.inspect.description"))
      .argument("<provider>", tCli("provider.inspect.provider")),
  ).action(withOutput(runProviderInspectCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("models")
      .description(tCli("provider.models.description"))
      .argument("<provider>", tCli("provider.models.provider"))
      .option("--thinking", tCli("provider.models.thinking")),
  ).action(withOutput(runModelsCommand));

  addProviderToolingCommand(provider, "install");
  addProviderToolingCommand(provider, "update");
  addProviderToolingCommand(provider, "reinstall");

  return provider;
}
