import { describe, expect, it } from "vitest";
import {
  buildMobileSidebarQuickActionButtons,
  buildMobileSidebarQuickActionModel,
  resolveMobileSidebarQuickActionAgentLabel,
  resolveMobileSidebarQuickActionAgentTarget,
  selectMobileSidebarQuickActionAgent,
} from "./mobile-sidebar-quick-actions";

describe("buildMobileSidebarQuickActionModel", () => {
  it("builds workspace intent routes when a workspace is available", () => {
    expect(
      buildMobileSidebarQuickActionModel({
        serverId: "local",
        workspaceId: "repo",
        projectKind: "git",
      }),
    ).toEqual({
      workspaceId: "repo",
      changesRoute: "/h/local/workspace/repo?open=changes%3Areview",
      terminalRoute: "/h/local/workspace/repo?open=terminal%3Anew",
    });
  });

  it("hides workspace actions when workspace context is missing", () => {
    expect(
      buildMobileSidebarQuickActionModel({
        serverId: "local",
        workspaceId: null,
        projectKind: "git",
      }),
    ).toEqual({
      workspaceId: null,
      changesRoute: null,
      terminalRoute: null,
    });
  });

  it("hides changes for non-git workspaces while keeping terminal available", () => {
    expect(
      buildMobileSidebarQuickActionModel({
        serverId: "local",
        workspaceId: "repo",
        projectKind: "directory",
      }),
    ).toEqual({
      workspaceId: "repo",
      changesRoute: null,
      terminalRoute: "/h/local/workspace/repo?open=terminal%3Anew",
    });
  });

  it("normalizes git project kind before showing changes", () => {
    expect(
      buildMobileSidebarQuickActionModel({
        serverId: "local",
        workspaceId: "repo",
        projectKind: " Git ",
      }).changesRoute,
    ).toBe("/h/local/workspace/repo?open=changes%3Areview");
  });
});

describe("buildMobileSidebarQuickActionButtons", () => {
  it("orders all available actions with resume as the primary action", () => {
    expect(
      buildMobileSidebarQuickActionButtons({
        hasAgentTarget: true,
        changesRoute: "/changes",
        terminalRoute: "/terminal",
        canViewSessions: true,
      }),
    ).toEqual([
      { id: "resume", variant: "primary" },
      { id: "changes", variant: "secondary" },
      { id: "terminal", variant: "secondary" },
      { id: "sessions", variant: "secondary" },
      { id: "close", variant: "secondary" },
    ]);
  });

  it("hides actions that cannot do anything in the current context", () => {
    expect(
      buildMobileSidebarQuickActionButtons({
        hasAgentTarget: false,
        changesRoute: null,
        terminalRoute: "   ",
        canViewSessions: false,
      }),
    ).toEqual([{ id: "close", variant: "secondary" }]);
  });
});

describe("resolveMobileSidebarQuickActionAgentLabel", () => {
  it("prefers the trimmed title", () => {
    expect(
      resolveMobileSidebarQuickActionAgentLabel({
        id: "agent-1",
        title: "  Polish mobile drawer  ",
        cwd: "/repo",
      }),
    ).toBe("Polish mobile drawer");
  });

  it("falls back through cwd and id without using blank labels", () => {
    expect(
      resolveMobileSidebarQuickActionAgentLabel({
        id: " agent-1 ",
        title: "   ",
        cwd: "   ",
      }),
    ).toBe("agent-1");
  });

  it("uses the workspace directory name when falling back to cwd", () => {
    expect(
      resolveMobileSidebarQuickActionAgentLabel({
        id: "agent-1",
        title: null,
        cwd: "D:\\Ai\\ChisaCode\\",
      }),
    ).toBe("ChisaCode");

    expect(
      resolveMobileSidebarQuickActionAgentLabel({
        id: "agent-1",
        title: null,
        cwd: "/Users/me/project",
      }),
    ).toBe("project");
  });

  it("uses a stable generic label when every source is blank", () => {
    expect(
      resolveMobileSidebarQuickActionAgentLabel({
        id: "",
        title: null,
        cwd: "   ",
      }),
    ).toBe("Agent");
  });
});

describe("resolveMobileSidebarQuickActionAgentTarget", () => {
  it("trims agent navigation identifiers", () => {
    expect(
      resolveMobileSidebarQuickActionAgentTarget({
        serverId: " local ",
        id: " agent-1 ",
      }),
    ).toEqual({
      serverId: "local",
      agentId: "agent-1",
    });
  });

  it("returns null when the agent cannot be navigated to", () => {
    expect(resolveMobileSidebarQuickActionAgentTarget(null)).toBeNull();
    expect(resolveMobileSidebarQuickActionAgentTarget({ serverId: "local", id: " " })).toBeNull();
  });
});

describe("selectMobileSidebarQuickActionAgent", () => {
  const agents = [
    { serverId: "local", id: "archived", archivedAt: "2026-01-01T00:00:00.000Z" },
    { serverId: "local", id: "agent-1", archivedAt: null },
    { serverId: "remote", id: "agent-2", archivedAt: null },
  ];

  it("prefers the selected server-qualified agent id", () => {
    expect(selectMobileSidebarQuickActionAgent(agents, "remote:agent-2")?.id).toBe("agent-2");
  });

  it("also accepts a plain selected agent id", () => {
    expect(selectMobileSidebarQuickActionAgent(agents, "agent-1")?.id).toBe("agent-1");
  });

  it("prefers the active server when matching a plain selected agent id", () => {
    const duplicateAgents = [
      { serverId: "remote", id: "agent-1", archivedAt: null },
      { serverId: "local", id: "agent-1", archivedAt: null },
    ];

    expect(selectMobileSidebarQuickActionAgent(duplicateAgents, "agent-1", "local")?.serverId).toBe(
      "local",
    );
  });

  it("falls back to the first non-archived agent", () => {
    expect(selectMobileSidebarQuickActionAgent(agents, "missing")?.id).toBe("agent-1");
  });

  it("does not select an archived agent even when it is selected", () => {
    expect(selectMobileSidebarQuickActionAgent(agents, "local:archived")?.id).toBe("agent-1");
  });

  it("does not treat blank archived timestamps as archived", () => {
    expect(
      selectMobileSidebarQuickActionAgent(
        [{ serverId: "local", id: "agent-blank-archive", archivedAt: "   " }],
        "agent-blank-archive",
      )?.id,
    ).toBe("agent-blank-archive");
  });

  it("does not treat invalid archived Date objects as archived", () => {
    expect(
      selectMobileSidebarQuickActionAgent(
        [{ serverId: "local", id: "agent-invalid-archive", archivedAt: new Date(Number.NaN) }],
        "agent-invalid-archive",
      )?.id,
    ).toBe("agent-invalid-archive");
  });

  it("ignores agents that cannot be navigated to", () => {
    const partialAgents = [
      { serverId: "  ", id: "agent-1", archivedAt: null },
      { serverId: "local", id: "   ", archivedAt: null },
      { serverId: "local", id: "agent-2", archivedAt: null },
    ];

    expect(selectMobileSidebarQuickActionAgent(partialAgents, "agent-1")?.id).toBe("agent-2");
  });

  it("prefers the active server when falling back from a missing selection", () => {
    expect(selectMobileSidebarQuickActionAgent(agents, "missing", "remote")?.serverId).toBe(
      "remote",
    );
  });

  it("returns null when no agent is available", () => {
    expect(
      selectMobileSidebarQuickActionAgent(
        [{ serverId: "local", id: "old", archivedAt: "x" }],
        null,
      ),
    ).toBeNull();
  });
});
