import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { Command } from "commander";

import { tCli } from "../../i18n.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

type ProviderDiagnosticPayload = Awaited<ReturnType<DaemonClient["getProviderDiagnostic"]>>;
type ProviderDiagnosticDetails = ProviderDiagnosticPayload["details"];

interface ProviderInspectOutput {
  provider: string;
  diagnostic: string;
  details: ProviderDiagnosticDetails | null;
}

type ProviderInspectClient = Pick<DaemonClient, "getProviderDiagnostic" | "close">;

export interface ProviderInspectCommandDependencies {
  connect(options: { host?: string }): Promise<ProviderInspectClient>;
}

export interface ProviderInspectOptions extends CommandOptions {
  host?: string;
}

const defaultDependencies: ProviderInspectCommandDependencies = {
  connect: connectToDaemon,
};

const providerInspectSchema: OutputSchema<ProviderInspectOutput> = {
  idField: "provider",
  columns: [
    { header: "PROVIDER", field: "provider" },
    { header: tCli("provider.inspect.report"), field: "diagnostic" },
  ],
  renderHuman: (result) => (result.data as ProviderInspectOutput).diagnostic,
  serialize: (value) => value,
};

/** Fetches a redacted provider troubleshooting report through the existing diagnostic RPC. */
export async function runProviderInspectCommand(
  provider: string,
  options: ProviderInspectOptions,
  command: Command,
): Promise<SingleResult<ProviderInspectOutput>> {
  return runProviderInspectCommandWithDependencies(provider, options, command, defaultDependencies);
}

export async function runProviderInspectCommandWithDependencies(
  provider: string,
  options: ProviderInspectOptions,
  _command: Command,
  dependencies: ProviderInspectCommandDependencies,
): Promise<SingleResult<ProviderInspectOutput>> {
  const normalizedProvider = provider.trim().toLowerCase();
  if (!normalizedProvider) {
    const error: CommandError = {
      code: "MISSING_PROVIDER",
      message: tCli("provider.inspect.missing"),
      details: "Usage: chisacode provider inspect <provider>",
    };
    throw error;
  }

  const client = await dependencies.connect({ host: options.host });
  try {
    const result = await client.getProviderDiagnostic(normalizedProvider);
    return {
      type: "single",
      data: {
        provider: result.provider,
        diagnostic: result.diagnostic,
        details: result.details ?? null,
      },
      schema: providerInspectSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
