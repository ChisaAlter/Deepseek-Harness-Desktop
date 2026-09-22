import { Command } from "commander";
import { tCli } from "../../i18n.js";

export function createSpeechCommand(): Command {
  return new Command("speech").description(tCli("speech.description"));
}
