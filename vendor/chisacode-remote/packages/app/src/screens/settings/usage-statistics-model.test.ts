import { describe, expect, test } from "vitest";
import {
  buildHeatmapCells,
  buildModelUsageSegments,
  buildTrendBars,
  formatTokenCount,
} from "./usage-statistics-model";
import type { UsageSummaryPayload } from "@chisacode/protocol/messages";

const summary: UsageSummaryPayload = {
  rangeDays: 7,
  generatedAt: "2026-06-20T12:00:00.000Z",
  totals: {
    inputTokens: 120_000_000,
    cachedInputTokens: 0,
    outputTokens: 60_000_000,
    totalTokens: 180_000_000,
    turnCount: 23,
    messageCount: 56,
    activeDays: 4,
    currentStreakDays: 1,
  },
  mostUsedModel: {
    model: "GLM-5.2",
    totalTokens: 120_000_000,
    turnCount: 15,
    percentage: 67,
  },
  daily: [
    {
      date: "2026-06-14",
      inputTokens: 60_000_000,
      cachedInputTokens: 0,
      outputTokens: 20_000_000,
      totalTokens: 80_000_000,
      turnCount: 10,
      messageCount: 20,
      topModel: "GLM-5.2",
      models: [{ model: "GLM-5.2", totalTokens: 80_000_000, turnCount: 10, percentage: 100 }],
    },
    {
      date: "2026-06-20",
      inputTokens: 40_000_000,
      cachedInputTokens: 0,
      outputTokens: 20_000_000,
      totalTokens: 60_000_000,
      turnCount: 8,
      messageCount: 16,
      topModel: "glm-5.1",
      models: [{ model: "glm-5.1", totalTokens: 60_000_000, turnCount: 8, percentage: 100 }],
    },
  ],
  models: [
    { model: "GLM-5.2", totalTokens: 120_000_000, turnCount: 15, percentage: 67 },
    { model: "glm-5.1", totalTokens: 60_000_000, turnCount: 8, percentage: 33 },
  ],
};

describe("usage statistics model", () => {
  test("formats token counts with readable Chinese units", () => {
    expect(formatTokenCount(180_000_000)).toBe("1.8亿");
    expect(formatTokenCount(61_461_000)).toBe("6146.1万");
    expect(formatTokenCount(12_300)).toBe("1.2万");
    expect(formatTokenCount(999)).toBe("999");
  });

  test("builds heatmap cells with tooltip details", () => {
    const cells = buildHeatmapCells(summary);

    expect(cells.at(0)).toEqual({
      date: "2026-06-14",
      level: 4,
      totalTokens: 80_000_000,
      tooltip: "2026-06-14\nTokens: 8000万\nTurns: 10\nMessages: 20\nTop model: GLM-5.2",
    });
    expect(cells.at(-1)).toMatchObject({
      date: "2026-06-20",
      level: 3,
      tooltip: expect.stringContaining("Top model: glm-5.1"),
    });
  });

  test("builds trend bars with per-model tooltip details", () => {
    const bars = buildTrendBars(summary);

    expect(bars[0]).toEqual({
      date: "2026-06-14",
      totalTokens: 80_000_000,
      segments: [{ model: "GLM-5.2", totalTokens: 80_000_000, percentage: 100, colorIndex: 0 }],
      tooltip: "2026-06-14\nTotal: 8000万 tokens\nGLM-5.2: 8000万 (100%)",
    });
  });

  test("builds donut segments with model tooltip details", () => {
    const segments = buildModelUsageSegments(summary);

    expect(segments).toEqual([
      {
        model: "GLM-5.2",
        totalTokens: 120_000_000,
        turnCount: 15,
        percentage: 67,
        colorIndex: 0,
        tooltip: "GLM-5.2\nTokens: 1.2亿\nTurns: 15\nShare: 67%",
      },
      {
        model: "glm-5.1",
        totalTokens: 60_000_000,
        turnCount: 8,
        percentage: 33,
        colorIndex: 1,
        tooltip: "glm-5.1\nTokens: 6000万\nTurns: 8\nShare: 33%",
      },
    ]);
  });
});
