import type { Command } from "commander";
import { tCli } from "../i18n.js";

export function collectMultiple(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function addJsonOption<T extends Command>(command: T): T {
  command.option("--json", tCli("option.json"));
  return command;
}

export function addDaemonHostOption<T extends Command>(command: T): T {
  command.option("--host <host>", tCli("option.host"));
  return command;
}

export function addJsonAndDaemonHostOptions<T extends Command>(command: T): T {
  return addDaemonHostOption(addJsonOption(command));
}
