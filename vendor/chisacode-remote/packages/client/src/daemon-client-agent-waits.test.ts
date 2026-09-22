import type {
  AgentSnapshotPayload,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "@chisacode/protocol/messages";
import { expect, test, vi } from "vitest";

import {
  AgentWaitClient,
  type AgentPermissionResolvedPayload,
} from "./daemon-client-agent-waits.js";
import type { DaemonRequestCoordinator } from "./daemon-client-request-coordinator.js";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;

function createAgentSnapshot(id: string): AgentSnapshotPayload {
  return {
    id,
    provider: "codex",
    cwd: "/repo/client-waits",
    model: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "running",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsRewindBoth: false,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    archivedAt: null,
  };
}

test("waitForAgentUpsert rejects and cleans up when an async update predicate throws", async () => {
  let updateHandler: ((message: AgentUpdateMessage) => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribeAgentUpdates = vi.fn((handler: (message: AgentUpdateMessage) => void) => {
    updateHandler = handler;
    return unsubscribe;
  });
  const client = new AgentWaitClient({
    createRequestId: () => "req-wait",
    fetchAgent: vi.fn(async () => null),
    requests: {
      request: vi.fn(),
      requestCorrelated: vi.fn(),
    } as unknown as Pick<DaemonRequestCoordinator, "request" | "requestCorrelated">,
    sendMessage: vi.fn(),
    subscribeAgentUpdates,
  });

  const waiting = client.waitForAgentUpsert(
    "agent-wait",
    () => {
      throw new Error("predicate exploded");
    },
    10_000,
  );

  await vi.waitFor(() => expect(updateHandler).not.toBeNull());
  updateHandler?.({
    type: "agent_update",
    payload: {
      kind: "upsert",
      agent: createAgentSnapshot("agent-wait"),
      project: null,
    },
  });

  await expect(waiting).rejects.toThrow("predicate exploded");
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("respondToPermissionAndWait ignores resolutions for another agent", async () => {
  interface PermissionRequestParams {
    requestId: string;
    message: SessionInboundMessage;
    timeout: number;
    options?: { skipQueue?: boolean };
    select(message: SessionOutboundMessage): AgentPermissionResolvedPayload | null;
  }

  const request = vi.fn(async (params: PermissionRequestParams) => {
    expect(
      params.select({
        type: "agent_permission_resolved",
        payload: {
          agentId: "agent-other",
          requestId: params.requestId,
          resolution: { behavior: "allow" },
        },
      }),
    ).toBeNull();
    const resolved: Extract<SessionOutboundMessage, { type: "agent_permission_resolved" }> = {
      type: "agent_permission_resolved",
      payload: {
        agentId: "agent-target",
        requestId: params.requestId,
        resolution: { behavior: "allow" },
      },
    };
    return params.select(resolved)!;
  });
  const client = new AgentWaitClient({
    createRequestId: () => "req-unused",
    fetchAgent: vi.fn(async () => null),
    requests: {
      request,
      requestCorrelated: vi.fn(),
    } as unknown as Pick<DaemonRequestCoordinator, "request" | "requestCorrelated">,
    sendMessage: vi.fn(),
    subscribeAgentUpdates: vi.fn(() => vi.fn()),
  });

  await expect(
    client.respondToPermissionAndWait("agent-target", "permission-1", { behavior: "allow" }, 2_000),
  ).resolves.toMatchObject({
    agentId: "agent-target",
    requestId: "permission-1",
    resolution: { behavior: "allow" },
  });
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "permission-1",
      timeout: 2_000,
      options: { skipQueue: true },
      message: {
        type: "agent_permission_response",
        agentId: "agent-target",
        requestId: "permission-1",
        response: { behavior: "allow" },
      },
    }),
  );
});
