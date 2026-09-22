import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  FileBackedUsageStore,
  buildUsageSummary,
  exportUsageEvents,
  pruneUsageEvents,
  type UsageEventRecord,
} from "./usage-store.js";

function event(overrides: Partial<UsageEventRecord>): UsageEventRecord {
  return {
    id: overrides.id ?? `usage-${overrides.agentId ?? "agent"}-${overrides.turnId ?? "turn"}`,
    timestamp: overrides.timestamp ?? "2026-06-20T10:00:00.000Z",
    agentId: overrides.agentId ?? "agent-1",
    cwd: overrides.cwd ?? "C:\\Ai\\ChisaCode",
    provider: overrides.provider ?? "codex",
    model: overrides.model ?? "GLM-5.2",
    turnId: overrides.turnId ?? "turn-1",
    inputTokens: overrides.inputTokens ?? 10,
    cachedInputTokens: overrides.cachedInputTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 5,
    contextWindowUsedTokens: overrides.contextWindowUsedTokens,
    contextWindowMaxTokens: overrides.contextWindowMaxTokens,
    messageCount: overrides.messageCount ?? 1,
  };
}

describe("usage store", () => {
  test("appends finite usage events and reads them back from jsonl", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chisacode-usage-store-"));
    const store = new FileBackedUsageStore(path.join(dir, "usage-events.jsonl"));

    await store.append(event({ inputTokens: 100, outputTokens: 40 }));

    expect(await store.list()).toEqual([
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 40,
        model: "GLM-5.2",
      }),
    ]);
    await expect(readFile(path.join(dir, "usage-events.jsonl"), "utf8")).resolves.toContain(
      '"inputTokens":100',
    );
  });

  test("summarizes totals, active streaks, daily buckets, and model share", () => {
    const summary = buildUsageSummary({
      now: new Date("2026-06-20T12:00:00.000Z"),
      rangeDays: 7,
      events: [
        event({
          timestamp: "2026-06-14T08:00:00.000Z",
          agentId: "agent-1",
          turnId: "turn-a",
          model: "GLM-5.2",
          inputTokens: 100,
          outputTokens: 50,
          messageCount: 2,
        }),
        event({
          timestamp: "2026-06-20T08:00:00.000Z",
          agentId: "agent-2",
          turnId: "turn-b",
          model: "glm-5.1",
          inputTokens: 10,
          cachedInputTokens: 5,
          outputTokens: 5,
          messageCount: 1,
        }),
        event({
          timestamp: "2026-05-01T08:00:00.000Z",
          agentId: "old-agent",
          turnId: "old-turn",
          model: "old",
          inputTokens: 999,
          outputTokens: 999,
        }),
      ],
    });

    expect(summary.totals).toEqual({
      inputTokens: 110,
      cachedInputTokens: 5,
      outputTokens: 55,
      totalTokens: 165,
      turnCount: 2,
      messageCount: 3,
      activeDays: 2,
      currentStreakDays: 1,
    });
    expect(summary.mostUsedModel).toEqual({
      model: "GLM-5.2",
      totalTokens: 150,
      turnCount: 1,
      percentage: 91,
    });
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.at(-1)).toMatchObject({
      date: "2026-06-20",
      totalTokens: 15,
      turnCount: 1,
      messageCount: 1,
      topModel: "glm-5.1",
    });
    expect(summary.models).toEqual([
      expect.objectContaining({ model: "GLM-5.2", totalTokens: 150, percentage: 91 }),
      expect.objectContaining({ model: "glm-5.1", totalTokens: 15, percentage: 9 }),
    ]);
  });

  test("prunes raw records older than the retention window", () => {
    const pruned = pruneUsageEvents({
      now: new Date("2026-06-20T00:00:00.000Z"),
      retentionDays: 180,
      events: [
        event({ id: "keep", timestamp: "2025-12-22T00:00:00.000Z" }),
        event({ id: "drop", timestamp: "2025-12-21T23:59:59.000Z" }),
      ],
    });

    expect(pruned.map((record) => record.id)).toEqual(["keep"]);
  });

  test("exports json and csv without cost fields", () => {
    const records = [
      event({
        timestamp: "2026-06-20T08:00:00.000Z",
        agentId: "agent-1",
        turnId: "turn-1",
        inputTokens: 7,
        outputTokens: 3,
      }),
    ];

    expect(exportUsageEvents(records, "json")).toContain('"inputTokens": 7');
    expect(exportUsageEvents(records, "csv")).toBe(
      "timestamp,agentId,cwd,provider,model,turnId,inputTokens,cachedInputTokens,outputTokens,totalTokens,contextWindowUsedTokens,contextWindowMaxTokens,messageCount\n" +
        "2026-06-20T08:00:00.000Z,agent-1,C:\\Ai\\ChisaCode,codex,GLM-5.2,turn-1,7,0,3,10,,,1",
    );
  });
});
