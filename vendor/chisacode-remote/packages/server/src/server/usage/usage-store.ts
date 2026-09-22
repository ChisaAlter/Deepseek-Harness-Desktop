import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../../utils/atomic-write.js";

export const USAGE_RETENTION_DAYS = 180;
export type UsageSummaryRangeDays = 7 | 30 | 180;
export type UsageExportFormat = "json" | "csv";

export interface UsageEventRecord {
  id: string;
  timestamp: string;
  agentId: string;
  cwd: string;
  provider: string;
  model: string | null;
  turnId?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
  messageCount: number;
}

export interface UsageModelSummary {
  model: string;
  totalTokens: number;
  turnCount: number;
  percentage: number;
}

export interface UsageDailySummary {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
  messageCount: number;
  topModel: string | null;
  models: UsageModelSummary[];
}

export interface UsageSummary {
  rangeDays: UsageSummaryRangeDays;
  generatedAt: string;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turnCount: number;
    messageCount: number;
    activeDays: number;
    currentStreakDays: number;
  };
  mostUsedModel: UsageModelSummary | null;
  daily: UsageDailySummary[];
  models: UsageModelSummary[];
}

export interface UsageStore {
  append(record: UsageEventRecord): Promise<void>;
  list(): Promise<UsageEventRecord[]>;
  replace(records: UsageEventRecord[]): Promise<void>;
  clear(): Promise<void>;
}

interface SummaryBucket {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
  messageCount: number;
  models: Map<string, { totalTokens: number; turnCount: number }>;
}

export class FileBackedUsageStore implements UsageStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(record: UsageEventRecord): Promise<void> {
    const sanitized = sanitizeUsageEvent(record);
    if (!sanitized) {
      return;
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
  }

  async list(): Promise<UsageEventRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records: UsageEventRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as unknown;
        const record = sanitizeUsageEvent(parsed);
        if (record) {
          records.push(record);
        }
      } catch {
        // Skip corrupt lines; future appends should not make the whole page fail.
      }
    }
    return records;
  }

  async replace(records: UsageEventRecord[]): Promise<void> {
    const body = records
      .map((record) => sanitizeUsageEvent(record))
      .filter((record): record is UsageEventRecord => record !== null)
      .map((record) => JSON.stringify(record))
      .join("\n");
    await writeFileAtomic(this.filePath, body.length > 0 ? `${body}\n` : "");
  }

  async clear(): Promise<void> {
    await writeFileAtomic(this.filePath, "");
  }
}

export function createUsageEventRecord(input: {
  timestamp?: string;
  agentId: string;
  cwd: string;
  provider: string;
  model?: string | null;
  turnId?: string;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    contextWindowUsedTokens?: number;
    contextWindowMaxTokens?: number;
  };
  messageCount?: number;
}): UsageEventRecord | null {
  const record = sanitizeUsageEvent({
    id: randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    agentId: input.agentId,
    cwd: input.cwd,
    provider: input.provider,
    model: input.model ?? null,
    turnId: input.turnId,
    inputTokens: input.usage.inputTokens ?? 0,
    cachedInputTokens: input.usage.cachedInputTokens ?? 0,
    outputTokens: input.usage.outputTokens ?? 0,
    contextWindowUsedTokens: input.usage.contextWindowUsedTokens,
    contextWindowMaxTokens: input.usage.contextWindowMaxTokens,
    messageCount: input.messageCount ?? 1,
  });
  if (!record || record.inputTokens + record.outputTokens <= 0) {
    return null;
  }
  return record;
}

