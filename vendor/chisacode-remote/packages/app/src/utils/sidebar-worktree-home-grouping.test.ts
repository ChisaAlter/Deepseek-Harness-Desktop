import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { deriveProjectKey } from "./agent-grouping";
import {
  buildWorktreeProjectHintsFromSources,
  buildWorkspaceDirectoryProjectHintsFromSources,
  groupAgentsForSidebar,
  type SidebarWorktreeProjectHintSource,
} from "./sidebar-session-groups";

const WORKTREE_CWD_SLASH = "C:/Users/48818/.chisacode/worktrees/2uy72tsn/red-dolphin";
const WORKTREE_CWD_BACKSLASH = "C:\\Users\\48818\\.chisacode\\worktrees\\2uy72tsn\\red-dolphin";
const MAIN_REPO = "C:\\Ai\\pi-desktop";
const REMOTE_KEY = "remote:github.com/ChisaAlter/pi-agent-desktop";

function agent(input: {
  id: string;
  cwd: string;
  placement: {
    projectKey: string;
    checkout: {
      isChisaCodeOwnedWorktree?: boolean;
      mainRepoRoot?: string | null;
    };
  } | null;
}) {
  return {
    id: input.id,
    serverId: "srv",
    serverLabel: "local",
    title: "t",
    status: "idle" as const,
    lastActivityAt: new Date(),
    cwd: input.cwd,
    provider: "grokbuild" as const,
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date(),
    labels: {},
    projectPlacement: input.placement
      ? {
          projectKey: input.placement.projectKey,
          projectName: "pi-agent-desktop",
          checkout: {
            cwd: input.cwd,
            isGit: true,
            currentBranch: "red-dolphin",
            remoteUrl: "git@github.com:ChisaAlter/pi-agent-desktop.git",
            worktreeRoot: WORKTREE_CWD_BACKSLASH,
            isChisaCodeOwnedWorktree: input.placement.checkout.isChisaCodeOwnedWorktree ?? false,
            mainRepoRoot: input.placement.checkout.mainRepoRoot ?? null,
          },
        }
      : null,
  } as AggregatedAgent;
}

const worktreeWorkspaceSource: SidebarWorktreeProjectHintSource = {
  workspaceDirectory: WORKTREE_CWD_BACKSLASH,
  projectRootPath: MAIN_REPO,
  project: {
    projectKey: REMOTE_KEY,
    projectName: "ChisaAlter/pi-agent-desktop",
    checkout: {
      isChisaCodeOwnedWorktree: true,
      mainRepoRoot: MAIN_REPO,
    },
  },
};

describe("worktree grouping repro", () => {
  it("hints: worktree workspace resolves to main repo", () => {
    const hints = buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]);
    const dirHints = buildWorkspaceDirectoryProjectHintsFromSources([worktreeWorkspaceSource]);
    const hash = hints.get("2uy72tsn");
    expect(hash?.key).toBe("remote:github.com/chisaalter/pi-agent-desktop");
    expect(dirHints.get("c:/users/48818/.chisacode/worktrees/2uy72tsn/red-dolphin")?.key).toBe(
      "remote:github.com/chisaalter/pi-agent-desktop",
    );
  });

  it("real agent with correct placement groups under main repo", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "real",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: REMOTE_KEY,
            checkout: { isChisaCodeOwnedWorktree: true, mainRepoRoot: MAIN_REPO },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    expect(groups.map((g) => g.key)).toEqual(["remote:github.com/chisaalter/pi-agent-desktop"]);
  });

  it("agent with cwd-derived placement no longer groups under 48818 (fixed)", () => {
    // deriveProjectKey now refuses to strip CHISACODE_HOME's worktree root
    // into the home directory; the placement carries the raw worktree path,
    // and the grouping layer resolves it through the worktree-hash index.
    const projectKey = deriveProjectKey(WORKTREE_CWD_SLASH, "C:/Users/48818");
    expect(projectKey).toBe(WORKTREE_CWD_SLASH);
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "real",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey,
            checkout: { isChisaCodeOwnedWorktree: false, mainRepoRoot: null },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    expect(groups.map((g) => g.key)).toEqual(["remote:github.com/chisaalter/pi-agent-desktop"]);
  });

  it("project-internal worktree still strips to the project root", () => {
    const internal = "C:/Ai/pi-desktop/.chisacode/worktrees/abc123/red-dolphin";
    expect(deriveProjectKey(internal, "C:/Users/48818")).toBe("C:/Ai/pi-desktop");
  });

  it("home-dir stale placement no longer duplicates into a second group (fixed)", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "real",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: REMOTE_KEY,
            checkout: { isChisaCodeOwnedWorktree: true, mainRepoRoot: MAIN_REPO },
          },
        }),
        agent({
          id: "stale",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: "C:/Users/48818", // legacy deriveProjectKey result
            checkout: { isChisaCodeOwnedWorktree: false, mainRepoRoot: null },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    const keys = groups.map((g) => g.key).sort();
    expect(keys).toEqual(["remote:github.com/chisaalter/pi-agent-desktop"]);
  });

  it("home-dir placement with worktree cwd resolves via cwd hash (renderer env fallback)", () => {
    // Sandboxed Electron renderers may lack process.env.USERPROFILE, so
    // deriveProjectKey cannot refuse to strip the CHISACODE_HOME worktree root;
    // the placement projectKey is the stripped home dir. The grouping layer
    // must still resolve via the agent cwd's own worktree hash.
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "stale",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: "C:/Users/48818", // deriveProjectKey without home detection
            checkout: { isChisaCodeOwnedWorktree: false, mainRepoRoot: null },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    expect(groups.map((g) => g.key)).toEqual(["remote:github.com/chisaalter/pi-agent-desktop"]);
  });
});

describe("group cwd is a real path for the new-conversation action", () => {
  it("worktree group keeps a real mainRepoRoot cwd while keying by remote", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "real",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: REMOTE_KEY,
            checkout: { isChisaCodeOwnedWorktree: true, mainRepoRoot: MAIN_REPO },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    expect(groups[0]?.key).toBe("remote:github.com/chisaalter/pi-agent-desktop");
    expect(groups[0]?.cwd).toBe("C:\\Ai\\pi-desktop");
  });

  it("cwd-derived stale placement group cwd resolves to the main repo root", () => {
    const groups = groupAgentsForSidebar(
      [
        agent({
          id: "stale",
          cwd: WORKTREE_CWD_SLASH,
          placement: {
            projectKey: "C:/Users/48818", // stripped home dir
            checkout: { isChisaCodeOwnedWorktree: false, mainRepoRoot: null },
          },
        }),
      ],
      { worktreeProjectHints: buildWorktreeProjectHintsFromSources([worktreeWorkspaceSource]) },
    );
    expect(groups[0]?.key).toBe("remote:github.com/chisaalter/pi-agent-desktop");
    // Hint identity carries the main repo root as the working directory.
    expect(groups[0]?.cwd).toBe("C:\\Ai\\pi-desktop");
  });
});
