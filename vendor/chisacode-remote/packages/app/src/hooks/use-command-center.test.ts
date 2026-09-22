import { describe, expect, it } from "vitest";
import { buildCommandCenterActionItems } from "./command-center-actions";

const t = (key: string) => key;

describe("buildCommandCenterActionItems", () => {
  it("hides workspace-aware commands outside a workspace route", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: null,
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).not.toContain("new-agent-current-workspace");
    expect(items.map((item) => item.id)).not.toContain("open-current-workspace-changes");
    expect(items.map((item) => item.id)).not.toContain("new-terminal-current-workspace");
    expect(items.map((item) => item.id)).not.toContain("archive-current-worktree");
  });

  it("hides workspace-aware commands when the workspace route is incomplete", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "   " },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/%20%20%20?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).not.toContain("open-current-workspace-changes");
    expect(items.map((item) => item.id)).not.toContain("new-terminal-current-workspace");
    expect(items.map((item) => item.id)).not.toContain("archive-current-worktree");
  });

  it("shows workspace-aware commands with dispatch actions in a workspace route", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open-current-workspace-changes",
          dispatchAction: "workspace.changes.open",
        }),
        expect.objectContaining({
          id: "toggle-current-workspace-environment",
          dispatchAction: "workspace.environment.toggle",
        }),
        expect.objectContaining({
          id: "new-terminal-current-workspace",
          dispatchAction: "workspace.terminal.new",
        }),
        expect.objectContaining({
          id: "copy-current-workspace-resume-command",
          dispatchAction: "workspace.resume.copy",
        }),
        expect.objectContaining({
          id: "archive-current-worktree",
          dispatchAction: "worktree.archive",
        }),
      ]),
    );
  });

  it("hides the changes command for non-git workspaces", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "local_checkout",
      currentProjectKind: "directory",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).not.toContain("open-current-workspace-changes");
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "toggle-current-workspace-environment" }),
        expect.objectContaining({ id: "new-terminal-current-workspace" }),
        expect.objectContaining({ id: "copy-current-workspace-resume-command" }),
        expect.objectContaining({ id: "archive-current-worktree" }),
      ]),
    );
  });

  it("labels the archive command as hide for non-worktree workspaces", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "local_checkout",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.find((item) => item.id === "archive-current-worktree")).toMatchObject({
      title: "commandCenter.hideCurrentWorkspace",
      subtitle: "commandCenter.hideCurrentWorkspaceSubtitle",
      dispatchAction: "worktree.archive",
    });
  });

  it("labels the archive command as archive for worktrees", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.find((item) => item.id === "archive-current-worktree")).toMatchObject({
      title: "commandCenter.archiveCurrentWorktree",
      subtitle: "commandCenter.archiveCurrentWorktreeSubtitle",
      dispatchAction: "worktree.archive",
    });
  });

  it("normalizes workspace and project kind before filtering commands", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: " WorkTree ",
      currentProjectKind: " Git ",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.find((item) => item.id === "open-current-workspace-changes")).toMatchObject({
      dispatchAction: "workspace.changes.open",
    });
    expect(items.find((item) => item.id === "archive-current-worktree")).toMatchObject({
      title: "commandCenter.archiveCurrentWorktree",
      subtitle: "commandCenter.archiveCurrentWorktreeSubtitle",
    });
  });

  it("filters workspace-aware commands by query keywords", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "resume",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["copy-current-workspace-resume-command"]);
  });

  it("assigns an agent icon to the resume command", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "resume",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items[0]).toMatchObject({
      id: "copy-current-workspace-resume-command",
      icon: "agent",
    });
  });

  it("filters commands by localized subtitles", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "confirm",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t: (key) =>
        key === "commandCenter.archiveCurrentWorktreeSubtitle"
          ? "Archive with the existing confirm flow"
          : key,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["archive-current-worktree"]);
  });

  it("matches the non-worktree hide workspace alias", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "hide",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "local_checkout",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["archive-current-worktree"]);
    expect(items[0]).toMatchObject({
      title: "commandCenter.hideCurrentWorkspace",
      dispatchAction: "worktree.archive",
    });
  });

  it("matches dynamic non-worktree subtitles after relabeling archive to hide", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "remove from sidebar",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "local_checkout",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t: (key) =>
        key === "commandCenter.hideCurrentWorkspaceSubtitle"
          ? "Remove from sidebar without changing files"
          : key,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["archive-current-worktree"]);
    expect(items[0]).toMatchObject({
      subtitle: "Remove from sidebar without changing files",
    });
  });

  it("matches multi-word queries across titles, subtitles, and keywords", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "open diff",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t: (key) =>
        key === "commandCenter.openCurrentWorkspaceChanges"
          ? "Open current workspace changes"
          : key,
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["open-current-workspace-changes"]);
  });

  it("splits command-style queries on punctuation", () => {
    const diffItems = buildCommandCenterActionItems({
      open: true,
      query: "open-diff",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t: (key) =>
        key === "commandCenter.openCurrentWorkspaceChanges"
          ? "Open current workspace changes"
          : key,
      resolveShortcutKeys: () => undefined,
    });
    const hideItems = buildCommandCenterActionItems({
      open: true,
      query: "hide/workspace",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "local_checkout",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t,
      resolveShortcutKeys: () => undefined,
    });

    expect(diffItems.map((item) => item.id)).toEqual(["open-current-workspace-changes"]);
    expect(hideItems.map((item) => item.id)).toEqual(["archive-current-worktree"]);
  });

  it("keeps unicode query tokens searchable instead of treating them as an empty query", () => {
    const items = buildCommandCenterActionItems({
      open: true,
      query: "设置",
      currentWorkspaceRoute: { serverId: "local", workspaceId: "repo" },
      currentWorkspaceKind: "worktree",
      currentProjectKind: "git",
      currentWorkspaceDraftRoute: "/h/local/workspace/repo?open=draft%3Anew",
      settingsRoute: "/settings",
      homeRoute: "/h/local/open-project",
      sessionsRoute: "/h/local/sessions",
      t: (key) => (key === "settings.title" ? "设置" : key),
      resolveShortcutKeys: () => undefined,
    });

    expect(items.map((item) => item.id)).toEqual(["settings"]);
  });
});
