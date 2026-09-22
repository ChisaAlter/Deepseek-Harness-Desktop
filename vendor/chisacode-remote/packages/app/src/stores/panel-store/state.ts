import {
  buildExplorerCheckoutKey,
  isExplorerTab,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "../explorer-tab-memory";
import { type ExplorerCheckoutContext } from "../explorer-checkout-context";

export type MobilePanelView = "agent" | "agent-list" | "file-explorer";

/** Desktop unified right-panel surfaces (T3 "Open a surface"). */
export type RightPanelSurface = "files" | "diff" | "terminal" | "browser";

export interface DesktopSidebarState {
  agentListOpen: boolean;
  /**
   * Compat mirror for Files/Diff surfaces.
   * Prefer rightPanelOpen + rightPanelActiveSurface for new code.
   */
  fileExplorerOpen: boolean;
  focusModeEnabled: boolean;
  /** Bottom terminal drawer (T3 dual terminal entry). */
  terminalDrawerOpen: boolean;
  /** Unified right surface rail. */
  rightPanelOpen: boolean;
  /** Active surface when right panel is open; null when empty chooser. */
  rightPanelActiveSurface: RightPanelSurface | null;
}

export const RIGHT_PANEL_SURFACES: readonly RightPanelSurface[] = [
  "files",
  "diff",
  "terminal",
  "browser",
] as const;

export function isRightPanelSurface(value: unknown): value is RightPanelSurface {
  return value === "files" || value === "diff" || value === "terminal" || value === "browser";
}

export function resolveDefaultRightPanelSurface(isGit: boolean): RightPanelSurface {
  return isGit ? "diff" : "files";
}

export type SortOption = "name" | "modified" | "size";
export type EnvironmentPanelTabPreference =
  | "git-summary"
  | "pull-request"
  | "tasks"
  | "subagents"
  | "browser-context";

export const DEFAULT_ENVIRONMENT_PANEL_OPACITY = 0.97;
export const DEFAULT_ENVIRONMENT_PANEL_TABS: readonly EnvironmentPanelTabPreference[] = [
  "git-summary",
  "pull-request",
  "tasks",
  "subagents",
  "browser-context",
];

// Soft Workbench default nav width (--nav-w 260).
export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 320;

export const DEFAULT_EXPLORER_SIDEBAR_WIDTH = 400;
export const MIN_EXPLORER_SIDEBAR_WIDTH = 280;
// Upper bound is intentionally generous; desktop resizing enforces a min-chat-width constraint.
export const MAX_EXPLORER_SIDEBAR_WIDTH = 2000;

export const DEFAULT_EXPLORER_FILES_SPLIT_RATIO = 0.38;
export const MIN_EXPLORER_FILES_SPLIT_RATIO = 0.2;
export const MAX_EXPLORER_FILES_SPLIT_RATIO = 0.8;

export interface PanelVisibilityState {
  isAgentListOpen: boolean;
  isFileExplorerOpen: boolean;
}

export interface PanelLayoutInput {
  isCompact: boolean;
}

export interface ExplorerPanelIntent extends PanelLayoutInput {
  checkout: ExplorerCheckoutContext;
}

export interface PanelCoreState {
  mobileView: MobilePanelView;
  desktop: DesktopSidebarState;
  explorerTab: ExplorerTab;
  explorerTabByCheckout: Record<string, ExplorerTab>;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function clampSidebarWidth(width: number): number {
  return clampNumber(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function clampExplorerWidth(width: number): number {
  return clampNumber(width, MIN_EXPLORER_SIDEBAR_WIDTH, MAX_EXPLORER_SIDEBAR_WIDTH);
}

export function clampExplorerFilesSplitRatio(ratio: number): number {
  return clampNumber(ratio, MIN_EXPLORER_FILES_SPLIT_RATIO, MAX_EXPLORER_FILES_SPLIT_RATIO);
}

export function clampEnvironmentPanelOpacity(opacity: number): number {
  return clampNumber(opacity, 0.72, 1);
}

export function selectPanelVisibility(
  state: PanelCoreState,
  input: PanelLayoutInput,
): PanelVisibilityState {
  if (input.isCompact) {
    return {
      isAgentListOpen: state.mobileView === "agent-list",
      isFileExplorerOpen: state.mobileView === "file-explorer",
    };
  }
  return {
    isAgentListOpen: state.desktop.agentListOpen,
    // Files/Diff right surfaces dual-write fileExplorerOpen for mobile/e2e compat.
    isFileExplorerOpen:
      state.desktop.fileExplorerOpen || isDesktopFilesDiffSurfaceOpen(state.desktop),
  };
}

function isDesktopFilesDiffSurfaceOpen(desktop: DesktopSidebarState): boolean {
  return (
    desktop.rightPanelOpen &&
    (desktop.rightPanelActiveSurface === "files" || desktop.rightPanelActiveSurface === "diff")
  );
}

export function selectIsTerminalDrawerOpen(
  state: PanelCoreState,
  input: PanelLayoutInput,
): boolean {
  if (input.isCompact) {
    return false;
  }
  return Boolean(state.desktop.terminalDrawerOpen);
}

export function selectIsRightPanelOpen(state: PanelCoreState, input: PanelLayoutInput): boolean {
  if (input.isCompact) {
    return selectIsFileExplorerOpen(state, input);
  }
  return Boolean(state.desktop.rightPanelOpen);
}

export function selectRightPanelActiveSurface(
  state: PanelCoreState,
  input: PanelLayoutInput,
): RightPanelSurface | null {
  if (input.isCompact) {
    return null;
  }
  return state.desktop.rightPanelActiveSurface;
}

export function selectIsAgentListOpen(state: PanelCoreState, input: PanelLayoutInput): boolean {
  return selectPanelVisibility(state, input).isAgentListOpen;
}

export function selectIsFileExplorerOpen(state: PanelCoreState, input: PanelLayoutInput): boolean {
  return selectPanelVisibility(state, input).isFileExplorerOpen;
}

function resolveExplorerTabFromCheckout(
  state: PanelCoreState,
  checkout: ExplorerCheckoutContext,
): ExplorerTab {
  return resolveExplorerTabForCheckout({
    serverId: checkout.serverId,
    cwd: checkout.cwd,
    isGit: checkout.isGit,
    explorerTabByCheckout: state.explorerTabByCheckout,
  });
}

export interface OpenFileExplorerPatch {
  mobileView?: MobilePanelView;
  desktop?: DesktopSidebarState;
  explorerTab: ExplorerTab;
}

export function buildOpenFileExplorerPatch(
  state: PanelCoreState,
  input: ExplorerPanelIntent,
): OpenFileExplorerPatch {
  const resolvedTab = resolveExplorerTabFromCheckout(state, input.checkout);
  if (input.isCompact) {
    return {
      mobileView: "file-explorer",
      explorerTab: resolvedTab,
    };
  }
  const surface: RightPanelSurface = resolvedTab === "files" ? "files" : "diff";
  return {
    desktop: {
      ...state.desktop,
      fileExplorerOpen: true,
      rightPanelOpen: true,
      rightPanelActiveSurface: surface,
    },
    explorerTab: resolvedTab,
  };
}

export type ToggleFileExplorerPatch =
  | OpenFileExplorerPatch
  | { mobileView: MobilePanelView }
  | { desktop: DesktopSidebarState };

export function buildToggleFileExplorerPatch(
  state: PanelCoreState,
  input: ExplorerPanelIntent,
): ToggleFileExplorerPatch {
  const isOpen = selectIsFileExplorerOpen(state, input);
  if (!isOpen) {
    return buildOpenFileExplorerPatch(state, input);
  }
  if (input.isCompact) {
    return { mobileView: "agent" };
  }
  return {
    desktop: {
      ...state.desktop,
      fileExplorerOpen: false,
      rightPanelOpen: false,
      rightPanelActiveSurface: null,
    },
  };
}

type MigratablePanelState = Record<string, unknown>;

function migratePanelV2Explorer(state: MigratablePanelState, isWeb: boolean): void {
  if (isWeb && typeof state.explorerWidth === "number" && state.explorerWidth === 400) {
    state.explorerWidth = DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  }
  if (typeof state.explorerFilesSplitRatio !== "number") {
    state.explorerFilesSplitRatio = DEFAULT_EXPLORER_FILES_SPLIT_RATIO;
  } else {
    state.explorerFilesSplitRatio = clampExplorerFilesSplitRatio(state.explorerFilesSplitRatio);
  }
}

function migratePanelV3Explorer(state: MigratablePanelState, isWeb: boolean): void {
  if (
    isWeb &&
    typeof state.explorerWidth === "number" &&
    (state.explorerWidth === 400 || state.explorerWidth === 520)
  ) {
    state.explorerWidth = DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  }
}

function migratePanelExplorerTabByCheckout(state: MigratablePanelState, version: number): void {
  if (
    version < 4 ||
    typeof state.explorerTabByCheckout !== "object" ||
    !state.explorerTabByCheckout
  ) {
    state.explorerTabByCheckout = {};
    return;
  }
  const entries = Object.entries(state.explorerTabByCheckout as Record<string, unknown>);
  const next: Record<string, ExplorerTab> = {};
  for (const [key, value] of entries) {
    if (!isExplorerTab(value)) {
      continue;
    }
    next[key] = value;
  }
  state.explorerTabByCheckout = next;
}

function migratePanelDesktopFocusMode(state: MigratablePanelState): void {
  const desktop = state.desktop as Record<string, unknown> | undefined;
  if (!desktop) {
    return;
  }
  if ("zoomed" in desktop) {
    desktop.focusModeEnabled = desktop.zoomed;
    delete desktop.zoomed;
  }
  if ("focused" in desktop) {
    desktop.focusModeEnabled = desktop.focused;
    delete desktop.focused;
  }
  if (typeof desktop.focusModeEnabled !== "boolean") {
    desktop.focusModeEnabled = false;
  }
}

function migratePanelDesktopRightPanel(state: MigratablePanelState, version: number): void {
  const desktop = state.desktop as DesktopSidebarState | undefined;
  if (!desktop || typeof desktop !== "object") {
    return;
  }
  if (version < 19) {
    const fileExplorerOpen = Boolean(desktop.fileExplorerOpen);
    if (typeof desktop.terminalDrawerOpen !== "boolean") {
      desktop.terminalDrawerOpen = false;
    }
    if (typeof desktop.rightPanelOpen !== "boolean") {
      desktop.rightPanelOpen = fileExplorerOpen;
    }
    if (!isRightPanelSurface(desktop.rightPanelActiveSurface)) {
      if (!fileExplorerOpen) {
        desktop.rightPanelActiveSurface = null;
      } else if (state.explorerTab === "files") {
        desktop.rightPanelActiveSurface = "files";
      } else {
        desktop.rightPanelActiveSurface = "diff";
      }
    }
  } else {
    if (typeof desktop.terminalDrawerOpen !== "boolean") {
      desktop.terminalDrawerOpen = false;
    }
    if (typeof desktop.rightPanelOpen !== "boolean") {
      desktop.rightPanelOpen = false;
    }
    if (
      desktop.rightPanelActiveSurface != null &&
      !isRightPanelSurface(desktop.rightPanelActiveSurface)
    ) {
      desktop.rightPanelActiveSurface = null;
    }
  }
}

export function migratePanelState(
  persistedState: unknown,
  version: number,
  options: { isWeb: boolean },
): MigratablePanelState {
  const state = (persistedState ?? {}) as MigratablePanelState;
  const { isWeb } = options;

  if (version < 2) {
    migratePanelV2Explorer(state, isWeb);
  }
  if (version < 3) {
    migratePanelV3Explorer(state, isWeb);
  }
  if (!isExplorerTab(state.explorerTab)) {
    state.explorerTab = "changes";
  }
  migratePanelExplorerTabByCheckout(state, version);
  if (version < 8) {
    migratePanelDesktopFocusMode(state);
  }
  if (version < 6 || typeof state.sidebarWidth !== "number") {
    state.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  } else if (isWeb && version < 18) {
    // Version 18 Soft Workbench: migrate rails to design --nav-w 260.
    state.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  } else {
    state.sidebarWidth = clampSidebarWidth(state.sidebarWidth);
  }
  if (
    version < 9 ||
    typeof state.expandedPathsByWorkspace !== "object" ||
    !state.expandedPathsByWorkspace
  ) {
    state.expandedPathsByWorkspace = {};
  }
  if (
    version < 10 ||
    typeof state.diffExpandedPathsByWorkspace !== "object" ||
    !state.diffExpandedPathsByWorkspace
  ) {
    state.diffExpandedPathsByWorkspace = {};
  }
  if (version < 16 || typeof state.environmentPanelOpacity !== "number") {
    state.environmentPanelOpacity = DEFAULT_ENVIRONMENT_PANEL_OPACITY;
  } else {
    state.environmentPanelOpacity = clampEnvironmentPanelOpacity(state.environmentPanelOpacity);
  }
  const visibleTabs = Array.isArray(state.environmentPanelVisibleTabs)
    ? state.environmentPanelVisibleTabs.filter((tab): tab is EnvironmentPanelTabPreference =>
        DEFAULT_ENVIRONMENT_PANEL_TABS.includes(tab as EnvironmentPanelTabPreference),
      )
    : [];
  state.environmentPanelVisibleTabs =
    visibleTabs.length > 0 ? [...new Set(visibleTabs)] : [...DEFAULT_ENVIRONMENT_PANEL_TABS];

  migratePanelDesktopRightPanel(state, version);

  return state;
}

export { buildExplorerCheckoutKey, resolveExplorerTabForCheckout };
export type { ExplorerTab, ExplorerCheckoutContext };
