import { describe, expect, test, vi } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { PiExtensionHistoryController } from "./extension-history-controller.js";
import { PiSessionEventController } from "./session-event-controller.js";
import type { PiRuntimeEvent } from "./rpc-types.js";

function createController() {
  const emitted: AgentStreamEvent[] = [];
  const responses: Array<{ id: string; response: { cancelled?: boolean } }> = [];
  const extensionHistory = {
    close: vi.fn(),
    handleMarker: vi.fn(() => false),
    queueUserMessage: vi.fn(),
  } as unknown as PiExtensionHistoryController;
  const controller = new PiSessionEventController({
    runtimeSession: {
      respondToExtensionUiRequest: vi.fn((id, response) => responses.push({ id, response })),
    },
    extensionHistory,
    emit: (event) => emitted.push(event),
    getSessionId: () => "pi-session",
    resolveTurnError: () => null,
    onTurnCompleted: vi.fn(),
  });
  return { controller, emitted, responses, extensionHistory };
}

function terminalEvents(events: AgentStreamEvent[]) {
  return events.filter(
    (event) =>
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled",
  );
}

describe("PiSessionEventController", () => {
  test("emits only one terminal event for duplicate agent_end and late events", () => {
    const { controller, emitted } = createController();
    controller.beginTurn("turn-1");
    const end: PiRuntimeEvent = { type: "agent_end", messages: [] };
    controller.handleRuntimeEvent(end);
    controller.handleRuntimeEvent(end);
    controller.handleRuntimeEvent({ type: "turn_start" });

    expect(terminalEvents(emitted)).toEqual([
      { type: "turn_completed", provider: "pi", turnId: "turn-1" },
    ]);
    expect(emitted.filter((event) => event.type === "turn_started")).toHaveLength(1);
  });

  test("close terminalizes an active turn, cancels permissions, and ignores late events", () => {
    const { controller, emitted, responses, extensionHistory } = createController();
    controller.beginTurn("turn-1");
    controller.handleRuntimeEvent({
      type: "extension_ui_request",
      id: "permission-1",
      method: "confirm",
      title: "Continue?",
    });
    expect(controller.getPendingPermissions()).toHaveLength(1);

    controller.close(new Error("runtime closed"));
    controller.close(new Error("duplicate close"));
    controller.handleRuntimeEvent({ type: "agent_end", messages: [] });

    expect(terminalEvents(emitted)).toEqual([
      {
        type: "turn_canceled",
        provider: "pi",
        turnId: "turn-1",
        reason: "runtime closed",
      },
    ]);
    expect(responses).toEqual([{ id: "permission-1", response: { cancelled: true } }]);
    expect(controller.getPendingPermissions()).toEqual([]);
    expect(extensionHistory.close).toHaveBeenCalledTimes(1);
  });

  test("maps process exit to a failed active turn and emits no duplicate terminal event", () => {
    const { controller, emitted } = createController();
    controller.beginTurn("turn-1");
    controller.handleRuntimeEvent({ type: "process_exit", error: "Pi exited" });
    controller.handleRuntimeEvent({ type: "process_exit", error: "late exit" });

    expect(terminalEvents(emitted)).toEqual([
      { type: "turn_failed", provider: "pi", turnId: "turn-1", error: "Pi exited" },
    ]);
  });

  test("propagates compaction abort as a failed timeline item", () => {
    const { controller, emitted } = createController();
    controller.beginTurn("turn-1");
    controller.handleRuntimeEvent({ type: "compaction_start", reason: "threshold" });
    controller.handleRuntimeEvent({ type: "compaction_end", aborted: true });

    expect(emitted.filter((event) => event.type === "timeline")).toEqual([
      expect.objectContaining({
        item: { type: "compaction", status: "loading", trigger: "auto" },
      }),
      expect.objectContaining({
        item: { type: "compaction", status: "failed" },
      }),
    ]);
  });

  test("ignores unknown permission responses without changing pending state", async () => {
    const { controller } = createController();
    await expect(
      controller.respondToPermission("missing", {
        behavior: "allow",
      }),
    ).rejects.toThrow("No pending permission request");
  });
});
