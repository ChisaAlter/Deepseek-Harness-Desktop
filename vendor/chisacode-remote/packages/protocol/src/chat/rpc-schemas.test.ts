import { describe, expect, test } from "vitest";
import { CHAT_WAIT_MAX_TIMEOUT_MS, ChatWaitRequestSchema } from "./rpc-schemas.js";

describe("ChatWaitRequestSchema", () => {
  test("accepts a missing timeout and rejects deadlines above the explicit maximum", () => {
    expect(CHAT_WAIT_MAX_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(
      ChatWaitRequestSchema.safeParse({
        type: "chat/wait",
        requestId: "request-default",
        room: "room",
      }).success,
    ).toBe(true);
    expect(
      ChatWaitRequestSchema.safeParse({
        type: "chat/wait",
        requestId: "request-too-long",
        room: "room",
        timeoutMs: CHAT_WAIT_MAX_TIMEOUT_MS + 1,
      }).success,
    ).toBe(false);
  });
});
