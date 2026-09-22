import { describe, expect, test } from "vitest";

import {
  AgentListItemPayloadSchema as LegacyAgentListItemPayloadSchema,
  AgentPermissionRequestPayloadSchema as LegacyAgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema as LegacyAgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema as LegacyAgentSnapshotPayloadSchema,
  AgentStatusSchema as LegacyAgentStatusSchema,
  AgentStreamEventPayloadSchema as LegacyAgentStreamEventPayloadSchema,
  AgentTimelineItemPayloadSchema as LegacyAgentTimelineItemPayloadSchema,
} from "../messages.js";
import {
  AgentListItemPayloadSchema,
  AgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema,
  AgentStatusSchema,
  AgentStreamEventPayloadSchema,
  AgentTimelineItemPayloadSchema,
} from "./state.js";

const requiredCapabilities = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

describe("agent state protocol domain", () => {
  test("preserves the legacy messages re-export identities", () => {
    expect(LegacyAgentStatusSchema).toBe(AgentStatusSchema);
    expect(LegacyAgentPermissionRequestPayloadSchema).toBe(AgentPermissionRequestPayloadSchema);
    expect(LegacyAgentPermissionResponseSchema).toBe(AgentPermissionResponseSchema);
    expect(LegacyAgentTimelineItemPayloadSchema).toBe(AgentTimelineItemPayloadSchema);
    expect(LegacyAgentStreamEventPayloadSchema).toBe(AgentStreamEventPayloadSchema);
    expect(LegacyAgentSnapshotPayloadSchema).toBe(AgentSnapshotPayloadSchema);
    expect(LegacyAgentListItemPayloadSchema).toBe(AgentListItemPayloadSchema);
  });

  test("preserves snapshot and list compatibility defaults", () => {
    const snapshot = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "codex",
      cwd: "/repo",
      model: null,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: requiredCapabilities,
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
    });

    expect(snapshot.labels).toEqual({});
    expect(snapshot.capabilities).toMatchObject({
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsRewindBoth: false,
    });

    expect(
      AgentListItemPayloadSchema.parse({
        id: "agent-1",
        shortId: "agent-1",
        title: null,
        provider: "codex",
        model: null,
        status: "idle",
        cwd: "/repo",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        lastUserMessageAt: null,
      }).labels,
    ).toEqual({});
  });

  test("parses tool timeline and permission stream events", () => {
    expect(
      AgentStreamEventPayloadSchema.parse({
        type: "timeline",
        provider: "codex",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "shell",
          detail: { type: "shell", command: "git status" },
          status: "running",
          error: null,
        },
      }).type,
    ).toBe("timeline");

    expect(
      AgentStreamEventPayloadSchema.parse({
        type: "permission_requested",
        provider: "codex",
        request: {
          id: "permission-1",
          provider: "codex",
          name: "shell",
          kind: "tool",
        },
      }).type,
    ).toBe("permission_requested");
  });
});
