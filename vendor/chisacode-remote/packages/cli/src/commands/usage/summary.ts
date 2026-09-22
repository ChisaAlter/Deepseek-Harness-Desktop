import type { Command } from "commander";
import type { UsageRangeDays, UsageSummaryPayload } from "@chisacode/protocol/usage/messages";

import { tCli } from "../../i18n.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

interface UsageSummaryClient {
  fetchUsageSummary(options: { rangeDays: UsageRangeDays }): Promise<{
    summary: UsageSummaryPayload;
  }>;
  close(): Promise<void>;
}

export interface UsageSummaryCommandDependencies {
  connect(options: { host?: string }): Promise<UsageSummaryClient>;
}

export interface UsageSummaryOptions extends CommandOptions {
  host?: string;
  range?: string | number;
}

const defaultDependencies: UsageSummaryCommandDependencies = {
  connect: connectToDaemon,
};

function parseRangeDays(value: unknown): UsageRangeDays {
  const parsed = typeof value === "number" ? value : Number(value ?? 30);
  if (parsed === 7 || parsed === 30 || parsed === 180) {
    return parsed;
  }
  throw new Error(tCli("usage.summary.invalidRange"));
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

const usageSummarySchema: OutputSchema<UsageSummaryPayload> = {
  idField: "generatedAt",
  columns: [
    { header: "RANGE", field: (summary) => `${summary.rangeDays}d` },
    { header: "TOKENS", field: (summary) => summary.totals.totalTokens, align: "right" },
    { header: "TURNS", field: (summary) => summary.totals.turnCount, align: "right" },
    { header: "MESSAGES", field: (summary) => summary.totals.messageCount, align: "right" },
    { header: "ACTIVE DAYS", field: (summary) => summary.totals.activeDays, align: "right" },
    { header: "TOP MODEL", field: (summary) => summary.mostUsedModel?.model ?? "-" },
  ],
  renderHuman: (result) => {
    const summary = result.data as UsageSummaryPayload;
    const topModel = summary.mostUsedModel
      ? `${summary.mostUsedModel.model} (${summary.mostUsedModel.percentage}%)`
      : tCli("usage.summary.noModel");
    return [
      tCli("usage.summary.title", { days: summary.rangeDays }),
      tCli("usage.summary.tokens", { total: formatTokenCount(summary.totals.totalTokens) }),
      tCli("usage.summary.breakdown", {
        input: formatTokenCount(summary.totals.inputTokens),
        cached: formatTokenCount(summary.totals.cachedInputTokens),
        output: formatTokenCount(summary.totals.outputTokens),
      }),
      tCli("usage.summary.activity", {
        turns: summary.totals.turnCount,
        messages: summary.totals.messageCount,
        activeDays: summary.totals.activeDays,
        streak: summary.totals.currentStreakDays,
      }),
      tCli("usage.summary.topModel", { model: topModel }),
      tCli("usage.summary.generatedAt", {
        time: new Date(summary.generatedAt).toLocaleString(),
      }),
    ].join("\n");
  },
  serialize: (summary) => summary,
};

/** Fetches and renders the local usage summary through the daemon RPC. */
export async function runUsageSummaryCommand(
  options: UsageSummaryOptions,
  command: Command,
): Promise<SingleResult<UsageSummaryPayload>> {
  return runUsageSummaryCommandWithDependencies(options, command, defaultDependencies);
}

export async function runUsageSummaryCommandWithDependencies(
  options: UsageSummaryOptions,
  _command: Command,
  dependencies: UsageSummaryCommandDependencies,
): Promise<SingleResult<UsageSummaryPayload>> {
  const rangeDays = parseRangeDays(options.range);
  const client = await dependencies.connect({ host: options.host });
  try {
    const payload = await client.fetchUsageSummary({ rangeDays });
    return { type: "single", data: payload.summary, schema: usageSummarySchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}
