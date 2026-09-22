import { describe, expect, it, vi } from "vitest";
import type { SessionOutboundMessage } from "@chisacode/protocol/messages";

import { AgentLifecycleClient } from "./daemon-client-agent-lifecycle.js";

interface CommandParams {
  requestId?: string;
  message: { type: string } & Record<string, unknown>;
  responseType: string;
  timeout: number;
}

interface StatusParams {
  requestId: string;
  message: { type: string } & Record<string, unknown>;
  timeout: number;
  select(message: SessionOutboundMessage): unknown | null;
}

function createAgentLifecycleHarness() {
  let requestSequence = 0;
  let nextStatusPayload: { status: string } & Record<string, unknown> = {
    status: "agent_create_failed",
    requestId: "req-1",
    error: "create failed",
  };
  const rejectedResponseTypes = new Set<string>();
  const request = vi.fn(async (params: CommandParams) => {
    const accepted = !rejectedResponseTypes.has(params.responseType);
    switch (params.responseType) {
      case "fetch_agent_response":
        return {
          requestId: params.requestId ?? "generated",
          agent: null,
          project: null,
          error: null,
        };
      case "agent_archived":
        return { requestId: params.requestId ?? "generated", archivedAt: "2026-07-13T00:00:00Z" };
      case "project.rename.response":
        return {
          requestId: params.requestId ?? "generated",
          accepted,
          customName: params.message.customName,
          error: accepted ? null : "rename rejected",
        };
      case "agent.rewind.response":
        return {
          requestId: params.requestId ?? "generated",
          ok: accepted,
          error: accepted ? null : "rewind rejected",
          agentId: params.message.agentId,
          mode: params.message.mode,
          conversationRewound: accepted,
          filesRewound: false,
        };
      default:
        return {
          requestId: params.requestId ?? "generated",
          accepted,
          error: accepted ? null : "command rejected",
        };
    }
  });
  const requestStatus = vi.fn(async (params: StatusParams) => {
    const result = params.select({ type: "status", payload: nextStatusPayload });
    if (result === null) {
      throw new Error("status selector rejected test payload");
    }
    return result;
  });
  const client = new AgentLifecycleClient({
    request,
    createRequestId: (requestId?: string) => requestId ?? `req-${++requestSequence}`,
    requestStatus,
  } as unknown as ConstructorParameters<typeof AgentLifecycleClient>[0]);
  return {
    client,
    request,
    requestStatus,
    rejectResponse(responseType: string) {
      rejectedResponseTypes.add(responseType);
    },
    setNextStatus(payload: typeof nextStatusPayload) {
      nextStatusPayload = payload;
    },
  };
}

describe("AgentLifecycleClient", () => {
  it("builds create-agent wire input and surfaces create failures", async () => {
    const harness = createAgentLifecycleHarness();

    await expect(harness.client.createAgent({ provider: "codex" })).rejects.toThrow(
      "createAgent requires provider and cwd",
    );
    expect(harness.requestStatus).not.toHaveBeenCalled();

    harness.setNextStatus({
      status: "agent_create_failed",
      requestId: "create-1",
      error: "sentinel failure",
    });
    await expect(
      harness.client.createAgent({
        provider: "codex",
        cwd: "/repo",
        requestId: "create-1",
        workspaceId: "workspace-1",
        initialPrompt: "review",
        worktree: { mode: "branch-off", newBranch: "review", base: "main" },
        autoArchive: true,
        attachments: [
          {
            type: "github_pr",
            mimeType: "application/github-pr",
            number: 123,
            title: "Review",
            url: "https://github.com/acme/repo/pull/123",
            baseRefName: "main",
            headRefName: "review",
          },
        ],
      }),
    ).rejects.toThrow("sentinel failure");

    const call = harness.requestStatus.mock.calls[0][0];
    expect(call).toMatchObject({ requestId: "create-1", timeout: 60_000 });
    expect(call.message).toMatchObject({
      type: "create_agent_request",
      requestId: "create-1",
      config: { provider: "codex", cwd: "/repo" },
      workspaceId: "workspace-1",
      initialPrompt: "review",
      worktree: { mode: "branch-off", newBranch: "review", base: "main" },
      autoArchive: true,
      attachments: [{ type: "github_pr", number: 123, title: "Review" }],
    });
  });

  it("keeps provider-handle imports distinct from legacy provider sessions", async () => {
    const harness = createAgentLifecycleHarness();
    harness.setNextStatus({
      status: "agent_create_failed",
      requestId: "req-1",
      error: "import sentinel",
    });

    await expect(
      harness.client.importAgent({
        providerId: "custom-codex",
        providerHandleId: "thread-1",
        cwd: "/repo",
      }),
    ).rejects.toThrow("import sentinel");

    expect(harness.requestStatus.mock.calls[0][0].message).toMatchObject({
      type: "import_agent_request",
      providerId: "custom-codex",
      providerHandleId: "thread-1",
      cwd: "/repo",
    });
    expect(harness.requestStatus.mock.calls[0][0].message).not.toHaveProperty("sessionId");
  });

  it("maps runtime settings and preserves business rejection errors", async () => {
    const harness = createAgentLifecycleHarness();

    await harness.client.setAgentModel("agent-1", "mimo-v2.5", "opencode-claude");
    await harness.client.setAgentMode("agent-1", "build");
    await harness.client.setAgentFeature("agent-1", "fast_mode", true);
    await harness.client.setAgentThinkingOption("agent-1", "high");
    await expect(
      harness.client.rewindAgent("agent-1", "message-1", "conversation"),
    ).resolves.toMatchObject({ ok: true });

    expect(harness.request.mock.calls.map(([params]) => params.message)).toEqual([
      {
        type: "set_agent_model_request",
        agentId: "agent-1",
        modelId: "mimo-v2.5",
        runtimeProvider: "opencode-claude",
      },
      { type: "set_agent_mode_request", agentId: "agent-1", modeId: "build" },
      {
        type: "set_agent_feature_request",
        agentId: "agent-1",
        featureId: "fast_mode",
        value: true,
      },
      { type: "set_agent_thinking_request", agentId: "agent-1", thinkingOptionId: "high" },
      {
        type: "agent.rewind.request",
        agentId: "agent-1",
        messageId: "message-1",
        mode: "conversation",
      },
    ]);

    harness.rejectResponse("update_agent_response");
    await expect(harness.client.updateAgent("agent-1", { name: "Renamed" })).rejects.toThrow(
      "command rejected",
    );
  });
});
