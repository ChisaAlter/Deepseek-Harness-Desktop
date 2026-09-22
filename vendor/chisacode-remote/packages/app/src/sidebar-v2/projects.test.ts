import { describe, expect, it } from "vitest";
import {
  buildSidebarProjectSnapshots,
  getProjectSortTimestamp,
  shortProjectName,
  sortProjectsForSidebar,
  workspaceDescriptorToProjectMember,
  type SidebarV2ProjectMember,
} from "./projects";
import type { WorkspaceDescriptor } from "@/stores/session-store";

function makeMember(
  input: Partial<SidebarV2ProjectMember> & { workspaceId: string },
): SidebarV2ProjectMember {
  return {
    workspaceId: input.workspaceId,
    physicalProjectKey: input.physicalProjectKey ?? "remote:github.com/acme/app",
    projectName: input.projectName ?? "acme/app",
    workspaceDirectory: input.workspaceDirectory ?? `C:\\repos\\${input.workspaceId}`,
    branch: input.branch ?? null,
    kind: input.kind ?? "worktree",
    status: input.status ?? null,
    archivedAt: input.archivedAt ?? null,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
    changeRequestState: input.changeRequestState ?? null,
  };
}

function workspace(input: Partial<WorkspaceDescriptor> & { id: string }): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "remote:github.com/acme/app",
    projectDisplayName: input.projectDisplayName ?? "acme/app",
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? `C:\\repos\\${input.id}`,
    workspaceDirectory: input.workspaceDirectory ?? `C:\\repos\\${input.id}`,
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? "feature-branch",
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
    gitRuntime: input.gitRuntime,
    githubRuntime: input.githubRuntime,
    project: input.project,
  };
}

describe("workspaceDescriptorToProjectMember", () => {
  it("maps a workspace to a project member", () => {
    const member = workspaceDescriptorToProjectMember(
      workspace({
        id: "w1",
        gitRuntime: {
          currentBranch: "feature/x",
          isGit: true,
        } as WorkspaceDescriptor["gitRuntime"],
      }),
    );
    expect(member.branch).toBe("feature/x");
    expect(member.physicalProjectKey).toBe("remote:github.com/acme/app");
    expect(member.kind).toBe("worktree");
  });

  it("reads PR state from github runtime", () => {
    const member = workspaceDescriptorToProjectMember(
      workspace({
        id: "w1",
        githubRuntime: {
          pullRequest: {
            url: "https://github.com/acme/app/pull/12",
            title: "Fix sidebar",
            state: "merged",
            baseRefName: "main",
            headRefName: "feature/x",
            isMerged: true,
          },
        } as WorkspaceDescriptor["githubRuntime"],
      }),
    );
    expect(member.changeRequestState).toBe("merged");
  });
});

describe("buildSidebarProjectSnapshots", () => {
  it("groups members by logical key, one winner per physical key", () => {
    const snapshots = buildSidebarProjectSnapshots({
      members: [
        makeMember({ workspaceId: "a", physicalProjectKey: "remote:github.com/acme/app" }),
        // Same physical key: the fresher winner represents the location.
        makeMember({
          workspaceId: "b",
          physicalProjectKey: "remote:github.com/acme/app",
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
        makeMember({ workspaceId: "c", physicalProjectKey: "remote:github.com/acme/other" }),
      ],
    });
    expect(snapshots.map((snapshot) => snapshot.projectKey).sort()).toEqual([
      "remote:github.com/acme/app",
      "remote:github.com/acme/other",
    ]);
    const app = snapshots.find((snapshot) => snapshot.projectKey.endsWith("/app"));
    expect(app?.members).toHaveLength(1);
    expect(app?.members[0]?.workspaceId).toBe("b");
  });

  it("merges distinct physical keys into one logical group via deriveLogicalKey", () => {
    const snapshots = buildSidebarProjectSnapshots({
      members: [
        makeMember({ workspaceId: "a", physicalProjectKey: "C:\\repos\\app" }),
        makeMember({ workspaceId: "b", physicalProjectKey: "C:\\repos\\app-clone" }),
      ],
      deriveLogicalKey: (_entry) => "logical:app",
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.members).toHaveLength(2);
  });

  it("derives a display name from the representative", () => {
    const snapshots = buildSidebarProjectSnapshots({
      members: [makeMember({ workspaceId: "a", projectName: "owner/repo-name" })],
    });
    expect(snapshots[0]?.displayName).toBe("repo-name");
  });

  it("shortens owner/repo labels to the basename for status cards", () => {
    expect(shortProjectName("ayasealter/ChisaTerminal")).toBe("ChisaTerminal");
    expect(shortProjectName("a/b/c")).toBe("c");
    expect(shortProjectName("no-slash")).toBe("no-slash");
    expect(shortProjectName("trailing/")).toBe("trailing/");
    expect(shortProjectName("")).toBe("Unknown project");
  });

  it("skips fully archived groups unless asked to include them", () => {
    const archived = makeMember({ workspaceId: "a", archivedAt: "2026-01-02T00:00:00.000Z" });
    const snapshots = buildSidebarProjectSnapshots({ members: [archived] });
    expect(snapshots).toEqual([]);
    const withArchived = buildSidebarProjectSnapshots({
      members: [archived],
      includeArchived: true,
    });
    expect(withArchived[0]?.fullyArchived).toBe(true);
  });
});

describe("getProjectSortTimestamp", () => {
  it("uses the newest thread activity", () => {
    const timestamp = getProjectSortTimestamp({
      projectKey: "p",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      threads: [
        { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
        { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      ],
    });
    expect(timestamp).toBe(Date.parse("2026-01-03T00:00:00.000Z"));
  });

  it("falls back to the project updatedAt", () => {
    const timestamp = getProjectSortTimestamp({
      projectKey: "p",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
      threads: [],
    });
    expect(timestamp).toBe(Date.parse("2026-01-05T00:00:00.000Z"));
  });
});

describe("sortProjectsForSidebar", () => {
  it("sorts by newest activity descending", () => {
    const sorted = sortProjectsForSidebar({
      projects: [{ projectKey: "a" }, { projectKey: "b" }],
      threadsByProjectKey: new Map([
        ["a", [{ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]],
        ["b", [{ createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }]],
      ]),
    });
    expect(sorted.map((project) => project.projectKey)).toEqual(["b", "a"]);
  });

  it("applies a manual preferred order first", () => {
    const sorted = sortProjectsForSidebar({
      projects: [{ projectKey: "a" }, { projectKey: "b" }, { projectKey: "c" }],
      threadsByProjectKey: new Map(),
      preferredProjectKeys: ["c", "a"],
    });
    expect(sorted.map((project) => project.projectKey)).toEqual(["c", "a", "b"]);
  });
});
