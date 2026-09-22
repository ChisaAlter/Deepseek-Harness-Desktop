import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@chisacode/protocol/messages";
import { PARENT_AGENT_ID_LABEL, RELATION_KIND_LABEL } from "@chisacode/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";
import { normalizeAgentSnapshot, resolveAuthoritativeAgentSnapshot } from "./agent-snapshots";

function createSnapshot(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    labels?: Record<string, unknown>;
  } = {},
): AgentSnapshotPayload {
  return {
    id: input.id ?? "agent-1",
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    status: input.status ?? "idle",
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    title: input.title ?? null,
    labels: (input.labels ?? {}) as AgentSnapshotPayload["labels"],
    ...(input.relation ? { relation: input.relation } : {}),
  };
}

describe("normalizeAgentSnapshot", () => {
  it("derives parentAgentId from the parent label while preserving labels", () => {
    const labels = {
      [PARENT_AGENT_ID_LABEL]: "parent-1",
      "custom.label": "still-here",
    };

    const agent = normalizeAgentSnapshot(createSnapshot({ labels }), "server-1");

    expect(agent.parentAgentId).toBe("parent-1");
    expect(agent.relationKind).toBe("subagent");
    expect(agent.labels).toEqual(labels);
  });

  it("trims whitespace around the parent label", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "  parent-1 \n" } }),
      "server-1",
    );

    expect(agent.parentAgentId).toBe("parent-1");
  });

  it("maps missing, empty, and non-string parent labels to null", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const empty = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } }),
      "server-1",
    );
    const nonString = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } }),
      "server-1",
    );

    expect(missing.parentAgentId).toBeNull();
    expect(empty.parentAgentId).toBeNull();
    expect(nonString.parentAgentId).toBeNull();
    expect(missing.relationKind).toBeNull();
  });

  it("uses explicit snapshot relation before compatibility labels", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({
        relation: {
          kind: "handoff",
          parentAgentId: "snapshot-parent",
          source: "user",
        },
        labels: {
          [PARENT_AGENT_ID_LABEL]: "label-parent",
          [RELATION_KIND_LABEL]: "subagent",
        },
      }),
      "server-1",
    );

    expect(agent.parentAgentId).toBe("snapshot-parent");
    expect(agent.relationKind).toBe("handoff");
  });
});

function makeStoreAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    serverId: "server-1",
    id: "agent-1",
    provider: "codex",
    status: "idle",
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:01:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-04-20T00:01:00.000Z"),
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
    title: "Agent 1",
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    ...overrides,
  };
}

describe("resolveAuthoritativeAgentSnapshot", () => {
  it("rejects snapshots older than the current entry", () => {
    const current = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:02:00.000Z") });
    const incoming = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:01:30.000Z") });

    expect(resolveAuthoritativeAgentSnapshot(current, incoming)).toEqual({ status: "reject" });
  });

  it("applies newer snapshots unchanged", () => {
    const current = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:01:00.000Z") });
    const incoming = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:03:00.000Z") });

    expect(resolveAuthoritativeAgentSnapshot(current, incoming)).toEqual({
      status: "apply",
      agent: incoming,
    });
  });

  it("applies a same-timestamp snapshot when the entry is not archived", () => {
    const current = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:01:00.000Z") });
    const incoming = makeStoreAgent({ updatedAt: new Date("2026-04-20T00:01:00.000Z") });

    expect(resolveAuthoritativeAgentSnapshot(current, incoming)).toEqual({
      status: "apply",
      agent: incoming,
    });
  });

  it("keeps the archived state when a same-timestamp snapshot lacks archivedAt", () => {
    // In-flight pre-archive snapshots racing the optimistic archive carry the
    // same updatedAt (the optimistic archive does not change it) and no
    // archivedAt; replacing would make the archived session flicker back.
    const archivedAt = new Date("2026-04-20T00:02:00.000Z");
    const current = makeStoreAgent({ updatedAt: archivedAt, archivedAt });
    const incoming = makeStoreAgent({
      updatedAt: archivedAt,
      title: "Newer title",
    });

    const resolved = resolveAuthoritativeAgentSnapshot(current, incoming);
    expect(resolved.status).toBe("apply");
    if (resolved.status !== "apply") {
      return;
    }
    expect(resolved.agent.archivedAt).toEqual(archivedAt);
    expect(resolved.agent.title).toBe("Newer title");
  });

  it("allows a newer unarchive snapshot to clear the archived state", () => {
    // Explicit unarchive resumes the agent with a newer updatedAt, so the
    // monotonic guard must not block it.
    const archivedAt = new Date("2026-04-20T00:02:00.000Z");
    const current = makeStoreAgent({ updatedAt: archivedAt, archivedAt });
    const incoming = makeStoreAgent({
      updatedAt: new Date("2026-04-20T00:04:00.000Z"),
      archivedAt: null,
    });

    expect(resolveAuthoritativeAgentSnapshot(current, incoming)).toEqual({
      status: "apply",
      agent: incoming,
    });
  });

  it("applies the incoming snapshot when no entry exists yet", () => {
    const incoming = makeStoreAgent();

    expect(resolveAuthoritativeAgentSnapshot(undefined, incoming)).toEqual({
      status: "apply",
      agent: incoming,
    });
  });
});
