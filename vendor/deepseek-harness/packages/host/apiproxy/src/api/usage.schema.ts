/**
 * usage domain zod schemas (names derived from map keys: usageSummaryRequestSchema /
 * usageSummaryValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { UsageModelShareView, UsageSummaryView } from './usage.ts'

const usageModelShareSchema = z.object({
  model: z.string().min(1),
  tokens: z.number().int().nonnegative(),
  share: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<UsageModelShareView>>

const usageHeatmapCellSchema = z.object({
  date: z.string().min(1),
  tokens: z.number().int().nonnegative(),
})

const usageDailyRowSchema = z.object({
  date: z.string().min(1),
  byModel: z.array(z.object({
    model: z.string().min(1),
    tokens: z.number().int().nonnegative(),
  })),
})

/** usage.summary request payload. */
export const usageSummaryRequestSchema = z.object({
  rangeDays: z.union([z.literal(7), z.literal(30)]),
  timeZone: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'usage.summary'>>>

/** usage.summary response value. */
export const usageSummaryValueSchema = z.object({
  rangeDays: z.union([z.literal(7), z.literal(30)]),
  totalTokens: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  topModel: z.object({ name: z.string().min(1), share: z.number().int().nonnegative() }).nullable(),
  heatmap: z.array(usageHeatmapCellSchema),
  daily: z.array(usageDailyRowSchema),
  models: z.array(usageModelShareSchema),
}) satisfies z.ZodType<Wire<UsageSummaryView>>
