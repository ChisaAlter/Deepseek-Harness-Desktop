import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "@chisacode/protocol/messages";

import { DaemonRequestCoordinator } from "./daemon-client-request-coordinator.js";
import { DaemonRpcError } from "./daemon-client-rpc-error.js";

afterEach(() => {
  vi.useRealTimers();
});

function createCoordinatorHarness(initialStatus: "connecting" | "connected" = "connected") {
  let status: "connecting" | "connected" | "disconnected" = initialStatus;
  let requestSequence = 0;
  const sentMessages: SessionInboundMessage[] = [];
  const coordinator = new DaemonRequestCoordinator({
    createRequestId: (requestId?: string) => requestId ?? "req-" + ++requestSequence,
    getConnectionStatus: () => status,
    sendConnectedMessage: (message) => sentMessages.push(message),
  });
  return {
    coordinator,
    sentMessages,
    setStatus(nextStatus: typeof status) {
      status = nextStatus;
    },
  };
}

function fetchAgentResponse(requestId: string): SessionOutboundMessage {
  return {
    type: "fetch_agent_response",
    payload: { requestId, agent: null, project: null, error: null },
  };
}

describe("DaemonRequestCoordinator", () => {
  it("correlates responses by request id and builds canonical session requests", async () => {
    const harness = createCoordinatorHarness();
    const pending = harness.coordinator.requestSession({
      requestId: "fetch-1",
      message: { type: "fetch_agent_request", agentId: "agent-1" },
      responseType: "fetch_agent_response",
      timeout: 1_000,
    });

    expect(harness.sentMessages).toEqual([
      { type: "fetch_agent_request", requestId: "fetch-1", agentId: "agent-1" },
    ]);
    harness.coordinator.handleMessage(fetchAgentResponse("other-request"));
    harness.coordinator.handleMessage(fetchAgentResponse("fetch-1"));

    await expect(pending).resolves.toMatchObject({ requestId: "fetch-1", agent: null });
  });

  it("surfaces correlated rpc errors with daemon metadata", async () => {
    const harness = createCoordinatorHarness();
    const pending = harness.coordinator.requestSession({
      requestId: "fetch-error",
      message: { type: "fetch_agent_request", agentId: "agent-1" },
      responseType: "fetch_agent_response",
      timeout: 1_000,
    });

    harness.coordinator.handleMessage({
      type: "rpc_error",
      payload: {
        requestId: "fetch-error",
        requestType: "fetch_agent_request",
        code: "RESTORE_FAILED",
        error: "restore failed",
      },
    });

    let rejection: unknown;
    try {
      await pending;
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(DaemonRpcError);
    expect(rejection).toMatchObject({
      requestId: "fetch-error",
      requestType: "fetch_agent_request",
      code: "RESTORE_FAILED",
    });
  });

  it("flushes connecting requests and rejects all pending work on disconnect", async () => {
    vi.useFakeTimers();
    const harness = createCoordinatorHarness("connecting");
    const flushed = harness.coordinator.requestSession({
      requestId: "queued-1",
      message: { type: "fetch_agent_request", agentId: "agent-1" },
      responseType: "fetch_agent_response",
      timeout: 1_000,
    });
    expect(harness.sentMessages).toHaveLength(0);

    harness.setStatus("connected");
    harness.coordinator.flushPendingSends();
    expect(harness.sentMessages).toHaveLength(1);
    harness.coordinator.handleMessage(fetchAgentResponse("queued-1"));
    await expect(flushed).resolves.toMatchObject({ requestId: "queued-1" });

    harness.setStatus("connecting");
    const disconnected = harness.coordinator.requestSession({
      requestId: "queued-2",
      message: { type: "fetch_agent_request", agentId: "agent-2" },
      responseType: "fetch_agent_response",
      timeout: 1_000,
    });
    harness.setStatus("disconnected");
    harness.coordinator.clear(new Error("connection dropped"));
    await expect(disconnected).rejects.toThrow("connection dropped");
    expect(vi.getTimerCount()).toBe(0);
  });
});
