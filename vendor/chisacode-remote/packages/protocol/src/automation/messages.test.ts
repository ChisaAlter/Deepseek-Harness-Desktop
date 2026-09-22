import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  AutomationInboundMessageSchemas,
  AutomationOutboundMessageSchemas,
  ChatWaitRequestSchema,
  LoopRunResponseSchema,
  ScheduleUpdateRequestSchema,
} from "./messages.js";

function schemaTypes(schemas: readonly { shape: { type: { value: string } } }[]): string[] {
  return schemas.map((schema) => schema.shape.type.value);
}

describe("automation message domain", () => {
  test("owns unique chat, schedule, and loop message type sets", () => {
    const inboundTypes = schemaTypes(AutomationInboundMessageSchemas);
    const outboundTypes = schemaTypes(AutomationOutboundMessageSchemas);

    expect(inboundTypes).toHaveLength(21);
    expect(new Set(inboundTypes).size).toBe(inboundTypes.length);
    expect(outboundTypes).toHaveLength(21);
    expect(new Set(outboundTypes).size).toBe(outboundTypes.length);
  });

  test("keeps direct schemas and aggregate session unions aligned", () => {
    const requests = [
      ChatWaitRequestSchema.parse({
        type: "chat/wait",
        requestId: "chat-1",
        room: "release-room",
        timeoutMs: 1_000,
      }),
      ScheduleUpdateRequestSchema.parse({
        type: "schedule/update",
        requestId: "schedule-1",
        scheduleId: "nightly-review",
        prompt: "Review the current checkout",
      }),
    ];

    for (const request of requests) {
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }

    const response = LoopRunResponseSchema.parse({
      type: "loop/run/response",
      payload: {
        requestId: "loop-1",
        loop: null,
        error: "not started",
      },
    });
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
