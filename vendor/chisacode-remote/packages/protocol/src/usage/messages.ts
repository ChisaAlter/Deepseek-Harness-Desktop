import { z } from "zod/v3";

export const UsageRangeDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(180)]);
export const UsageExportFormatSchema = z.enum(["json", "csv"]);

export const UsageSummaryGetRequestMessageSchema = z.object({
  type: z.literal("usage.summary.get.request"),
  requestId: z.string(),
  rangeDays: UsageRangeDaysSchema.default(30),
});

export const UsageExportRequestMessageSchema = z.object({
  type: z.literal("usage.export.request"),
  requestId: z.string(),
  format: UsageExportFormatSchema.default("json"),
});

export const UsageClearRequestMessageSchema = z.object({
  type: z.literal("usage.clear.request"),
  requestId: z.string(),
});

const UsageModelSummaryPayloadSchema = z.object({
  model: z.string(),
  totalTokens: z.number().nonnegative(),
  turnCount: z.number().int().nonnegative(),
  percentage: z.number().int().nonnegative(),
});

const UsageDailySummaryPayloadSchema = z.object({
  date: z.string(),
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  turnCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  topModel: z.string().nullable(),
  models: z.array(UsageModelSummaryPayloadSchema),
});

export const UsageSummaryPayloadSchema = z.object({
  rangeDays: UsageRangeDaysSchema,
  generatedAt: z.string(),
  totals: z.object({
    inputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    activeDays: z.number().int().nonnegative(),
    currentStreakDays: z.number().int().nonnegative(),
  }),
  mostUsedModel: UsageModelSummaryPayloadSchema.nullable(),
  daily: z.array(UsageDailySummaryPayloadSchema),
  models: z.array(UsageModelSummaryPayloadSchema),
});

export const UsageSummaryGetResponseMessageSchema = z.object({
  type: z.literal("usage.summary.get.response"),
  payload: z.object({
    requestId: z.string(),
    summary: UsageSummaryPayloadSchema,
  }),
});

export const UsageExportResponseMessageSchema = z.object({
  type: z.literal("usage.export.response"),
  payload: z.object({
    requestId: z.string(),
    format: UsageExportFormatSchema,
    filename: z.string(),
    content: z.string(),
  }),
});

export const UsageClearResponseMessageSchema = z.object({
  type: z.literal("usage.clear.response"),
  payload: z.object({
    requestId: z.string(),
    cleared: z.boolean(),
  }),
});

/** Usage request schemas included in the session inbound union. */
export const UsageInboundMessageSchemas = [
  UsageSummaryGetRequestMessageSchema,
  UsageExportRequestMessageSchema,
  UsageClearRequestMessageSchema,
] as const;

/** Usage response schemas included in the session outbound union. */
export const UsageOutboundMessageSchemas = [
  UsageSummaryGetResponseMessageSchema,
  UsageExportResponseMessageSchema,
  UsageClearResponseMessageSchema,
] as const;

/** Supported day ranges for usage aggregation. */
export type UsageRangeDays = z.infer<typeof UsageRangeDaysSchema>;
/** Supported usage export formats. */
export type UsageExportFormat = z.infer<typeof UsageExportFormatSchema>;
/** Request for a usage summary over a selected day range. */
export type UsageSummaryGetRequestMessage = z.infer<typeof UsageSummaryGetRequestMessageSchema>;
/** Request to export locally recorded usage. */
export type UsageExportRequestMessage = z.infer<typeof UsageExportRequestMessageSchema>;
/** Request to clear locally recorded usage. */
export type UsageClearRequestMessage = z.infer<typeof UsageClearRequestMessageSchema>;
/** Aggregated local usage statistics returned by the daemon. */
export type UsageSummaryPayload = z.infer<typeof UsageSummaryPayloadSchema>;
/** Response containing an aggregated usage summary. */
export type UsageSummaryGetResponseMessage = z.infer<typeof UsageSummaryGetResponseMessageSchema>;
/** Response containing an exported usage document. */
export type UsageExportResponseMessage = z.infer<typeof UsageExportResponseMessageSchema>;
/** Response confirming whether usage data was cleared. */
export type UsageClearResponseMessage = z.infer<typeof UsageClearResponseMessageSchema>;