export function buildUsageSummary(input: {
  events: UsageEventRecord[];
  rangeDays: UsageSummaryRangeDays;
  now?: Date;
}): UsageSummary {
  const now = input.now ?? new Date();
  const endDate = toUtcDateString(now);
  const startDate = shiftDateString(endDate, -(input.rangeDays - 1));
  const buckets = new Map<string, SummaryBucket>();

  for (let index = 0; index < input.rangeDays; index += 1) {
    buckets.set(shiftDateString(startDate, index), createEmptyBucket());
  }

  const modelTotals = new Map<string, { totalTokens: number; turnCount: number }>();
  for (const event of input.events) {
    const date = toUtcDateString(new Date(event.timestamp));
    if (date < startDate || date > endDate) {
      continue;
    }
    const bucket = buckets.get(date);
    if (!bucket) {
      continue;
    }
    addRecordToBucket(bucket, event);
    const model = normalizeModelName(event.model);
    if (model) {
      const current = modelTotals.get(model) ?? { totalTokens: 0, turnCount: 0 };
      current.totalTokens += totalTokensForEvent(event);
      current.turnCount += 1;
      modelTotals.set(model, current);
    }
  }

  const daily = Array.from(buckets.entries()).map(([date, bucket]) => toDailySummary(date, bucket));
  const totals = daily.reduce(
    (acc, day) => ({
      inputTokens: acc.inputTokens + day.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + day.cachedInputTokens,
      outputTokens: acc.outputTokens + day.outputTokens,
      totalTokens: acc.totalTokens + day.totalTokens,
      turnCount: acc.turnCount + day.turnCount,
      messageCount: acc.messageCount + day.messageCount,
      activeDays: acc.activeDays + (day.totalTokens > 0 ? 1 : 0),
      currentStreakDays: acc.currentStreakDays,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
      messageCount: 0,
      activeDays: 0,
      currentStreakDays: 0,
    },
  );
  totals.currentStreakDays = countCurrentStreakDays(daily);
  const models = toModelSummaries(modelTotals, totals.totalTokens);

  return {
    rangeDays: input.rangeDays,
    generatedAt: now.toISOString(),
    totals,
    mostUsedModel: models[0] ?? null,
    daily,
    models,
  };
}

export function pruneUsageEvents(input: {
  events: UsageEventRecord[];
  now?: Date;
  retentionDays?: number;
}): UsageEventRecord[] {
  const now = input.now ?? new Date();
  const retentionDays = input.retentionDays ?? USAGE_RETENTION_DAYS;
  const cutoff = shiftDateString(toUtcDateString(now), -retentionDays);
  return input.events.filter((event) => toUtcDateString(new Date(event.timestamp)) >= cutoff);
}

export function exportUsageEvents(records: UsageEventRecord[], format: UsageExportFormat): string {
  if (format === "json") {
    return JSON.stringify(records, null, 2);
  }

  const headers = [
    "timestamp",
    "agentId",
    "cwd",
    "provider",
    "model",
    "turnId",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "totalTokens",
    "contextWindowUsedTokens",
    "contextWindowMaxTokens",
    "messageCount",
  ];
  const rows = records.map((record) =>
    [
      record.timestamp,
      record.agentId,
      record.cwd,
      record.provider,
      record.model ?? "",
      record.turnId ?? "",
      String(record.inputTokens),
      String(record.cachedInputTokens),
      String(record.outputTokens),
      String(totalTokensForEvent(record)),
      formatOptionalNumber(record.contextWindowUsedTokens),
      formatOptionalNumber(record.contextWindowMaxTokens),
      String(record.messageCount),
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function sanitizeUsageEvent(value: unknown): UsageEventRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const timestamp = normalizeString(record.timestamp);
  const agentId = normalizeString(record.agentId);
  const cwd = normalizeString(record.cwd);
  const provider = normalizeString(record.provider);
  if (!id || !timestamp || Number.isNaN(Date.parse(timestamp)) || !agentId || !cwd || !provider) {
    return null;
  }

  return {
    id,
    timestamp,
    agentId,
    cwd,
    provider,
    model: normalizeString(record.model) ?? null,
    ...(normalizeString(record.turnId) ? { turnId: normalizeString(record.turnId)! } : {}),
    inputTokens: finiteNonNegative(record.inputTokens),
    cachedInputTokens: finiteNonNegative(record.cachedInputTokens),
    outputTokens: finiteNonNegative(record.outputTokens),
    ...(optionalFiniteNonNegative(record.contextWindowUsedTokens) !== undefined
      ? { contextWindowUsedTokens: optionalFiniteNonNegative(record.contextWindowUsedTokens)! }
      : {}),
    ...(optionalFiniteNonNegative(record.contextWindowMaxTokens) !== undefined
      ? { contextWindowMaxTokens: optionalFiniteNonNegative(record.contextWindowMaxTokens)! }
      : {}),
    messageCount: Math.max(0, Math.trunc(finiteNonNegative(record.messageCount))),
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function optionalFiniteNonNegative(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return finiteNonNegative(value);
}

function totalTokensForEvent(record: UsageEventRecord): number {
  return record.inputTokens + record.outputTokens;
}

function createEmptyBucket(): SummaryBucket {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turnCount: 0,
    messageCount: 0,
    models: new Map(),
  };
}

function addRecordToBucket(bucket: SummaryBucket, record: UsageEventRecord): void {
  const totalTokens = totalTokensForEvent(record);
  bucket.inputTokens += record.inputTokens;
  bucket.cachedInputTokens += record.cachedInputTokens;
  bucket.outputTokens += record.outputTokens;
  bucket.totalTokens += totalTokens;
  bucket.turnCount += 1;
  bucket.messageCount += record.messageCount;
  const model = normalizeModelName(record.model);
  if (!model) {
    return;
  }
  const current = bucket.models.get(model) ?? { totalTokens: 0, turnCount: 0 };
  current.totalTokens += totalTokens;
  current.turnCount += 1;
  bucket.models.set(model, current);
}

function toDailySummary(date: string, bucket: SummaryBucket): UsageDailySummary {
  const models = toModelSummaries(bucket.models, bucket.totalTokens);
  return {
    date,
    inputTokens: bucket.inputTokens,
    cachedInputTokens: bucket.cachedInputTokens,
    outputTokens: bucket.outputTokens,
    totalTokens: bucket.totalTokens,
    turnCount: bucket.turnCount,
    messageCount: bucket.messageCount,
    topModel: models[0]?.model ?? null,
    models,
  };
}

function toModelSummaries(
  modelTotals: Map<string, { totalTokens: number; turnCount: number }>,
  totalTokens: number,
): UsageModelSummary[] {
  return Array.from(modelTotals.entries())
    .map(([model, value]) => ({
      model,
      totalTokens: value.totalTokens,
      turnCount: value.turnCount,
      percentage: totalTokens > 0 ? Math.round((value.totalTokens / totalTokens) * 100) : 0,
    }))
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens || left.model.localeCompare(right.model),
    );
}

function countCurrentStreakDays(daily: UsageDailySummary[]): number {
  let count = 0;
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    if (daily[index].totalTokens <= 0) {
      break;
    }
    count += 1;
  }
  return count;
}

function normalizeModelName(model: string | null | undefined): string | null {
  const normalized = normalizeString(model);
  return normalized ?? null;
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDateString(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toUtcDateString(shifted);
}

function formatOptionalNumber(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}
