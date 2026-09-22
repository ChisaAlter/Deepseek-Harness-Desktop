import path from "node:path";
import type { Command } from "commander";
import { isCancel, password as passwordPrompt } from "@clack/prompts";
import {
  hashDaemonPassword,
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "@chisacode/server";
import type {
  CommandError,
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { resolveLocalChisaCodeHome } from "./local-daemon.js";
import { tCli } from "../../i18n.js";

const CONFIG_FILENAME = "config.json";

interface SetPasswordResult {
  action: "password_set";
  configPath: string;
  restartCommand: string;
  message: string;
}

export type PromptPassword = (message: string) => Promise<string | symbol>;

export interface SetPasswordOptions {
  home?: string;
  promptPassword?: PromptPassword;
}

const setPasswordResultSchema: OutputSchema<SetPasswordResult> = {
  idField: "action",
  columns: [
    { header: tCli("daemon.table.status"), field: "action", color: () => "green" },
    { header: tCli("daemon.table.config"), field: "configPath" },
    { header: tCli("daemon.table.restart"), field: "restartCommand" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as SetPasswordResult;
    const rows = [
      tCli("daemon.password.written", { path: data.configPath }),
      tCli("daemon.password.restartHint"),
      tCli("daemon.password.run", { command: data.restartCommand }),
    ];
    if (options.format === "table") {
      return rows.join("\n");
    }
    return data.message;
  },
};

function createCommandError(code: string, message: string, details?: string): CommandError {
  return { code, message, ...(details ? { details } : {}) };
}

async function promptForPassword(promptPassword: PromptPassword): Promise<string> {
  const first = await promptPassword(tCli("daemon.password.promptNew"));
  if (isCancel(first)) {
    throw createCommandError("PASSWORD_CANCELLED", tCli("daemon.password.cancelled"));
  }
  if (typeof first !== "string" || first.length === 0) {
    throw createCommandError("PASSWORD_REQUIRED", tCli("daemon.password.required"));
  }

  const second = await promptPassword(tCli("daemon.password.promptConfirm"));
  if (isCancel(second)) {
    throw createCommandError("PASSWORD_CANCELLED", tCli("daemon.password.cancelled"));
  }
  if (first !== second) {
    throw createCommandError("PASSWORD_MISMATCH", tCli("daemon.password.mismatch"));
  }

  return first;
}

export async function setDaemonPasswordInConfig(
  newPassword: string,
  options: SetPasswordOptions = {},
): Promise<SetPasswordResult> {
  const chisacodeHome = resolveLocalChisaCodeHome(options.home);
  const configPath = path.join(chisacodeHome, CONFIG_FILENAME);
  const persisted = loadPersistedConfig(chisacodeHome);
  const nextConfig: PersistedConfig = {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      auth: {
        ...persisted.daemon?.auth,
        password: hashDaemonPassword(newPassword),
      },
    },
  };

  savePersistedConfig(chisacodeHome, nextConfig);

  const restartCommand = "chisacode daemon restart";
  return {
    action: "password_set",
    configPath,
    restartCommand,
    message: [
      tCli("daemon.password.written", { path: configPath }),
      tCli("daemon.password.restartHint"),
      tCli("daemon.password.run", { command: restartCommand }),
    ].join("\n"),
  };
}

export async function runSetPasswordCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<SetPasswordResult>> {
  const promptPassword =
    typeof options.promptPassword === "function"
      ? (options.promptPassword as PromptPassword)
      : (message: string) => passwordPrompt({ message });
  const newPassword = await promptForPassword(promptPassword);
  const result = await setDaemonPasswordInConfig(newPassword, {
    home: typeof options.home === "string" ? options.home : undefined,
  });

  return {
    type: "single",
    data: result,
    schema: setPasswordResultSchema,
  };
}
