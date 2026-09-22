import type { Command } from "commander";

import { tCli } from "../../i18n.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

interface UsageClearClient {
  clearUsage(): Promise<{ cleared: boolean; requestId: string }>;
  close(): Promise<void>;
}

export interface UsageClearCommandDependencies {
  connect(options: { host?: string }): Promise<UsageClearClient>;
}

export interface UsageClearOptions extends CommandOptions {
  host?: string;
  yes?: boolean;
}

interface UsageClearResult {
  cleared: boolean;
}

const defaultDependencies: UsageClearCommandDependencies = {
  connect: connectToDaemon,
};

const usageClearSchema: OutputSchema<UsageClearResult> = {
  idField: (data) => String(data.cleared),
  columns: [{ header: "CLEARED", field: "cleared" }],
  renderHuman: (result) => {
    const data = result.data as UsageClearResult;
    return tCli(data.cleared ? "usage.clear.cleared" : "usage.clear.notCleared");
  },
  serialize: (data) => data,
};

/** Clears local usage data after explicit non-interactive confirmation. */
export async function runUsageClearCommand(
  options: UsageClearOptions,
  command: Command,
): Promise<SingleResult<UsageClearResult>> {
  return runUsageClearCommandWithDependencies(options, command, defaultDependencies);
}

export async function runUsageClearCommandWithDependencies(
  options: UsageClearOptions,
  _command: Command,
  dependencies: UsageClearCommandDependencies,
): Promise<SingleResult<UsageClearResult>> {
  if (options.yes !== true) {
    throw new Error(tCli("usage.clear.confirmRequired"));
  }

  const client = await dependencies.connect({ host: options.host });
  try {
    const payload = await client.clearUsage();
    return {
      type: "single",
      data: { cleared: payload.cleared },
      schema: usageClearSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
