import { describe, expect, it, vi } from "vitest";
import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import type { Agent } from "@/stores/session-store";
import { __private__ } from "./use-aggregated-agents";

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getSnapshot: vi.fn(),
    getVersion: vi.fn(() => 0),
    refreshAllAgentDirectories: vi.fn(),
    subscribeAll: vi.fn(() => () => undefined),
  }),
  useHosts: () => [],
}));

const BASE_TIME = new Date("2026-03-08T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: "server-1",
  id: "agent-1",
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
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input?: Partial<Agent>): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

describe("buildAggregatedAgentsResult", () => {
  it("sorts running agents first and keeps invalid activity timestamps stable", () => {
    const result = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "ready" }],
      sessionAgents: {
        "server-1": new Map([
          [
            "invalid",
            makeAgent({
              id: "invalid",
              lastActivityAt: new Date(Number.NaN),
            }),
          ],
          [
            "recent",
            makeAgent({
              id: "recent",
              lastActivityAt: new Date("2026-03-08T12:00:00.000Z"),
            }),
          ],
          [
            "running",
            makeAgent({
              id: "running",
              status: "running",
              lastActivityAt: new Date("2026-03-08T09:00:00.000Z"),
            }),
          ],
        ]),
      },
      includeArchived: false,
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["running", "recent", "invalid"]);
  });

  it("filters archived agents by default and keeps host labels", () => {
    const result = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "ready" }],
      sessionAgents: {
        "server-1": new Map([
          ["visible", makeAgent({ id: "visible" })],
          [
            "archived",
            makeAgent({
              id: "archived",
              archivedAt: new Date("2026-03-08T11:00:00.000Z"),
            }),
          ],
        ]),
      },
      includeArchived: false,
    });

    expect(result.agents).toEqual([
      expect.objectContaining({
        id: "visible",
        serverLabel: "Local",
      }),
    ]);
  });

  it("preserves project placement from live session agents", () => {
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

    const result = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "ready" }],
      sessionAgents: {
        "server-1": new Map([
          [
            "owned-worktree",
            makeAgent({
              id: "owned-worktree",
              cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
              projectPlacement,
            }),
          ],
        ]),
      },
      includeArchived: false,
    });

    expect(result.agents[0]?.projectPlacement).toEqual(projectPlacement);
  });

  it("derives initial loading and revalidating states from host directory status", () => {
    const initial = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "initial_loading" }],
      sessionAgents: {},
      includeArchived: false,
    });
    const revalidating = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "revalidating" }],
      sessionAgents: {
        "server-1": new Map([["visible", makeAgent({ id: "visible" })]]),
      },
      includeArchived: false,
    });
    const errorAfterReady = __private__.buildAggregatedAgentsResult({
      hosts: [{ serverId: "server-1", label: "Local", agentDirectoryStatus: "error_after_ready" }],
      sessionAgents: {
        "server-1": new Map([["visible", makeAgent({ id: "visible" })]]),
      },
      includeArchived: false,
    });

    expect(initial).toMatchObject({
      isLoading: true,
      isInitialLoad: true,
      isRevalidating: false,
    });
    expect(revalidating).toMatchObject({
      isLoading: true,
      isInitialLoad: false,
      isRevalidating: true,
    });
    expect(errorAfterReady).toMatchObject({
      isLoading: false,
      isInitialLoad: false,
      isRevalidating: false,
    });
  });
});
