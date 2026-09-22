import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexSessionEventBus } from "./session-event-bus.js";

describe("Codex session event bus", () => {
  test("tags emitted events with the active foreground turn", () => {
    let turnId: string | null = "turn-1";
    const events: AgentStreamEvent[] = [];
    const bus = new CodexSessionEventBus(createTestLogger(), {
      agentId: "agent-1",
      getSessionId: () => "thread-1",
      getTurnId: () => turnId,
    });
    bus.subscribe((event) => events.push(event));

    bus.emit({
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "hello" },
    });
    turnId = null;
    bus.emit({ type: "turn_started", provider: "codex" });

    expect(events).toEqual([
      {
        type: "timeline",
        provider: "codex",
        turnId: "turn-1",
        item: { type: "assistant_message", text: "hello" },
      },
      { type: "turn_started", provider: "codex" },
    ]);
  });

  test("isolates subscriber failures and supports clearing subscriptions", () => {
    const events: AgentStreamEvent[] = [];
    const bus = new CodexSessionEventBus(createTestLogger(), {
      getSessionId: () => null,
      getTurnId: () => null,
    });
    bus.subscribe(() => {
      throw new Error("subscriber failed");
    });
    bus.subscribe((event) => events.push(event));

    bus.emit({ type: "turn_started", provider: "codex" });
    bus.clear();
    bus.emit({ type: "turn_completed", provider: "codex" });

    expect(events).toEqual([{ type: "turn_started", provider: "codex" }]);
  });
});
