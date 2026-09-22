import { describe, expect, test } from "vitest";

import {
  AgentCreatedStatusPayloadSchema as LegacyAgentCreatedStatusPayloadSchema,
  AgentUpdateMessageSchema as LegacyAgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema as LegacyCreateAgentRequestMessageSchema,
  KnownStatusPayloadSchema,
  SendAgentMessageSchema as LegacySendAgentMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "../messages.js";
import {
  AgentCreatedStatusPayloadSchema,
  AgentInboundMessageSchemas,
  AgentOutboundMessageSchemas,
  AgentStatusPayloadSchemas,
  AgentUpdateMessageSchema,
  CreateAgentRequestMessageSchema,
  SendAgentMessageSchema,
} from "./messages.js";

describe("agent message domain", () => {
  test("owns 23 inbound, 23 outbound, and four lifecycle status schemas", () => {
    expect(AgentInboundMessageSchemas).toHaveLength(23);
    expect(AgentOutboundMessageSchemas).toHaveLength(23);
    expect(AgentStatusPayloadSchemas).toHaveLength(4);
  });

  test("preserves legacy messages re-export identities", () => {
    expect(LegacyCreateAgentRequestMessageSchema).toBe(CreateAgentRequestMessageSchema);
    expect(LegacyAgentCreatedStatusPayloadSchema).toBe(AgentCreatedStatusPayloadSchema);
    expect(LegacyAgentUpdateMessageSchema).toBe(AgentUpdateMessageSchema);
    expect(LegacySendAgentMessageSchema).toBe(SendAgentMessageSchema);
  });

  test("keeps agent requests, events, and status payloads in the aggregate unions", () => {
    const inbound = {
      type: "delete_agent_request" as const,
      agentId: "agent-1",
      requestId: "delete-1",
    };
    const outbound = {
      type: "agent_deleted" as const,
      payload: { agentId: "agent-1", requestId: "delete-1" },
    };
    const status = {
      status: "agent_create_failed" as const,
      requestId: "create-1",
      error: "provider unavailable",
    };

    expect(AgentInboundMessageSchemas.some((schema) => schema.safeParse(inbound).success)).toBe(
      true,
    );
    expect(SessionInboundMessageSchema.parse(inbound)).toEqual(inbound);
    expect(AgentOutboundMessageSchemas.some((schema) => schema.safeParse(outbound).success)).toBe(
      true,
    );
    expect(SessionOutboundMessageSchema.parse(outbound)).toEqual(outbound);
    expect(AgentStatusPayloadSchemas.some((schema) => schema.safeParse(status).success)).toBe(true);
    expect(KnownStatusPayloadSchema.parse(status)).toEqual(status);
  });

  test("leaves cross-domain session control messages outside the agent tuples", () => {
    const inboundMessages = [
      { type: "abort_request" },
      { type: "close_items_request", requestId: "close-1" },
      {
        type: "project.rename.request",
        projectId: "project-1",
        customName: "ChisaCode",
        requestId: "rename-1",
      },
      {
        type: "model_gateway.moa.test.request",
        requestId: "moa-1",
        gatewayId: "gateway-1",
        syntheticModel: {
          id: "moa-model",
          label: "MoA Model",
          references: [{ model: "reference-model" }],
          aggregatorModel: "aggregator-model",
        },
        prompt: "Review this change",
      },
      {
        type: "client_heartbeat",
        deviceType: "web",
        focusedAgentId: null,
        lastActivityAt: "2026-07-14T00:00:00.000Z",
        appVisible: true,
      },
      { type: "ping", requestId: "ping-1" },
      { type: "register_push_token", token: "push-token" },
    ];

    for (const message of inboundMessages) {
      expect(AgentInboundMessageSchemas.some((schema) => schema.safeParse(message).success)).toBe(
        false,
      );
      expect(SessionInboundMessageSchema.safeParse(message).success).toBe(true);
    }

    const outboundMessages = [
      {
        type: "close_items_response",
        payload: { agents: [], terminals: [], requestId: "close-1" },
      },
      {
        type: "project.rename.response",
        payload: {
          requestId: "rename-1",
          projectId: "project-1",
          accepted: true,
          customName: "ChisaCode",
          error: null,
        },
      },
      {
        type: "model_gateway.moa.test.response",
        payload: {
          requestId: "moa-1",
          gatewayId: "gateway-1",
          result: null,
          error: null,
        },
      },
    ];

    for (const message of outboundMessages) {
      expect(AgentOutboundMessageSchemas.some((schema) => schema.safeParse(message).success)).toBe(
        false,
      );
      expect(SessionOutboundMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  test("keeps legacy send_agent_message outside the correlated session union", () => {
    const message = {
      type: "send_agent_message" as const,
      agentId: "agent-1",
      text: "hello",
    };

    expect(SendAgentMessageSchema.safeParse(message).success).toBe(true);
    expect(AgentInboundMessageSchemas.some((schema) => schema.safeParse(message).success)).toBe(
      false,
    );
    expect(SessionInboundMessageSchema.safeParse(message).success).toBe(false);
  });

  test("create_agent_request accepts an optional client-minted agentId", () => {
    const base = {
      type: "create_agent_request" as const,
      config: {
        provider: "codex" as const,
        cwd: "/repo",
      },
      labels: {},
      requestId: "create-1",
    };
    const withAgentId = {
      ...base,
      agentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    };

    // Older clients omit agentId entirely and still parse.
    expect(CreateAgentRequestMessageSchema.safeParse(base).success).toBe(true);
    expect(CreateAgentRequestMessageSchema.safeParse(withAgentId).success).toBe(true);
    expect(SessionInboundMessageSchema.safeParse(withAgentId).success).toBe(true);
  });

  test("create_agent_request rejects a non-UUID agentId", () => {
    const message = {
      type: "create_agent_request" as const,
      config: {
        provider: "codex" as const,
        cwd: "/repo",
      },
      labels: {},
      agentId: "not-a-uuid",
      requestId: "create-1",
    };

    expect(CreateAgentRequestMessageSchema.safeParse(message).success).toBe(false);
  });

  test("agent_created status carries an optional project placement", () => {
    const agent = {
      id: "agent-1",
      provider: "codex",
      cwd: "/repo",
      model: null,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:01:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    };
    const withProject = {
      status: "agent_created" as const,
      agentId: "agent-1",
      requestId: "create-1",
      agent,
      project: {
        projectKey: "remote:github.com/owner/repo",
        projectName: "owner/repo",
        checkout: {
          cwd: "/repo",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "git@github.com:owner/repo.git",
          worktreeRoot: "/repo",
          isChisaCodeOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
      pendingRun: true,
    };
    const withoutProject = {
      status: "agent_created" as const,
      agentId: "agent-1",
      requestId: "create-1",
      agent,
      pendingRun: true,
    };

    expect(AgentCreatedStatusPayloadSchema.safeParse(withProject).success).toBe(true);
    expect(AgentCreatedStatusPayloadSchema.safeParse(withoutProject).success).toBe(true);
    const parsed = KnownStatusPayloadSchema.parse(withProject) as {
      status: string;
      agentId: string;
      requestId: string;
      project?: { projectKey: string };
      pendingRun?: boolean;
    };
    expect(parsed.status).toBe("agent_created");
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.project?.projectKey).toBe("remote:github.com/owner/repo");
    expect(parsed.pendingRun).toBe(true);
  });
});
