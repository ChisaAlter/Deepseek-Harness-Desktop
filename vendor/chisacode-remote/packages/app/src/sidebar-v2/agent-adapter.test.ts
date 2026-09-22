import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  agentToSidebarThread,
  buildWorkspaceDirectoryIndex,
  findWorkspaceForAgent,
  isAgentInMotion,
  type SidebarV2WorkspaceHint,
} from "./agent-adapter";

function agent(input: Partial<AggregatedAgent> & { id: string }): AggregatedAgent {
  return {
    id: input.id,
    serverId: input.serverId ?? "server-1",
    serverLabel: input.serverLabel ?? "Local",
    title: input.title ?? null,
    status: input.status ?? "idle",
    lastActivityAt: input.lastActivityAt ?? new Date("2026-04-08T10:00:00.000Z"),
    cwd: input.cwd ?? "C:\\repo",
    provider: input.provider ?? "codex",
    pendingPermissionCount: input.pendingPermissionCount ?? 0,
    requiresAttention: input.requiresAttention ?? false,
    attentionReason: input.attentionReason ?? null,
    attentionTimestamp: input.attentionTimestamp ?? null,
    archivedAt: input.archivedAt ?? null,
    createdAt: input.createdAt ?? new Date("2026-04-01T00:00:00.000Z"),
    labels: input.labels ?? {},
    projectPlacement: input.projectPlacement ?? null,
  };
}

describe("agentToSidebarThread", () => {
  it("maps agent identity and timestamps", () => {
    const thread = agentToSidebarThread(agent({ id: "a1", title: "Fix sidebar" }));
    expect(thread.id).toBe("a1");
    expect(thread.title).toBe("Fix sidebar");
    expect(thread.createdAt).toBe("2026-04-01T00:00:00.000Z");
    expect(thread.status).toBe("idle");
    expect(thread.requiresFinishedAttention).toBe(false);
    expect(thread.cwd).toBe("C:\\repo");
  });

  it("derives project key and name from placement", () => {
    const thread = agentToSidebarThread(
      agent({
        id: "a1",
        projectPlacement: {
          projectKey: "remote:github.com/acme/app",
          projectName: "acme/app",
          checkout: {
            cwd: "C:\\repo",
            isGit: true,
            currentBranch: "feature/x",
            remoteUrl: "git@github.com:acme/app.git",
            worktreeRoot: "C:\\Users\\me\\.chisacode\\worktrees\\abc123\\brave-owl",
            isChisaCodeOwnedWorktree: true,
            mainRepoRoot: "C:\\repo",
          },
        },
      }),
    );
    expect(thread.projectKey).toBe("remote:github.com/acme/app");
    expect(thread.projectName).toBe("acme/app");
    expect(thread.branch).toBe("feature/x");
    expect(thread.worktreePath).toBe("C:\\Users\\me\\.chisacode\\worktrees\\abc123\\brave-owl");
  });

  it("maps approval/input signals", () => {
    const approval = agentToSidebarThread(agent({ id: "a", pendingPermissionCount: 2 }));
    expect(approval.hasPendingApprovals).toBe(true);

    const input = agentToSidebarThread(
      agent({ id: "b", requiresAttention: true, attentionReason: "permission" }),
    );
    expect(input.hasPendingUserInput).toBe(true);
  });

  it("reads snooze/settled labels", () => {
    const thread = agentToSidebarThread(
      agent({
        id: "a",
        labels: {
          "chisacode.sidebarSnoozedUntil": "2026-04-08T18:00:00.000Z",
          "chisacode.sidebarSettledAt": "2026-04-01T00:00:00.000Z",
          "chisacode.sidebarSettledOverride": "settled",
        },
      }),
    );
    expect(thread.snoozedUntil).toBe("2026-04-08T18:00:00.000Z");
    expect(thread.settledAt).toBe("2026-04-01T00:00:00.000Z");
    expect(thread.settledOverride).toBe("settled");
  });

  it("reads PR state from the workspace hint", () => {
    const thread = agentToSidebarThread(agent({ id: "a" }), {
      githubRuntime: { pullRequest: { state: "merged" } },
    });
    expect(thread.changeRequestState).toBe("merged");
  });
});

describe("buildWorkspaceDirectoryIndex / findWorkspaceForAgent", () => {
  it("indexes by normalized directory", () => {
    const index = buildWorkspaceDirectoryIndex<SidebarV2WorkspaceHint>([
      { workspaceDirectory: "C:\\repo\\sub", projectId: "p1" },
    ]);
    expect(findWorkspaceForAgent(agent({ id: "a", cwd: "C:/repo/sub" }), index)?.projectId).toBe(
      "p1",
    );
    expect(findWorkspaceForAgent(agent({ id: "b", cwd: "C:\\other" }), index)).toBeNull();
  });
});

describe("isAgentInMotion", () => {
  it("treats running and initializing as in motion", () => {
    expect(isAgentInMotion("running")).toBe(true);
    expect(isAgentInMotion("initializing")).toBe(true);
    expect(isAgentInMotion("idle")).toBe(false);
    expect(isAgentInMotion("closed")).toBe(false);
  });
});

describe("agentToSidebarThread worktree projectKey fallback", () => {
  const WORKTREE_CWD = "C:/Users/48818/.chisacode/worktrees/2uy72tsn/red-dolphin";
  const hints = new Map([
    ["2uy72tsn", { projectKey: "remote:github.com/ChisaAlter/pi-agent-desktop" }],
  ]);

  it("resolves a stripped-home placement to the real project via cwd hash", () => {
    const thread = agentToSidebarThread(
      agent({
        id: "a",
        cwd: WORKTREE_CWD,
        projectPlacement: {
          projectKey: "C:/Users/48818", // deriveProjectKey stripped the home-dir worktree
          projectName: "48818",
          checkout: {
            cwd: WORKTREE_CWD,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isChisaCodeOwnedWorktree: false,
            mainRepoRoot: null,
          },
        },
      }),
      null,
      undefined,
      hints,
    );
    expect(thread.projectKey).toBe("remote:github.com/ChisaAlter/pi-agent-desktop");
  });

  it("keeps a correct remote placement unchanged", () => {
    const thread = agentToSidebarThread(
      agent({
        id: "a",
        cwd: WORKTREE_CWD,
        projectPlacement: {
          projectKey: "remote:github.com/ChisaAlter/pi-agent-desktop",
          projectName: "ChisaAlter/pi-agent-desktop",
          checkout: {
            cwd: WORKTREE_CWD,
            isGit: true,
            currentBranch: "red-dolphin",
            remoteUrl: null,
            worktreeRoot: WORKTREE_CWD,
            isChisaCodeOwnedWorktree: true,
            mainRepoRoot: "C:/Ai/pi-desktop",
          },
        },
      }),
      null,
      undefined,
      hints,
    );
    expect(thread.projectKey).toBe("remote:github.com/ChisaAlter/pi-agent-desktop");
  });

  it("falls back to placement key when no hint exists for the hash", () => {
    const thread = agentToSidebarThread(
      agent({
        id: "a",
        cwd: WORKTREE_CWD,
        projectPlacement: {
          projectKey: "C:/Users/48818",
          projectName: "48818",
          checkout: {
            cwd: WORKTREE_CWD,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isChisaCodeOwnedWorktree: false,
            mainRepoRoot: null,
          },
        },
      }),
      null,
      undefined,
      new Map(),
    );
    expect(thread.projectKey).toBe("C:/Users/48818");
  });
});
