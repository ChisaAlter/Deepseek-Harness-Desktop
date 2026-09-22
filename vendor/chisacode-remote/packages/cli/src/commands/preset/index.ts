import { Command } from "commander";

import { tCli } from "../../i18n.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runPresetLsCommand } from "./ls.js";

/** Creates assistant preset discovery commands. */
export function createPresetCommand(): Command {
  const preset = new Command("preset").description(tCli("preset.description"));

  addJsonAndDaemonHostOptions(
    preset.command("ls").description(tCli("preset.ls.description")),
  ).action(withOutput(runPresetLsCommand));

  return preset;
}
