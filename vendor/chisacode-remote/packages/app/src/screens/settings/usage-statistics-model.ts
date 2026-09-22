import type { UsageSummaryPayload } from "@chisacode/protocol/messages";

export interface UsageHeatmapCell {
  date: string;
  level: number;
  totalTokens: number;
  tooltip: string;
}

export interface UsageTrendSegment {
  model: string;
  totalTokens: number;
  percentage: number;
  colorIndex: number;
}

export interface UsageTrendBar {
  date: string;
  totalTokens: number;
  segments: UsageTrendSegment[];
  tooltip: string;
}

export interface UsageModelSegment {
  model: string;
  totalTokens: number;
  turnCount: number;
  percentage: number;
  colorIndex: number;
  tooltip: string;
}

export function formatTokenCount(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized >= 100_000_000) {
    return `${trimFixed(normalized / 100_000_000)}亿`;
  }
  if (normalized >= 10_000) {
    return `${trimFixed(normalized / 10_000)}万`;
  }
  return String(Math.round(normalized));
}

export function buildHeatmapCells(summary: UsageSummaryPayload): UsageHeatmapCell[] {
  const maxTokens = Math.max(...summary.daily.map((day) => day.totalTokens), 0);
  return summary.daily.map((day) => ({
    date: day.date,
    level: getHeatmapLevel(day.totalTokens, maxTokens),
    totalTokens: day.totalTokens,
    tooltip: [
      day.date,
      `Tokens: ${formatTokenCount(day.totalTokens)}`,
      `Turns: ${day.turnCount}`,
      `Messages: ${day.messageCount}`,
      `Top model: ${day.topModel ?? "Unknown"}`,
    ].join("\n"),
  }));
}

export function buildTrendBars(summary: UsageSummaryPayload): UsageTrendBar[] {
  return summary.daily.map((day) => {
    const segments = day.models.map((model, index) => ({
      model: model.model,
      totalTokens: model.totalTokens,
      percentage: model.percentage,
      colorIndex: index,
    }));
    const modelLines = segments.map(
      (segment) =>
        `${segment.model}: ${formatTokenCount(segment.totalTokens)} (${segment.percentage}%)`,
    );
    return {
      date: day.date,
      totalTokens: day.totalTokens,
      segments,
      tooltip: [`${day.date}`, `Total: ${formatTokenCount(day.totalTokens)} tokens`, ...modelLines]
        .filter((line) => line.length > 0)
        .join("\n"),
    };
  });
}

export function buildModelUsageSegments(summary: UsageSummaryPayload): UsageModelSegment[] {
  return summary.models.map((model, index) => ({
    model: model.model,
    totalTokens: model.totalTokens,
    turnCount: model.turnCount,
    percentage: model.percentage,
    colorIndex: index,
    tooltip: [
      model.model,
      `Tokens: ${formatTokenCount(model.totalTokens)}`,
      `Turns: ${model.turnCount}`,
      `Share: ${model.percentage}%`,
    ].join("\n"),
  }));
}

function getHeatmapLevel(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(4, Math.ceil((value / maxValue) * 4)));
}

function trimFixed(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}
