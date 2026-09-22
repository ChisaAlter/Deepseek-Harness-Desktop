import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractActiveTargetFromLegacyLayout } from "@/stores/workspace-layout-actions";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

const SERVER_ID = "server-1";
const WORKSPACE_ID = "/repo/worktree";
const WORKSPACE_KEY = "server-1:/repo/worktree";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    activeTargetByWorkspace: {},
    pinnedAgentIdsByWorkspace: {},
  });
});

describe("buildWorkspaceTabPersistenceKey", () => {
  it("builds the composite key from server and workspace ids", () => {
    expect(
      buildWorkspaceTabPersistenceKey({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID }),
    ).toBe(WORKSPACE_KEY);
  });

  it("returns null when either id is empty", () => {
    expect(buildWorkspaceTabPersistenceKey({ serverId: "", workspaceId: WORKSPACE_ID })).toBeNull();
    expect(buildWorkspaceTabPersistenceKey({ serverId: SERVER_ID, workspaceId: "  " })).toBeNull();
  });
});

describe("workspace-layout-store openTarget", () => {
  it("sets the active content target for a workspace", () => {
    const target: WorkspaceTabTarget = { kind: "agent", agentId: "agent-1" };
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, target);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace[WORKSPACE_KEY]).toEqual(
      target,
    );
  });

  it("normalizes the target before storing", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: " agent-1 ",
    } as WorkspaceTabTarget);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace[WORKSPACE_KEY]).toEqual({
      kind: "agent",
      agentId: "agent-1",
    });
  });

  it("keeps the existing target when opening the same agent again", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });
    const stateBefore = useWorkspaceLayoutStore.getState().activeTargetByWorkspace;
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toBe(stateBefore);
  });

  it("replaces the current content when opening a different target", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "terminal",
      terminalId: "term-1",
    });

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace[WORKSPACE_KEY]).toEqual({
      kind: "terminal",
      terminalId: "term-1",
    });
  });

  it("ignores empty workspace keys and invalid targets", () => {
    useWorkspaceLayoutStore.getState().openTarget("", { kind: "agent", agentId: "agent-1" });
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "",
    } as WorkspaceTabTarget);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toEqual({});
  });
});

describe("workspace-layout-store convertDraftToAgent", () => {
  it("converts the active draft target into a live agent", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "draft",
      draftId: "draft-1",
    });
    useWorkspaceLayoutStore.getState().convertDraftToAgent(WORKSPACE_KEY, "agent-1");

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace[WORKSPACE_KEY]).toEqual({
      kind: "agent",
      agentId: "agent-1",
    });
  });

  it("does nothing when the active target is not a draft", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });
    useWorkspaceLayoutStore.getState().convertDraftToAgent(WORKSPACE_KEY, "agent-2");

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace[WORKSPACE_KEY]).toEqual({
      kind: "agent",
      agentId: "agent-1",
    });
  });

  it("does nothing when there is no active target", () => {
    useWorkspaceLayoutStore.getState().convertDraftToAgent(WORKSPACE_KEY, "agent-1");

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toEqual({});
  });
});

describe("workspace-layout-store clearTarget", () => {
  it("removes the active target, returning the workspace to the empty state", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });
    useWorkspaceLayoutStore.getState().clearTarget(WORKSPACE_KEY);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toEqual({});
  });

  it("is a no-op when the workspace has no active target", () => {
    const stateBefore = useWorkspaceLayoutStore.getState().activeTargetByWorkspace;
    useWorkspaceLayoutStore.getState().clearTarget(WORKSPACE_KEY);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toBe(stateBefore);
  });
});

