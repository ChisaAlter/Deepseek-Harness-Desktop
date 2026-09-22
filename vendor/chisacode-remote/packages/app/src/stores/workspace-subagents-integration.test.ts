import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { selectSubagentsForParent } from "@/subagents";
import { useSessionStore, type Agent } from "./session-store";

const SERVER_ID = "server-1";
const WORKSPACE_DIRECTORY = "/repo/worktree";

const AGENT_TIMESTAMP = new Date("2026-04-21T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
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
  title: "Agent",
  cwd: WORKSPACE_DIRECTORY,
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function initializeAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

function appendAgent(agent: Agent): void {
  useSessionStore.getState().setAgents(SERVER_ID, (agents) => {
    const nextAgents = new Map(agents);
    nextAgents.set(agent.id, agent);
    return nextAgents;
  });
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("workspace subagents integration", () => {
  it("exposes a child ingested before its parent in the parent section", () => {
    const child = makeAgent({
      id: "child-agent",
      parentAgentId: "parent-agent",
      title: "Child agent",
    });
    const parent = makeAgent({
      id: "parent-agent",
      title: "Parent agent",
    });

    initializeAgents([child]);
    appendAgent(parent);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-agent",
        },
        new Set(),
      ).map((row) => row.id),
    ).toEqual(["child-agent"]);
  });
});
