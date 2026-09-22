import { afterEach, describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { __private__, rememberArchivedAgentDetail } from "./agent-history-navigation";

function agent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "server-1",
    serverLabel: "Server 1",
    title: "Archived task",
    status: "closed",
    lastActivityAt: new Date("2026-04-02T10:00:00.000Z"),
    cwd: "/repo",
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: new Date("2026-04-02T10:05:00.000Z"),
    createdAt: new Date("2026-04-02T09:00:00.000Z"),
    labels: {},
    ...overrides,
  };
}

describe("rememberArchivedAgentDetail", () => {
  afterEach(() => {
    useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
  });

  it("does not treat invalid archived dates as archived", () => {
    expect(__private__.isValidArchivedAt(new Date(Number.NaN))).toBe(false);
    expect(__private__.isValidArchivedAt(null)).toBe(false);
  });

  it("caches valid archived agent details for history navigation", () => {
    useSessionStore.getState().initializeSession("server-1", {} as DaemonClient);

    rememberArchivedAgentDetail(agent());

    expect(
      useSessionStore.getState().sessions["server-1"]?.agentDetails.get("agent-1"),
    ).toMatchObject({
      id: "agent-1",
      archivedAt: new Date("2026-04-02T10:05:00.000Z"),
      cwd: "/repo",
      title: "Archived task",
    });
  });

  it("does not cache agent details when archivedAt is invalid", () => {
    useSessionStore.getState().initializeSession("server-1", {} as DaemonClient);

    rememberArchivedAgentDetail(agent({ archivedAt: new Date(Number.NaN) }));

    expect(useSessionStore.getState().sessions["server-1"]?.agentDetails.size).toBe(0);
  });
});
