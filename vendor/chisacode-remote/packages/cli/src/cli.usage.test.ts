import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command, type Option } from "commander";
import { describe, expect, it } from "vitest";

import { runUsageClearCommandWithDependencies } from "./commands/usage/clear.js";
import { runUsageExportCommandWithDependencies } from "./commands/usage/export.js";
import { createUsageCommand } from "./commands/usage/index.js";
import { runUsageSummaryCommandWithDependencies } from "./commands/usage/summary.js";

const usageSummary = {
  rangeDays: 7 as const,
  generatedAt: "2026-07-14T00:00:00.000Z",
  totals: {
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 5,
    totalTokens: 15,
    turnCount: 1,
    messageCount: 2,
    activeDays: 1,
    currentStreakDays: 1,
  },
  mostUsedModel: {
    model: "gpt-5.4",
    totalTokens: 15,
    turnCount: 1,
    percentage: 100,
  },
  daily: [],
  models: [],
};

function getLongOption(option: Option): string {
  return option.long;
}

function describeCommand(command: Command): { name: string; options: string[] } {
  return {
    name: command.name(),
    options: command.options.map(getLongOption),
  };
}

describe("usage CLI commands", () => {
  it("registers summary, export, and clear command options", () => {
    const usage = createUsageCommand();

    expect(usage.commands.map(describeCommand)).toEqual([
      { name: "summary", options: ["--range", "--json", "--host"] },
      { name: "export", options: ["--type", "--output", "--force", "--json", "--host"] },
      { name: "clear", options: ["--yes", "--json", "--host"] },
    ]);
  });

  it("fetches a seven-day usage summary through the daemon client", async () => {
    const connections: unknown[] = [];
    const requests: unknown[] = [];
    let closed = false;

    const result = await runUsageSummaryCommandWithDependencies(
      { range: "7", host: "127.0.0.1:6767" },
      new Command(),
      {
        connect: async (options) => {
          connections.push(options);
          return {
            fetchUsageSummary: async (request) => {
              requests.push(request);
              return { requestId: "usage-summary", summary: usageSummary };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(connections).toEqual([{ host: "127.0.0.1:6767" }]);
    expect(requests).toEqual([{ rangeDays: 7 }]);
    expect(closed).toBe(true);
    expect(result.data).toEqual(usageSummary);
    expect(result.schema.serialize?.(result.data)).toEqual(usageSummary);
  });

  it("rejects an unsupported range before connecting", async () => {
    let connectionAttempts = 0;

    await expect(
      runUsageSummaryCommandWithDependencies({ range: "14" }, new Command(), {
        connect: async () => {
          connectionAttempts += 1;
          throw new Error("must not connect");
        },
      }),
    ).rejects.toThrow("--range");
    expect(connectionAttempts).toBe(0);
  });

  it("exports raw usage only to an explicit output file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chisacode-usage-cli-"));
    const outputPath = path.join(directory, "usage.json");
    const requests: unknown[] = [];
    let closed = false;

    try {
      const result = await runUsageExportCommandWithDependencies(
        {
          type: "json",
          output: outputPath,
          host: "127.0.0.1:6767",
        },
        new Command(),
        {
          connect: async (options) => {
            expect(options).toEqual({ host: "127.0.0.1:6767" });
            return {
              exportUsage: async (request) => {
                requests.push(request);
                return {
                  requestId: "usage-export",
                  format: "json",
                  filename: "chisacode-usage.json",
                  content: '[{"inputTokens":10}]',
                };
              },
              close: async () => {
                closed = true;
              },
            };
          },
        },
      );

      expect(requests).toEqual([{ format: "json" }]);
      expect(await readFile(outputPath, "utf8")).toBe('[{"inputTokens":10}]');
      expect(closed).toBe(true);
      expect(result.data).toEqual({
        bytes: 20,
        format: "json",
        outputPath,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("clears usage only when --yes is explicit", async () => {
    let clearRequests = 0;
    let closed = false;

    const result = await runUsageClearCommandWithDependencies(
      { yes: true, host: "127.0.0.1:6767" },
      new Command(),
      {
        connect: async (options) => {
          expect(options).toEqual({ host: "127.0.0.1:6767" });
          return {
            clearUsage: async () => {
              clearRequests += 1;
              return { requestId: "usage-clear", cleared: true };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(clearRequests).toBe(1);
    expect(closed).toBe(true);
    expect(result.data).toEqual({ cleared: true });
  });

  it("rejects usage clearing before connecting when --yes is absent", async () => {
    let connectionAttempts = 0;

    await expect(
      runUsageClearCommandWithDependencies({}, new Command(), {
        connect: async () => {
          connectionAttempts += 1;
          throw new Error("must not connect");
        },
      }),
    ).rejects.toThrow("--yes");
    expect(connectionAttempts).toBe(0);
  });
});
