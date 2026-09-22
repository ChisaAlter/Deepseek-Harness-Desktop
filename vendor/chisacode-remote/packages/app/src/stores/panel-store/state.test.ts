import { describe, expect, it } from "vitest";
import {
  buildExplorerCheckoutKey,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "@/stores/explorer-tab-memory";
import {
  buildOpenFileExplorerPatch,
  buildToggleFileExplorerPatch,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  migratePanelState,
  selectIsAgentListOpen,
  selectIsFileExplorerOpen,
  selectPanelVisibility,
  type PanelCoreState,
} from "./state";

describe("panel-store soft workbench migration", () => {
  it("uses the 260px Soft Workbench sidebar as the default", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(260);
    expect(MAX_SIDEBAR_WIDTH).toBe(320);
  });

  it("resets legacy desktop widths for the soft workbench", () => {
    expect(migratePanelState({ sidebarWidth: 320 }, 12, { isWeb: true }).sidebarWidth).toBe(260);
    expect(migratePanelState({ sidebarWidth: 200 }, 14, { isWeb: true }).sidebarWidth).toBe(260);
    expect(migratePanelState({ sidebarWidth: 256 }, 17, { isWeb: true }).sidebarWidth).toBe(260);
    expect(migratePanelState({ sidebarWidth: 248 }, 18, { isWeb: true }).sidebarWidth).toBe(248);
    expect(migratePanelState({ sidebarWidth: 248 }, 12, { isWeb: false }).sidebarWidth).toBe(248);
  });
});

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

function makePanelState(overrides: Partial<PanelCoreState> = {}): PanelCoreState {
  const { desktop: desktopOverrides, ...rest } = overrides;
  return {
    mobileView: "agent",
    desktop: makeDesktop(desktopOverrides),
    explorerTab: "changes",
    explorerTabByCheckout: {},
    ...rest,
  };
}

describe("panel-store explorer tab resolution", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("defaults to changes for git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {},
      }),
    ).toBe("changes");
  });

  it("defaults to files for non-git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {},
      }),
    ).toBe("files");
  });

  it("restores a stored files tab for git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "files",
        },
      }),
    ).toBe("files");
  });

  it("falls back to default when stored tab is invalid", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "terminals" as unknown as ExplorerTab,
        },
      }),
    ).toBe("changes");
  });

  it("coerces stored changes to files for non-git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {
          [key]: "changes",
        },
      }),
    ).toBe("files");
  });
});

describe("panel-store visibility selectors", () => {
  it("uses mobileView for compact layout visibility", () => {
    const state = makePanelState({
      mobileView: "file-explorer",
      desktop: makeDesktop({
        agentListOpen: true,
        fileExplorerOpen: false,
        focusModeEnabled: false,
      }),
    });

    expect(selectPanelVisibility(state, { isCompact: true })).toEqual({
      isAgentListOpen: false,
      isFileExplorerOpen: true,
    });
    expect(selectIsAgentListOpen(state, { isCompact: true })).toBe(false);
    expect(selectIsFileExplorerOpen(state, { isCompact: true })).toBe(true);
  });

  it("uses desktop flags for expanded layout visibility", () => {
    const state = makePanelState({
      mobileView: "file-explorer",
      desktop: makeDesktop({
        agentListOpen: true,
        fileExplorerOpen: false,
        focusModeEnabled: false,
      }),
    });

    expect(selectPanelVisibility(state, { isCompact: false })).toEqual({
      isAgentListOpen: true,
      isFileExplorerOpen: false,
    });
    expect(selectIsAgentListOpen(state, { isCompact: false })).toBe(true);
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(false);
  });
});

describe("panel-store checkout-intent file explorer actions", () => {
  it("opens the compact explorer and resolves the tab from the explicit checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    const state = makePanelState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "files" },
    });

    const patch = buildOpenFileExplorerPatch(state, { isCompact: true, checkout });

    expect(patch.mobileView).toBe("file-explorer");
    expect(patch.desktop).toBeUndefined();
    expect(patch.explorerTab).toBe("files");
  });

  it("opens the expanded explorer and resolves the tab from the explicit checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    const state = makePanelState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "files" },
    });

    const patch = buildOpenFileExplorerPatch(state, { isCompact: false, checkout });

    expect(patch.mobileView).toBeUndefined();
    expect(patch.desktop?.fileExplorerOpen).toBe(true);
    expect(patch.explorerTab).toBe("files");
  });

  it("toggles the explorer closed without changing the active tab", () => {
    const state = makePanelState({
      desktop: makeDesktop({
        agentListOpen: false,
        fileExplorerOpen: true,
        focusModeEnabled: false,
        rightPanelOpen: true,
        rightPanelActiveSurface: "files",
      }),
      explorerTab: "files",
    });

    const patch = buildToggleFileExplorerPatch(state, {
      isCompact: false,
      checkout: { serverId: "server-1", cwd: "/tmp/repo", isGit: true },
    });

    expect(patch).toEqual({
      desktop: {
        agentListOpen: false,
        fileExplorerOpen: false,
        focusModeEnabled: false,
        terminalDrawerOpen: false,
        rightPanelOpen: false,
        rightPanelActiveSurface: null,
      },
    });
  });

  it("coerces changes to files for a non-git checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: false };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    const state = makePanelState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "changes" },
    });

    const patch = buildOpenFileExplorerPatch(state, { isCompact: false, checkout });

    expect(patch.explorerTab).toBe("files");
  });

  it("opens with the default files tab for an explicit non-git checkout with no stored tab", () => {
    const state = makePanelState({ explorerTab: "changes", explorerTabByCheckout: {} });

    const patch = buildOpenFileExplorerPatch(state, {
      isCompact: false,
      checkout: { serverId: "server-1", cwd: "/tmp/non-git", isGit: false },
    });

    expect(patch.desktop?.fileExplorerOpen).toBe(true);
    expect(patch.explorerTab).toBe("files");
  });
});
