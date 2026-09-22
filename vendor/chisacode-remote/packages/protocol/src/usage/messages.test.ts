import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  UsageClearRequestMessageSchema,
  UsageExportRequestMessageSchema,
  UsageInboundMessageSchemas,
  UsageOutboundMessageSchemas,
  UsageSummaryGetRequestMessageSchema,
} from "./messages.js";

const usageSummaryResponse = {
  type: "usage.summary.get.response",
  payload: {
    requestId: "usage-summary",
    summary: {
      rangeDays: 7,
      generatedAt: "2026-06-20T12:00:00.000Z",
      totals: {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 40,
        totalTokens: 140,
        turnCount: 2,
        messageCount: 4,
        activeDays: 1,
        currentStreakDays: 1,
      },
      mostUsedModel: {
        model: "glm-5.2",
        totalTokens: 140,
        turnCount: 2,
        percentage: 100,
      },
      daily: [],
      models: [],
    },
  },
} as const;

describe("usage message domain", () => {
  test("owns exactly three inbound and three outbound schemas", () => {
    expect(UsageInboundMessageSchemas).toHaveLength(3);
    expect(UsageOutboundMessageSchemas).toHaveLength(3);
  });

  test("preserves compatible request defaults", () => {
    expect(
      UsageSummaryGetRequestMessageSchema.parse({
        type: "usage.summary.get.request",
        requestId: "usage-summary",
      }),
    ).toEqual({
      type: "usage.summary.get.request",
      requestId: "usage-summary",
      rangeDays: 30,
    });

    expect(
      UsageExportRequestMessageSchema.parse({
        type: "usage.export.request",
        requestId: "usage-export",
      }),
    ).toEqual({
      type: "usage.export.request",
      requestId: "usage-export",
      format: "json",
    });

    expect(
      UsageClearRequestMessageSchema.parse({
        type: "usage.clear.request",
        requestId: "usage-clear",
      }).type,
    ).toBe("usage.clear.request");
  });

  test("keeps all usage messages in the aggregate session unions", () => {
    const inboundMessages = [
      {
        type: "usage.summary.get.request",
        requestId: "usage-summary",
      },
      {
        type: "usage.export.request",
        requestId: "usage-export",
      },
      {
        type: "usage.clear.request",
        requestId: "usage-clear",
      },
    ];

    for (const message of inboundMessages) {
      expect(SessionInboundMessageSchema.parse(message).type).toBe(message.type);
    }

    const outboundMessages = [
      usageSummaryResponse,
      {
        type: "usage.export.response",
        payload: {
          requestId: "usage-export",
          format: "csv",
          filename: "chisacode-usage-2026-06-20.csv",
          content: "timestamp,inputTokens\n",
        },
      },
      {
        type: "usage.clear.response",
        payload: {
          requestId: "usage-clear",
          cleared: true,
        },
      },
    ];

    for (const message of outboundMessages) {
      expect(SessionOutboundMessageSchema.parse(message).type).toBe(message.type);
    }
  });
});
