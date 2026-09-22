import { describe, expect, test, vi } from "vitest";
import type { AgentManagerEvent, ManagedAgent } from "./agent/agent-manager.js";
import { AgentEventForwarder } from "./agent-event-forwarder.js";
import { asSessionLogger } from "./test-utils/session-stubs.js";
import { createStub } from "./test-utils/class-mocks.js";

function createHarness(input?: { supportsGenerativeUi?: boolean; forwardRejects?: boolean }) {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  const emit = vi.fn();
  const logger = asSessionLogger({ trace: vi.fn(), error: vi.fn() });
  const forwardAgentUpdate = input?.forwardRejects
    ? vi.fn(async () => {
        throw new Error("projection failed");
      })
    : vi.fn(async () => undefined);
  const forwarder = new AgentEventForwarder({
    agentManager: {
      subscribe: (callback) => {
        subscriber = callback;
        return unsubscribe;
      },
    },
    sessionLogger: logger,
    supports: () => input?.supportsGenerativeUi ?? true,
    forwardAgentUpdate,
    emit,
  });
  forwarder.start();
  return {
    forwarder,
    emit,
    logger,
    forwardAgentUpdate,
    unsubscribe,
    emitEvent(event: AgentManagerEvent) {
      subscriber?.(event);
    },
  };
}

function createManagedAgent(): ManagedAgent {
  return createStub<ManagedAgent>({
    id: "agent-1",
    provider: "codex",
    lifecycle: "idle",
    persistence: null,
    activeForegroundTurnId: null,
  });
}

describe("AgentEventForwarder", () => {
  test("isolates asynchronous agent-state projection failures", async () => {
    const harness = createHarness({ forwardRejects: true });
    const agent = createManagedAgent();
    harness.emitEvent({ type: "agent_state", agent });

    await vi.waitFor(() => {
      expect(harness.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: agent.id, provider: agent.provider }),
        "Failed to project AgentManager state update to client session",
      );
    });
    harness.forwarder.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("filters generative UI stream events for clients without the capability", () => {
    const harness = createHarness({ supportsGenerativeUi: false });
    harness.emitEvent({
      type: "agent_stream",
      agentId: "agent-1",
      seq: 1,
      epoch: 1,
      event: {
        type: "generative_ui_remove",
        provider: "codex",
        instanceId: "ui-1",
      },
    });
    expect(harness.emit).not.toHaveBeenCalled();
  });

  test("emits stream and permission compatibility messages in order", () => {
    const harness = createHarness();
    const request = {
      id: "permission-1",
      provider: "codex" as const,
      name: "shell",
      kind: "tool" as const,
    };
    harness.emitEvent({
      type: "agent_stream",
      agentId: "agent-1",
      seq: 2,
      epoch: 1,
      event: { type: "permission_requested", provider: "codex", request },
    });

    expect(harness.emit.mock.calls.map(([message]) => message.type)).toEqual([
      "agent_stream",
      "agent_permission_request",
    ]);
  });
});
