import { describe, expect, it } from "vitest";

import {
  buildOpenFileExplorerPatch,
  buildToggleFileExplorerPatch,
  isRightPanelSurface,
  migratePanelState,
  resolveDefaultRightPanelSurface,
  type PanelCoreState,
} from "@/stores/panel-store/state";

function makeDesktop(
  overrides: Partial<PanelCoreState["desktop"]> = {},
): PanelCoreState["desktop"] {
  return {
    agentListOpen: false,
    fileExplorerOpen: false,
    focusModeEnabled: false,
    terminalDrawerOpen: false,
    rightPanelOpen: false,
    rightPanelActiveSurface: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<PanelCoreState> = {}): PanelCoreState {
  const { desktop, ...rest } = overrides;
  return {
    mobileView: "agent",
    desktop: makeDesktop(desktop),
    explorerTab: "changes",
    explorerTabByCheckout: {},
    ...rest,
  };
}

describe("production right-panel surface helpers", () => {
  it("defaults git workspaces to diff and non-git to files", () => {
    expect(resolveDefaultRightPanelSurface(true)).toBe("diff");
    expect(resolveDefaultRightPanelSurface(false)).toBe("files");
  });

  it("validates surface ids strictly", () => {
    for (const surface of ["files", "diff", "terminal", "browser"] as const) {
      expect(isRightPanelSurface(surface)).toBe(true);
    }
    expect(isRightPanelSurface("pr")).toBe(false);
    expect(isRightPanelSurface(undefined)).toBe(false);
  });
});

describe("explorer dual-write to unified right panel", () => {
  const checkout = {
    serverId: "server-1",
    cwd: "/tmp/repo",
    isGit: true,
  };

  it("opens right panel Files/Diff when opening explorer for git checkout", () => {
    const patch = buildOpenFileExplorerPatch(makeState(), {
      isCompact: false,
      checkout,
    });
    expect(patch.desktop?.fileExplorerOpen).toBe(true);
    expect(patch.desktop?.rightPanelOpen).toBe(true);
    expect(patch.desktop?.rightPanelActiveSurface).toBe("diff");
    expect(patch.explorerTab).toBe("changes");
  });

  it("opens files surface for non-git checkout", () => {
    const nonGit = { ...checkout, isGit: false };
    const patch = buildOpenFileExplorerPatch(makeState({ explorerTab: "files" }), {
      isCompact: false,
      checkout: nonGit,
    });
    expect(patch.desktop?.rightPanelActiveSurface).toBe("files");
    expect(patch.explorerTab).toBe("files");
  });

  it("closes right panel when toggling explorer closed", () => {
    const state = makeState({
      desktop: makeDesktop({
        fileExplorerOpen: true,
        rightPanelOpen: true,
        rightPanelActiveSurface: "diff",
      }),
    });
    const patch = buildToggleFileExplorerPatch(state, {
      isCompact: false,
      checkout,
    });
    expect(patch).toMatchObject({
      desktop: {
        fileExplorerOpen: false,
        rightPanelOpen: false,
        rightPanelActiveSurface: null,
      },
    });
  });
});

describe("panel-state migration v19 production fields", () => {
  it("migrates open explorer into right panel surface", () => {
    const migrated = migratePanelState(
      {
        desktop: {
          agentListOpen: true,
          fileExplorerOpen: true,
          focusModeEnabled: false,
        },
        explorerTab: "files",
      },
      18,
      { isWeb: true },
    );
    const desktop = migrated.desktop as PanelCoreState["desktop"];
    expect(desktop.terminalDrawerOpen).toBe(false);
    expect(desktop.rightPanelOpen).toBe(true);
    expect(desktop.rightPanelActiveSurface).toBe("files");
  });

  it("migrates closed explorer to closed right panel", () => {
    const migrated = migratePanelState(
      {
        desktop: {
          agentListOpen: false,
          fileExplorerOpen: false,
          focusModeEnabled: false,
        },
        explorerTab: "changes",
      },
      18,
      { isWeb: true },
    );
    const desktop = migrated.desktop as PanelCoreState["desktop"];
    expect(desktop.rightPanelOpen).toBe(false);
    expect(desktop.rightPanelActiveSurface).toBeNull();
    expect(desktop.terminalDrawerOpen).toBe(false);
  });
});
