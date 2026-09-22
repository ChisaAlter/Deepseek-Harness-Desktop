import { describe, expect, it } from "vitest";
import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  applyStableSidebarSessionOrder,
  buildWorktreeProjectHintsFromSources,
  buildWorkspaceDirectoryProjectHintsFromSources,
  extractManagedWorktreeParts,
  getAgentCwdGroupLabel,
  groupAgentsForSidebar,
  normalizeAgentCwdGroupKey,
  reconcileSidebarSessionOrder,
  sortAgentsForSidebarV2,
} from "@/utils/sidebar-session-groups";

function agent(input: {
  id: string;
  cwd: string | null;
  updatedAt: string;
  createdAt?: string;
  pinned?: boolean;
  projectPlacement?: ProjectPlacementPayload | null;
}): AggregatedAgent {
  const createdAt = input.createdAt ?? input.updatedAt;
  return {
    id: input.id,
    serverId: "server-1",
    serverLabel: "Local",
    title: input.id,
    status: "closed",
    lastActivityAt: new Date(input.updatedAt),
    cwd: input.cwd ?? "",
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date(createdAt),
    labels: input.pinned ? { "chisacode.sidebarPinned": "true" } : {},
    projectPlacement: input.projectPlacement ?? null,
  };
}

describe("sidebar session groups", () => {
  it("derives compact labels from Windows and POSIX paths", () => {
    expect(getAgentCwdGroupLabel("C:\\ai\\yuanhangxing")).toBe("yuanhangxing");
    expect(getAgentCwdGroupLabel("/Users/me/project")).toBe("project");
    expect(getAgentCwdGroupLabel("/Users/me/project/")).toBe("project");
  });

  it("falls back for missing cwd", () => {
    expect(getAgentCwdGroupLabel("", "未知工作区")).toBe("未知工作区");
    expect(normalizeAgentCwdGroupKey(null)).toBe("__unknown__");
  });

  it("normalizes separators, trailing slashes, and casing for stable group keys", () => {
    expect(normalizeAgentCwdGroupKey("C:\\AI\\yuanhangxing\\")).toBe("c:/ai/yuanhangxing");
    expect(normalizeAgentCwdGroupKey("c:/ai/yuanhangxing")).toBe("c:/ai/yuanhangxing");
  });

  it("sorts groups and group agents by newest createdAt (T3 Sidebar V2)", () => {
    const groups = groupAgentsForSidebar([
      agent({
        id: "old-a",
        cwd: "C:\\ai\\a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      }),
      agent({
        id: "new-b",
        cwd: "C:\\ai\\b",
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
      agent({
        id: "new-a",
        cwd: "C:\\ai\\a",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);

    // Group a has newest createdAt via new-a (01-02) vs b (01-03) → b first.
    // Within a, new-a (created later) is above old-a even though old-a has newer activity.
    expect(groups.map((group) => group.label)).toEqual(["b", "a"]);
    expect(groups[1]?.agents.map((entry) => entry.id)).toEqual(["new-a", "old-a"]);
  });

  it("does not reorder agents when activity changes (T3 static creation order)", () => {
    const agents = [
      agent({
        id: "first",
        cwd: "C:\\ai\\a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-10T00:00:00.000Z",
      }),
      agent({
        id: "second",
        cwd: "C:\\ai\\a",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    expect(sortAgentsForSidebarV2(agents).map((entry) => entry.id)).toEqual(["second", "first"]);
  });

  it("labels ChisaCode-owned worktree groups with the project root directory", () => {
    const groups = groupAgentsForSidebar([
      agent({
        id: "owned-worktree",
        cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
        updatedAt: "2026-01-03T00:00:00.000Z",
        projectPlacement: {
          projectKey: "C:\\Users\\48818\\Documents\\CodeBuddyGUI",
          projectName: "ChisaAlter/codebuddy-gui",
          checkout: {
            cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
            isGit: true,
            currentBranch: "codex/gallant-owl",
            remoteUrl: null,
            worktreeRoot: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
            isChisaCodeOwnedWorktree: true,
            mainRepoRoot: "C:\\Users\\48818\\Documents\\CodeBuddyGUI",
          },
        },
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["codebuddy-gui"]);
    expect(groups[0]?.key).toBe("c:/users/48818/documents/codebuddygui");
  });

  it("groups a brand-new managed worktree under the parent project via hash hints", () => {
    const parent = agent({
      id: "parent-session",
      cwd: "C:\\Ai\\ChisaTerminal",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      projectPlacement: {
        projectKey: "C:\\Ai\\ChisaTerminal",
        projectName: "ChisaTerminal",
        checkout: {
          cwd: "C:\\Ai\\ChisaTerminal",
          isGit: true,
          currentBranch: "main",
          remoteUrl: null,
          // Non-ChisaCode git checkout: worktreeRoot is the repo root path (string).
          worktreeRoot: "C:\\Ai\\ChisaTerminal",
          isChisaCodeOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });
    const sibling = agent({
      id: "sibling-worktree",
      cwd: "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\older-slug",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      projectPlacement: {
        projectKey: "C:\\Ai\\ChisaTerminal",
        projectName: "ChisaTerminal",
        checkout: {
          cwd: "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\older-slug",
          isGit: true,
          currentBranch: "feature",
          remoteUrl: null,
          worktreeRoot: "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\older-slug",
          isChisaCodeOwnedWorktree: true,
          mainRepoRoot: "C:\\Ai\\ChisaTerminal",
        },
      },
    });
    const brandNew = agent({
      id: "brand-new",
      cwd: "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\naive-seahorse",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    const groups = groupAgentsForSidebar([parent, sibling, brandNew]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("ChisaTerminal");
    expect(groups[0]?.agents.map((entry) => entry.id)).toEqual([
      "brand-new",
      "sibling-worktree",
      "parent-session",
    ]);
  });

  it("uses workspace directory hints so a new worktree never becomes its own project", () => {
    const hints = buildWorkspaceDirectoryProjectHintsFromSources([
      {
        workspaceDirectory:
          "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\naive-seahorse",
        projectRootPath: "C:\\Ai\\ChisaTerminal",
        projectId: "C:\\Ai\\ChisaTerminal",
        projectDisplayName: "ChisaTerminal",
      },
    ]);
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "brand-new",
          cwd: "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\naive-seahorse",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        }),
        agent({
          id: "main",
          cwd: "C:\\Ai\\ChisaTerminal",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      { workspaceDirectoryHints: hints },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("ChisaTerminal");
    expect(groups[0]?.agents.map((entry) => entry.id)).toEqual(["brand-new", "main"]);
  });

  it("extracts managed worktree hash/slug from home and nested paths", () => {
    expect(
      extractManagedWorktreeParts(
        "C:\\Users\\48818\\.chisacode-chisacode\\worktrees\\2zwm1skb\\naive-seahorse",
      ),
    ).toEqual({ hash: "2zwm1skb", slug: "naive-seahorse" });
    expect(extractManagedWorktreeParts("/repo/.chisacode/worktrees/abc123/cool-slug")).toEqual({
      hash: "abc123",
      slug: "cool-slug",
    });
  });

  it("builds hash hints from workspace sources", () => {
    const hints = buildWorktreeProjectHintsFromSources([
      {
        workspaceDirectory: "C:\\Users\\48818\\.chisacode\\worktrees\\2zwm1skb\\older",
        projectRootPath: "C:\\Ai\\ChisaTerminal",
        projectDisplayName: "ChisaTerminal",
        projectId: "C:\\Ai\\ChisaTerminal",
      },
    ]);
    expect(hints.get("2zwm1skb")?.label).toBe("ChisaTerminal");
  });

  it("extracts pinned sessions into a global top group", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({ id: "new-a", cwd: "C:\\ai\\a", updatedAt: "2026-01-03T00:00:00.000Z" }),
        agent({
          id: "pinned-b",
          cwd: "C:\\ai\\b",
          updatedAt: "2026-01-01T00:00:00.000Z",
          pinned: true,
        }),
        agent({
          id: "pinned-a",
          cwd: "C:\\ai\\a",
          updatedAt: "2026-01-02T00:00:00.000Z",
          pinned: true,
        }),
      ],
      {
        pinnedGroupLabel: "置顶",
        isPinnedAgent: (entry) => entry.labels["chisacode.sidebarPinned"] === "true",
      },
    );

    expect(groups.map((group) => group.label)).toEqual(["置顶", "a"]);
    expect(groups[0]?.agents.map((entry) => entry.id)).toEqual(["pinned-a", "pinned-b"]);
    expect(groups[1]?.agents.map((entry) => entry.id)).toEqual(["new-a"]);
  });

  it("keeps group and agent sorting stable with invalid creation timestamps", () => {
    const groups = groupAgentsForSidebar([
      agent({ id: "invalid-a", cwd: "C:\\ai\\a", updatedAt: "invalid-date" }),
      agent({ id: "valid-a", cwd: "C:\\ai\\a", updatedAt: "2026-01-02T00:00:00.000Z" }),
      agent({ id: "valid-b", cwd: "C:\\ai\\b", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["b", "a"]);
    expect(groups[1]?.agents.map((entry) => entry.id)).toEqual(["valid-a", "invalid-a"]);
  });

  it("keeps pinned agent sorting stable with invalid creation timestamps", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "pinned-invalid",
          cwd: "C:\\ai\\a",
          updatedAt: "invalid-date",
          pinned: true,
        }),
        agent({
          id: "pinned-valid",
          cwd: "C:\\ai\\a",
          updatedAt: "2026-01-02T00:00:00.000Z",
          pinned: true,
        }),
      ],
      {
        isPinnedAgent: (entry) => entry.labels["chisacode.sidebarPinned"] === "true",
      },
    );

    expect(groups[0]?.agents.map((entry) => entry.id)).toEqual(["pinned-valid", "pinned-invalid"]);
  });

  it("keeps stored group and session order when activity timestamps change", () => {
    const groups = groupAgentsForSidebar([
      agent({ id: "new-a", cwd: "C:\\ai\\a", updatedAt: "2026-01-04T00:00:00.000Z" }),
      agent({ id: "old-a", cwd: "C:\\ai\\a", updatedAt: "2026-01-01T00:00:00.000Z" }),
      agent({ id: "new-b", cwd: "C:\\ai\\b", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ]);

    const ordered = applyStableSidebarSessionOrder(groups, {
      groupOrder: ["c:/ai/a", "c:/ai/b"],
      agentOrderByGroup: {
        "c:/ai/a": ["old-a", "new-a"],
      },
    });

    expect(ordered.map((group) => group.label)).toEqual(["a", "b"]);
    expect(ordered[0]?.agents.map((entry) => entry.id)).toEqual(["old-a", "new-a"]);
  });

  it("moves pinned project groups ahead of other projects without displacing pinned sessions", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "pinned-session",
          cwd: "C:\\ai\\pinned-session-project",
          updatedAt: "2026-01-01T00:00:00.000Z",
          pinned: true,
        }),
        agent({ id: "project-a", cwd: "C:\\ai\\a", updatedAt: "2026-01-03T00:00:00.000Z" }),
        agent({ id: "project-b", cwd: "C:\\ai\\b", updatedAt: "2026-01-02T00:00:00.000Z" }),
      ],
      { isPinnedAgent: (entry) => entry.labels["chisacode.sidebarPinned"] === "true" },
    );

    const ordered = applyStableSidebarSessionOrder(groups, {
      groupOrder: ["c:/ai/a", "c:/ai/b"],
      agentOrderByGroup: {},
      pinnedGroupKeys: new Set(["c:/ai/b"]),
    });

    expect(ordered.map((group) => group.key)).toEqual(["__pinned__", "c:/ai/b", "c:/ai/a"]);
  });

  it("removes stale keys and prepends newly discovered sessions (T3 newest-on-top)", () => {
    expect(
      reconcileSidebarSessionOrder(
        ["session-b", "stale", "session-a"],
        ["session-a", "session-b", "session-c"],
      ),
    ).toEqual(["session-c", "session-b", "session-a"]);
  });
});
