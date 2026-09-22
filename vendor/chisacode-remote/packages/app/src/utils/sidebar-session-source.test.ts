import { describe, expect, it } from "vitest";
import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { Agent } from "@/stores/session-store";
import { buildSidebarLiveAgents, mergeSidebarSessionSources } from "./sidebar-session-source";

function makeAgent(input: {
  id: string;
  serverId?: string;
  title?: string;
  status?: AggregatedAgent["status"];
  lastActivityAt?: Date;
  archivedAt?: Date | null;
}): AggregatedAgent {
  return {
    id: input.id,
    serverId: input.serverId ?? "server-1",
    serverLabel: input.serverId ?? "server-1",
    title: input.title ?? input.id,
    status: input.status ?? "idle",
    lastActivityAt: input.lastActivityAt ?? new Date("2026-04-02T10:00:00.000Z"),
    cwd: "/repo",
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: input.archivedAt ?? null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    labels: {},
  };
}

const BASE_TIME = new Date("2026-04-02T10:00:00.000Z");

function makeLiveAgent(input: Partial<Agent> & { id: string }): Agent {
  const { id, ...overrides } = input;
  return {
    serverId: "server-1",
    id,
    provider: "codex",
    status: "idle",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    lastUserMessageAt: null,
    lastActivityAt: BASE_TIME,
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
    runtimeInfo: undefined,
    lastUsage: undefined,
    lastError: null,
    title: input.id,
    cwd: "/repo",
    model: null,
    thinkingOptionId: undefined,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    parentAgentId: null,
    labels: {},
    projectPlacement: null,
    ...overrides,
  };
}

describe("mergeSidebarSessionSources", () => {
  it("preserves project placement for live sidebar agents", () => {
    const projectPlacement: ProjectPlacementPayload = {
      projectKey: "C:\\Ai\\sample-desktop",
      projectName: "sample-desktop",
      checkout: {
        cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
        isGit: true,
        currentBranch: "codex/gallant-owl",
        remoteUrl: null,
        worktreeRoot: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
        isChisaCodeOwnedWorktree: true,
        mainRepoRoot: "C:\\Ai\\sample-desktop",
      },
    };

    const result = buildSidebarLiveAgents({
      agents: new Map([
        [
          "owned-worktree",
          makeLiveAgent({
            id: "owned-worktree",
            cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
            projectPlacement,
          }),
        ],
      ]),
      serverId: "server-1",
      serverLabel: "Local",
    });

    expect(result[0]?.projectPlacement).toEqual(projectPlacement);
  });

  it("shows live active agents even when history has not loaded them yet", () => {
    const result = mergeSidebarSessionSources({
      liveAgents: [makeAgent({ id: "live-agent" })],
      historyAgents: [],
      selectedAgentId: "live-agent",
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["live-agent"]);
    expect(result.selectedAgentId).toBe("live-agent");
  });

  it("dedupes history entries behind the live directory copy", () => {
    const liveAgent = makeAgent({ id: "agent-1", status: "running" });
    const historyAgent = makeAgent({ id: "agent-1", status: "closed" });

    const result = mergeSidebarSessionSources({
      liveAgents: [liveAgent],
      historyAgents: [historyAgent, makeAgent({ id: "agent-2" })],
      selectedAgentId: "agent-1",
    });

    expect(result.agents).toEqual([liveAgent, makeAgent({ id: "agent-2" })]);
  });

  it("drops stale selectedAgentId when it is absent from the merged list", () => {
    const result = mergeSidebarSessionSources({
      liveAgents: [makeAgent({ id: "agent-1" })],
      historyAgents: [],
      selectedAgentId: "missing-agent",
    });

    expect(result.selectedAgentId).toBeUndefined();
  });

  it("suppresses stale history copies of archived or pending archive agents", () => {
    const result = mergeSidebarSessionSources({
      liveAgents: [makeAgent({ id: "agent-1" })],
      historyAgents: [
        makeAgent({ id: "agent-archived", title: "Stale archived history" }),
        makeAgent({ id: "agent-pending", title: "Stale pending history" }),
        makeAgent({ id: "agent-2" }),
      ],
      suppressedAgentIds: new Set(["agent-archived", "agent-pending"]),
      selectedAgentId: "agent-archived",
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["agent-1", "agent-2"]);
    expect(result.selectedAgentId).toBeUndefined();
  });
});
