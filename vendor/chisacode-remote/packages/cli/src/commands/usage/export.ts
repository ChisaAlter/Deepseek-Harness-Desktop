import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import type { UsageExportFormat } from "@chisacode/protocol/usage/messages";

import { tCli } from "../../i18n.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

interface UsageExportClient {
  exportUsage(options: { format: UsageExportFormat }): Promise<{
    content: string;
    filename: string;
    format: UsageExportFormat;
    requestId: string;
  }>;
  close(): Promise<void>;
}

export interface UsageExportCommandDependencies {
  connect(options: { host?: string }): Promise<UsageExportClient>;
}

export interface UsageExportOptions extends CommandOptions {
  force?: boolean;
  host?: string;
  output?: string;
  type?: string;
}

interface UsageExportResult {
  bytes: number;
  format: UsageExportFormat;
  outputPath: string;
}

const defaultDependencies: UsageExportCommandDependencies = {
  connect: connectToDaemon,
};

function parseExportFormat(value: unknown): UsageExportFormat {
  if (value === "json" || value === "csv") {
    return value;
  }
  throw new Error(tCli("usage.export.invalidFormat"));
}

function resolveOutputPath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(tCli("usage.export.outputRequired"));
  }
  return path.resolve(value);
}

const usageExportSchema: OutputSchema<UsageExportResult> = {
  idField: "outputPath",
  columns: [
    { header: "FORMAT", field: "format" },
    { header: "BYTES", field: "bytes", align: "right" },
    { header: "OUTPUT", field: "outputPath" },
  ],
  renderHuman: (result) => {
    const data = result.data as UsageExportResult;
    return tCli("usage.export.saved", {
      bytes: data.bytes,
      format: data.format.toUpperCase(),
      path: data.outputPath,
    });
  },
  serialize: (data) => data,
};

/** Exports raw local usage data to an explicitly selected file. */
export async function runUsageExportCommand(
  options: UsageExportOptions,
  command: Command,
): Promise<SingleResult<UsageExportResult>> {
  return runUsageExportCommandWithDependencies(options, command, defaultDependencies);
}

export async function runUsageExportCommandWithDependencies(
  options: UsageExportOptions,
  _command: Command,
  dependencies: UsageExportCommandDependencies,
): Promise<SingleResult<UsageExportResult>> {
  const format = parseExportFormat(options.type);
  const outputPath = resolveOutputPath(options.output);
  const client = await dependencies.connect({ host: options.host });
  let content: string;
  try {
    const payload = await client.exportUsage({ format });
    content = payload.content;
  } finally {
    await client.close().catch(() => undefined);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, {
    encoding: "utf8",
    flag: options.force === true ? "w" : "wx",
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);

  return {
    type: "single",
    data: {
      bytes: Buffer.byteLength(content, "utf8"),
      format,
      outputPath,
    },
    schema: usageExportSchema,
  };
}