describe("workspace-layout-store agent pins", () => {
  it("pins and unpins agents per workspace", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.pinAgent(WORKSPACE_KEY, "agent-1");
    store.pinAgent(WORKSPACE_KEY, "agent-2");

    expect(
      Array.from(useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace[WORKSPACE_KEY] ?? []),
    ).toEqual(["agent-1", "agent-2"]);

    useWorkspaceLayoutStore.getState().unpinAgent(WORKSPACE_KEY, "agent-1");
    expect(
      Array.from(useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace[WORKSPACE_KEY] ?? []),
    ).toEqual(["agent-2"]);
  });

  it("removes the workspace bucket when the last pin is removed", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.pinAgent(WORKSPACE_KEY, "agent-1");
    useWorkspaceLayoutStore.getState().unpinAgent(WORKSPACE_KEY, "agent-1");

    expect(useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace).toEqual({});
  });

  it("unpins an agent from every workspace at once", () => {
    useWorkspaceLayoutStore.getState().pinAgent("server-1:ws-a", "agent-1");
    useWorkspaceLayoutStore.getState().pinAgent("server-1:ws-b", "agent-1");
    useWorkspaceLayoutStore.getState().pinAgent("server-1:ws-b", "agent-2");

    useWorkspaceLayoutStore.getState().unpinAgentEverywhere("agent-1");

    const state = useWorkspaceLayoutStore.getState();
    expect(state.pinnedAgentIdsByWorkspace["server-1:ws-a"]).toBeUndefined();
    expect(Array.from(state.pinnedAgentIdsByWorkspace["server-1:ws-b"] ?? [])).toEqual(["agent-2"]);
  });
});

describe("workspace-layout-store purgeWorkspace", () => {
  it("removes all workspace state including pins", () => {
    useWorkspaceLayoutStore.getState().openTarget(WORKSPACE_KEY, {
      kind: "agent",
      agentId: "agent-1",
    });
    useWorkspaceLayoutStore.getState().pinAgent(WORKSPACE_KEY, "agent-1");

    useWorkspaceLayoutStore.getState().purgeWorkspace(WORKSPACE_KEY);

    const state = useWorkspaceLayoutStore.getState();
    expect(state.activeTargetByWorkspace).toEqual({});
    expect(state.pinnedAgentIdsByWorkspace).toEqual({});
  });

  it("is a no-op when the workspace has no state", () => {
    useWorkspaceLayoutStore.getState().openTarget("server-1:ws-other", {
      kind: "agent",
      agentId: "agent-1",
    });
    const stateBefore = useWorkspaceLayoutStore.getState().activeTargetByWorkspace;

    useWorkspaceLayoutStore.getState().purgeWorkspace(WORKSPACE_KEY);

    expect(useWorkspaceLayoutStore.getState().activeTargetByWorkspace).toBe(stateBefore);
  });
});

describe("extractActiveTargetFromLegacyLayout", () => {
  it("extracts the focused tab target from a legacy single-pane layout", () => {
    const layout = {
      root: {
        kind: "pane",
        pane: {
          id: "main",
          focusedTabId: "agent_agent-2",
          tabs: [
            { tabId: "agent_agent-1", target: { kind: "agent", agentId: "agent-1" }, createdAt: 1 },
            { tabId: "agent_agent-2", target: { kind: "agent", agentId: "agent-2" }, createdAt: 1 },
          ],
        },
      },
      focusedPaneId: "main",
    };

    expect(extractActiveTargetFromLegacyLayout(layout)).toEqual({
      kind: "agent",
      agentId: "agent-2",
    });
  });

  it("prefers the focused pane across a legacy split tree", () => {
    const layout = {
      root: {
        kind: "group",
        group: {
          id: "group-root",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: {
                id: "left",
                focusedTabId: null,
                tabs: [
                  {
                    tabId: "agent_agent-left",
                    target: { kind: "agent", agentId: "agent-left" },
                    createdAt: 1,
                  },
                ],
              },
            },
            {
              kind: "pane",
              pane: {
                id: "right",
                focusedTabId: "terminal_term-1",
                tabs: [
                  {
                    tabId: "terminal_term-1",
                    target: { kind: "terminal", terminalId: "term-1" },
                    createdAt: 1,
                  },
                ],
              },
            },
          ],
        },
      },
      focusedPaneId: "right",
    };

    expect(extractActiveTargetFromLegacyLayout(layout)).toEqual({
      kind: "terminal",
      terminalId: "term-1",
    });
  });

  it("returns null for an empty legacy layout", () => {
    expect(extractActiveTargetFromLegacyLayout(null)).toBeNull();
    expect(extractActiveTargetFromLegacyLayout({})).toBeNull();
    expect(
      extractActiveTargetFromLegacyLayout({
        root: {
          kind: "pane",
          pane: { id: "main", tabs: [], tabIds: [], focusedTabId: null },
        },
        focusedPaneId: "main",
      }),
    ).toBeNull();
  });
});
