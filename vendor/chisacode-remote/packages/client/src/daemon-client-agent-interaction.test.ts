import { describe, expect, it, vi } from "vitest";

import { AgentInteractionClient } from "./daemon-client-agent-interaction.js";
import { DaemonRpcError } from "./daemon-client-rpc-error.js";

interface CommandParams {
  requestId?: string;
  message: { type: string } & Record<string, unknown>;
  responseType: string;
  timeout: number;
}

function createAgentInteractionHarness() {
  let requestSequence = 0;
  let generativeUiSupported = false;
  let timelineError: string | null = null;
  let messageAccepted = true;
  let generativeUiReceived = true;
  const request = vi.fn(async (params: CommandParams) => {
    switch (params.responseType) {
      case "fetch_agent_timeline_response":
        return {
          requestId: params.requestId ?? "generated",
          agentId: params.message.agentId,
          agent: null,
          direction: params.message.direction ?? "tail",
          projection: params.message.projection ?? "projected",
          epoch: "epoch-1",
          reset: false,
          staleCursor: false,
          gap: false,
          startCursor: null,
          endCursor: null,
          hasMore: false,
          events: [],
          error: timelineError,
        };
      case "send_agent_message_response":
        return {
          requestId: params.requestId ?? "generated",
          accepted: messageAccepted,
          error: messageAccepted ? null : "message rejected",
        };
      case "generative_ui.action.response":
        return {
          requestId: params.requestId ?? "generated",
          received: generativeUiReceived,
          error: generativeUiReceived ? null : "action rejected",
        };
      default:
        throw new Error("Unexpected response type: " + params.responseType);
    }
  });
  const client = new AgentInteractionClient({
    request,
    createRequestId: (requestId?: string) => requestId ?? "req-" + ++requestSequence,
    supportsGenerativeUi: () => generativeUiSupported,
  } as unknown as ConstructorParameters<typeof AgentInteractionClient>[0]);
  return {
    client,
    request,
    setGenerativeUiSupported(value: boolean) {
      generativeUiSupported = value;
    },
    setTimelineError(value: string | null) {
      timelineError = value;
    },
    setMessageAccepted(value: boolean) {
      messageAccepted = value;
    },
    setGenerativeUiReceived(value: boolean) {
      generativeUiReceived = value;
    },
  };
}

describe("AgentInteractionClient", () => {
  it("maps timeline query options and preserves daemon errors", async () => {
    const harness = createAgentInteractionHarness();

    await expect(
      harness.client.fetchAgentTimeline("agent-1", {
        requestId: "timeline-1",
        direction: "tail",
        limit: 25,
        projection: "projected",
      }),
    ).resolves.toMatchObject({ requestId: "timeline-1", agentId: "agent-1" });

    expect(harness.request).toHaveBeenLastCalledWith({
      requestId: "timeline-1",
      message: {
        type: "fetch_agent_timeline_request",
        requestId: "timeline-1",
        agentId: "agent-1",
        direction: "tail",
        limit: 25,
        projection: "projected",
      },
      responseType: "fetch_agent_timeline_response",
      timeout: 60_000,
    });

    harness.setTimelineError("timeline unavailable");
    await expect(harness.client.fetchAgentTimeline("agent-1")).rejects.toThrow(
      "timeline unavailable",
    );
  });

  it("preserves message ids, attachments, and business rejection errors", async () => {
    const harness = createAgentInteractionHarness();
    const attachments = [
      {
        type: "github_pr" as const,
        mimeType: "application/github-pr" as const,
        number: 42,
        title: "Review",
        url: "https://github.com/acme/repo/pull/42",
        baseRefName: "main",
        headRefName: "review",
      },
    ];

    await harness.client.sendAgentMessage("agent-1", "ship it", {
      messageId: "message-1",
      attachments,
    });

    expect(harness.request.mock.calls[0][0]).toMatchObject({
      requestId: "req-1",
      message: {
        type: "send_agent_message_request",
        requestId: "req-1",
        agentId: "agent-1",
        text: "ship it",
        messageId: "message-1",
        attachments,
      },
      responseType: "send_agent_message_response",
      timeout: 15_000,
    });

    harness.setMessageAccepted(false);
    await expect(harness.client.sendAgentMessage("agent-1", "retry")).rejects.toThrow(
      "message rejected",
    );
  });

  it("gates generative UI capability and keeps RPC rejection metadata", async () => {
    const harness = createAgentInteractionHarness();

    await expect(
      harness.client.sendGenerativeUiAction("agent-1", "instance-1", "submit", null),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      requestId: "",
      requestType: "generative_ui.action.request",
    });
    expect(harness.request).not.toHaveBeenCalled();

    harness.setGenerativeUiSupported(true);
    await harness.client.sendGenerativeUiAction(
      "agent-1",
      "instance-1",
      "submit",
      { approved: true },
      { timeout: 2_500 },
    );
    expect(harness.request.mock.calls[0][0]).toMatchObject({
      requestId: "req-1",
      message: {
        type: "generative_ui.action.request",
        requestId: "req-1",
        agentId: "agent-1",
        instanceId: "instance-1",
        action: "submit",
        payload: { approved: true },
      },
      responseType: "generative_ui.action.response",
      timeout: 2_500,
    });

    harness.setGenerativeUiReceived(false);
    let rejection: unknown;
    try {
      await harness.client.sendGenerativeUiAction("agent-1", "instance-1", "submit", null);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(DaemonRpcError);
    expect(rejection).toMatchObject({
      requestId: "req-2",
      requestType: "generative_ui.action.request",
    });
  });
});
