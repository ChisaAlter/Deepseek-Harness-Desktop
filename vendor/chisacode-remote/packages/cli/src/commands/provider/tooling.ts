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

export type ProviderToolingAction = "install" | "update" | "reinstall";

export interface ProviderToolingOutput {
  provider: string;
  action: ProviderToolingAction;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
}

type ProviderToolingClient = Pick<DaemonClient, "runProviderToolingAction" | "close">;

export interface ProviderToolingCommandDependencies {
  connect(options: { host?: string }): Promise<ProviderToolingClient>;
}

export interface ProviderToolingOptions extends CommandOptions {
  host?: string;
}

const defaultDependencies: ProviderToolingCommandDependencies = {
  connect: connectToDaemon,
};

function getActionLabel(action: ProviderToolingAction): string {
  switch (action) {
    case "install":
      return tCli("provider.tooling.action.install");
    case "update":
      return tCli("provider.tooling.action.update");
    case "reinstall":
      return tCli("provider.tooling.action.reinstall");
  }
}

function createProviderToolingError(input: {
  provider: string;
  action: ProviderToolingAction;
  details: string;
}): CommandError {
  return {
    code: "PROVIDER_TOOLING_FAILED",
    message: tCli("provider.tooling.failed", {
      provider: input.provider,
      action: getActionLabel(input.action),
    }),
    details: input.details,
  };
}

function getFailureDetails(result: ProviderToolingOutput): string {
  return [
    result.stderr.trim() ? `STDERR:\n${result.stderr.trim()}` : "",
    result.stdout.trim() ? `STDOUT:\n${result.stdout.trim()}` : "",
    tCli("provider.tooling.exitCode", { code: result.exitCode ?? "unknown" }),
  ]
    .filter(Boolean)
    .join("\n");
}

const providerToolingSchema: OutputSchema<ProviderToolingOutput> = {
  idField: "provider",
  columns: [
    { header: "PROVIDER", field: "provider" },
    { header: "ACTION", field: "action" },
    { header: "STATUS", field: (item) => (item.success ? "success" : "failed") },
    { header: "EXIT", field: (item) => item.exitCode ?? "-" },
  ],
  renderHuman: (result) => {
    const data = result.data as ProviderToolingOutput;
    const lines = [
      tCli("provider.tooling.completed", {
        provider: data.provider,
        action: getActionLabel(data.action),
      }),
      data.stdout.trim(),
      data.stderr.trim(),
    ].filter(Boolean);
    return lines.join("\n");
  },
  serialize: (value) => value,
};

/** Runs a provider CLI tooling action through the daemon tooling authority. */
export async function runProviderToolingCommand(
  action: ProviderToolingAction,
  provider: string,
  options: ProviderToolingOptions,
  command: Command,
): Promise<SingleResult<ProviderToolingOutput>> {
  return runProviderToolingCommandWithDependencies(
    action,
    provider,
    options,
    command,
    defaultDependencies,
  );
}

/** Runs a provider tooling action with injected dependencies for focused verification. */
export async function runProviderToolingCommandWithDependencies(
  action: ProviderToolingAction,
  provider: string,
  options: ProviderToolingOptions,
  _command: Command,
  dependencies: ProviderToolingCommandDependencies,
): Promise<SingleResult<ProviderToolingOutput>> {
  const normalizedProvider = provider.trim().toLowerCase();
  if (!normalizedProvider) {
    throw {
      code: "MISSING_PROVIDER",
      message: tCli("provider.tooling.missing"),
      details: `Usage: chisacode provider ${action} <provider>`,
    } satisfies CommandError;
  }

  const client = await dependencies.connect({ host: options.host });
  try {
    let result: Awaited<ReturnType<ProviderToolingClient["runProviderToolingAction"]>>;
    try {
      result = await client.runProviderToolingAction(normalizedProvider, action);
    } catch (error) {
      throw createProviderToolingError({
        provider: normalizedProvider,
        action,
        details: error instanceof Error ? error.message : String(error),
      });
    }

    const data: ProviderToolingOutput = {
      provider: result.provider,
      action: result.action,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.success,
    };
    if (!data.success) {
      throw createProviderToolingError({
        provider: data.provider,
        action: data.action,
        details: getFailureDetails(data),
      });
    }

    return {
      type: "single",
      data,
      schema: providerToolingSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
