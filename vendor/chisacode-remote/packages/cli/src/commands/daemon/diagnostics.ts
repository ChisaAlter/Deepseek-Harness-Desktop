import type { Command } from "commander";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";

import { connectToDaemon } from "../../utils/client.js";
import type { CommandOptions, SingleResult } from "../../output/index.js";
import { tCli } from "../../i18n.js";

interface DiagnosticsOutput {
  diagnostic: string;
}

type DiagnosticsClient = Pick<DaemonClient, "getDiagnostics" | "close">;

export interface DiagnosticsCommandDependencies {
  connect(options: { host?: string }): Promise<DiagnosticsClient>;
}

const defaultDependencies: DiagnosticsCommandDependencies = {
  connect: connectToDaemon,
};

function parseLogLines(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error(tCli("daemon.diagnostics.invalidLogLines"));
  }
  return parsed;
}

/** Generates a copyable daemon troubleshooting report through the diagnostics RPC. */
export async function runDiagnosticsCommand(
  options: CommandOptions,
  command: Command,
): Promise<SingleResult<DiagnosticsOutput>> {
  return runDiagnosticsCommandWithDependencies(options, command, defaultDependencies);
}

export async function runDiagnosticsCommandWithDependencies(
  options: CommandOptions,
  _command: Command,
  dependencies: DiagnosticsCommandDependencies,
): Promise<SingleResult<DiagnosticsOutput>> {
  const includeLogs = options.logs === true;
  const maxLogLines = includeLogs ? parseLogLines(options.logLines) : undefined;
  const client = await dependencies.connect({ host: options.host });
  try {
    const result = await client.getDiagnostics({ includeLogs, maxLogLines });
    const data = { diagnostic: result.diagnostic };
    return {
      type: "single",
      data,
      schema: {
        idField: "diagnostic",
        columns: [{ header: tCli("daemon.diagnostics.report"), field: "diagnostic" }],
        renderHuman: () => data.diagnostic,
        serialize: (value) => value,
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
