import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildExplorerCheckoutKey,
  coerceExplorerTabForCheckout,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "../explorer-tab-memory";
import { type ExplorerCheckoutContext } from "../explorer-checkout-context";
import {
  buildOpenFileExplorerPatch,
  buildToggleFileExplorerPatch,
  clampEnvironmentPanelOpacity,
  clampExplorerFilesSplitRatio,
  clampExplorerWidth,
  clampSidebarWidth,
  DEFAULT_EXPLORER_FILES_SPLIT_RATIO,
  DEFAULT_EXPLORER_SIDEBAR_WIDTH,
  DEFAULT_ENVIRONMENT_PANEL_OPACITY,
  DEFAULT_ENVIRONMENT_PANEL_TABS,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_EXPLORER_FILES_SPLIT_RATIO,
  MAX_EXPLORER_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_EXPLORER_FILES_SPLIT_RATIO,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  isRightPanelSurface,
  migratePanelState,
  resolveDefaultRightPanelSurface,
  selectIsAgentListOpen,
  selectIsFileExplorerOpen,
  selectIsRightPanelOpen,
  selectIsTerminalDrawerOpen,
  selectPanelVisibility,
  selectRightPanelActiveSurface,
  type DesktopSidebarState,
  type EnvironmentPanelTabPreference,
  type ExplorerPanelIntent,
  type MobilePanelView,
  type PanelLayoutInput,
  type PanelVisibilityState,
  type RightPanelSurface,
  type SortOption,
} from "./state";
import { isWeb } from "@/constants/platform";
export type { ExplorerTab } from "../explorer-tab-memory";
export type { ExplorerCheckoutContext } from "../explorer-checkout-context";
export type {
  DesktopSidebarState,
  EnvironmentPanelTabPreference,
  ExplorerPanelIntent,
  MobilePanelView,
  PanelLayoutInput,
  PanelVisibilityState,
  RightPanelSurface,
  SortOption,
} from "./state";
export {
  DEFAULT_EXPLORER_FILES_SPLIT_RATIO,
  DEFAULT_EXPLORER_SIDEBAR_WIDTH,
  DEFAULT_ENVIRONMENT_PANEL_OPACITY,
  DEFAULT_ENVIRONMENT_PANEL_TABS,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_EXPLORER_FILES_SPLIT_RATIO,
  MAX_EXPLORER_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_EXPLORER_FILES_SPLIT_RATIO,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  selectIsFileExplorerOpen,
  selectIsRightPanelOpen,
  selectIsTerminalDrawerOpen,
  selectPanelVisibility,
  selectRightPanelActiveSurface,
  resolveDefaultRightPanelSurface,
  isRightPanelSurface,
};

function explorerTabPatchForSurface(surface: RightPanelSurface): { explorerTab?: ExplorerTab } {
  if (surface === "files") {
    return { explorerTab: "files" };
  }
  if (surface === "diff") {
    return { explorerTab: "changes" };
  }
  return {};
}

export interface PanelState {
  // Mobile: which panel is currently shown
  mobileView: MobilePanelView;

  // Desktop: independent sidebar toggles
  desktop: DesktopSidebarState;

  // File explorer settings (shared between mobile/desktop)
  explorerTab: ExplorerTab;
  explorerTabByCheckout: Record<string, ExplorerTab>;
  expandedPathsByWorkspace: Record<string, string[]>;
  diffExpandedPathsByWorkspace: Record<string, string[]>;
  sidebarWidth: number;
  explorerWidth: number;
  explorerSortOption: SortOption;
  explorerFilesSplitRatio: number;
  environmentPanelOpacity: number;
  environmentPanelVisibleTabs: EnvironmentPanelTabPreference[];

  // Actions
  toggleFocusMode: () => void;
  showMobileAgent: () => void;
  showMobileAgentList: () => void;
  toggleMobileAgentList: () => void;
  openDesktopAgentList: () => void;
  closeDesktopAgentList: () => void;
  toggleDesktopAgentList: () => void;
  closeDesktopFileExplorer: () => void;
  openAgentListForLayout: (input: PanelLayoutInput) => void;
  closeAgentListForLayout: (input: PanelLayoutInput) => void;
  toggleAgentListForLayout: (input: PanelLayoutInput) => void;
  openFileExplorerForCheckout: (input: ExplorerPanelIntent) => void;
  toggleFileExplorerForCheckout: (input: ExplorerPanelIntent) => void;

  // Desktop unified right panel + terminal drawer
  toggleTerminalDrawerOpen: () => void;
  setTerminalDrawerOpen: (open: boolean) => void;
  toggleRightPanelOpen: (input?: { isGit?: boolean }) => void;
  openRightPanelSurface: (surface: RightPanelSurface) => void;
  closeRightPanel: () => void;
  setRightPanelActiveSurface: (surface: RightPanelSurface | null) => void;

  // File explorer settings actions
  setExplorerTab: (tab: ExplorerTab) => void;
  setExplorerTabForCheckout: (params: ExplorerCheckoutContext & { tab: ExplorerTab }) => void;
  setExpandedPathsForWorkspace: (workspaceKey: string, paths: string[]) => void;
  setDiffExpandedPathsForWorkspace: (workspaceKey: string, paths: string[]) => void;
  activateExplorerTabForCheckout: (checkout: ExplorerCheckoutContext) => void;
  setSidebarWidth: (width: number) => void;
  setExplorerWidth: (width: number) => void;
  setExplorerSortOption: (option: SortOption) => void;
  setExplorerFilesSplitRatio: (ratio: number) => void;
  setEnvironmentPanelOpacity: (opacity: number) => void;
  toggleEnvironmentPanelTab: (tab: EnvironmentPanelTabPreference) => void;
}

const DEFAULT_DESKTOP_OPEN = isWeb;

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      // Mobile always starts at agent view
      mobileView: "agent",

      // Desktop defaults based on platform
      desktop: {
        agentListOpen: DEFAULT_DESKTOP_OPEN,
        fileExplorerOpen: false,
        focusModeEnabled: false,
        terminalDrawerOpen: false,
        rightPanelOpen: false,
        rightPanelActiveSurface: null,
      },

      // File explorer defaults
      explorerTab: "changes",
      explorerTabByCheckout: {},
      expandedPathsByWorkspace: {},
      diffExpandedPathsByWorkspace: {},
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      explorerWidth: DEFAULT_EXPLORER_SIDEBAR_WIDTH,
      explorerSortOption: "name",
      explorerFilesSplitRatio: DEFAULT_EXPLORER_FILES_SPLIT_RATIO,
      environmentPanelOpacity: DEFAULT_ENVIRONMENT_PANEL_OPACITY,
      environmentPanelVisibleTabs: [...DEFAULT_ENVIRONMENT_PANEL_TABS],

      toggleFocusMode: () =>
        set((state) => {
          const nextFocus = !state.desktop.focusModeEnabled;
          if (!nextFocus) {
            return {
              desktop: { ...state.desktop, focusModeEnabled: false },
            };
          }
          // Entering focus mode collapses chrome that competes with reading.
          return {
            desktop: {
              ...state.desktop,
              focusModeEnabled: true,
              terminalDrawerOpen: false,
              rightPanelOpen: false,
              fileExplorerOpen: false,
              rightPanelActiveSurface: null,
            },
          };
        }),

      showMobileAgent: () =>
        set((state) => {
          if (state.mobileView === "agent") {
            return state;
          }
          return { mobileView: "agent" as const };
        }),

      showMobileAgentList: () =>
        set((state) => {
          if (state.mobileView === "agent-list") {
            return state;
          }
          return { mobileView: "agent-list" as const };
        }),

      toggleMobileAgentList: () =>
        set((state) => ({
          mobileView: state.mobileView === "agent-list" ? "agent" : "agent-list",
        })),

      openDesktopAgentList: () =>
        set((state) => {
          if (state.desktop.agentListOpen) {
            return state;
          }
          return { desktop: { ...state.desktop, agentListOpen: true } };
        }),

      closeDesktopAgentList: () =>
        set((state) => {
          if (!state.desktop.agentListOpen) {
            return state;
          }
          return { desktop: { ...state.desktop, agentListOpen: false } };
        }),

      toggleDesktopAgentList: () =>
        set((state) => ({
          desktop: { ...state.desktop, agentListOpen: !state.desktop.agentListOpen },
        })),

      closeDesktopFileExplorer: () =>
        set((state) => {
          if (!state.desktop.fileExplorerOpen && !state.desktop.rightPanelOpen) {
            return state;
          }
          return {
            desktop: {
              ...state.desktop,
              fileExplorerOpen: false,
              rightPanelOpen: false,
              rightPanelActiveSurface: null,
            },
          };
        }),

      toggleTerminalDrawerOpen: () =>
        set((state) => ({
          desktop: {
            ...state.desktop,
            terminalDrawerOpen: !state.desktop.terminalDrawerOpen,
          },
        })),

      setTerminalDrawerOpen: (open) =>
        set((state) => {
          if (state.desktop.terminalDrawerOpen === open) {
            return state;
          }
          return {
            desktop: { ...state.desktop, terminalDrawerOpen: open },
          };
        }),

      toggleRightPanelOpen: (_input) =>
        set((state) => {
          if (state.desktop.rightPanelOpen) {
            return {
              desktop: {
                ...state.desktop,
                rightPanelOpen: false,
                fileExplorerOpen: false,
                rightPanelActiveSurface: null,
              },
            };
          }
          // Production: open to empty chooser ("Open a surface").
          // Explicit surface open paths use openRightPanelSurface instead.
          return {
            desktop: {
              ...state.desktop,
              rightPanelOpen: true,
              rightPanelActiveSurface: null,
              fileExplorerOpen: false,
            },
          };
        }),

      openRightPanelSurface: (surface) =>
        set((state) => {
          const isFilesDiff = surface === "files" || surface === "diff";
          return {
            desktop: {
              ...state.desktop,
              rightPanelOpen: true,
              rightPanelActiveSurface: surface,
              fileExplorerOpen: isFilesDiff,
            },
            ...explorerTabPatchForSurface(surface),
          };
        }),

      closeRightPanel: () =>
        set((state) => {
          if (!state.desktop.rightPanelOpen && !state.desktop.fileExplorerOpen) {
            return state;
          }
          return {
            desktop: {
              ...state.desktop,
              rightPanelOpen: false,
              fileExplorerOpen: false,
              rightPanelActiveSurface: null,
            },
          };
        }),

      setRightPanelActiveSurface: (surface) =>
        set((state) => {
          if (!surface) {
            return {
              desktop: {
                ...state.desktop,
                rightPanelActiveSurface: null,
                fileExplorerOpen: false,
              },
            };
          }
          const isFilesDiff = surface === "files" || surface === "diff";
          return {
            desktop: {
              ...state.desktop,
              rightPanelOpen: true,
              rightPanelActiveSurface: surface,
              fileExplorerOpen: isFilesDiff,
            },
            ...explorerTabPatchForSurface(surface),
          };
        }),

      openAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return state.mobileView === "agent-list"
              ? state
              : { mobileView: "agent-list" as const };
          }
          return state.desktop.agentListOpen
            ? state
            : { desktop: { ...state.desktop, agentListOpen: true } };
        }),

      closeAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return state.mobileView === "agent" ? state : { mobileView: "agent" as const };
          }
          return state.desktop.agentListOpen
            ? { desktop: { ...state.desktop, agentListOpen: false } }
            : state;
        }),

      toggleAgentListForLayout: ({ isCompact }) =>
        set((state) => {
          if (isCompact) {
            return { mobileView: state.mobileView === "agent-list" ? "agent" : "agent-list" };
          }
          return {
            desktop: { ...state.desktop, agentListOpen: !state.desktop.agentListOpen },
          };
        }),

      openFileExplorerForCheckout: (input) =>
        set((state) => buildOpenFileExplorerPatch(state, input)),

      toggleFileExplorerForCheckout: (input) =>
        set((state) => buildToggleFileExplorerPatch(state, input)),

      setExplorerTab: (tab) => set({ explorerTab: tab }),
      setExplorerTabForCheckout: ({ serverId, cwd, isGit, tab }) =>
        set((state) => {
          const resolvedTab = coerceExplorerTabForCheckout(tab, isGit);
          const key = buildExplorerCheckoutKey(serverId, cwd);
          const nextState: Partial<PanelState> = { explorerTab: resolvedTab };
          if (key) {
            const current = state.explorerTabByCheckout[key];
            if (current !== resolvedTab) {
              nextState.explorerTabByCheckout = {
                ...state.explorerTabByCheckout,
                [key]: resolvedTab,
              };
            }
          }
          return nextState;
        }),
      setExpandedPathsForWorkspace: (workspaceKey, paths) =>
        set((state) => ({
          expandedPathsByWorkspace: { ...state.expandedPathsByWorkspace, [workspaceKey]: paths },
        })),
      setDiffExpandedPathsForWorkspace: (workspaceKey, paths) =>
        set((state) => ({
          diffExpandedPathsByWorkspace: {
            ...state.diffExpandedPathsByWorkspace,
            [workspaceKey]: paths,
          },
        })),
      activateExplorerTabForCheckout: (checkout) =>
        set((state) => ({
          explorerTab: resolveExplorerTabForCheckout({
            serverId: checkout.serverId,
            cwd: checkout.cwd,
            isGit: checkout.isGit,
            explorerTabByCheckout: state.explorerTabByCheckout,
          }),
        })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setExplorerWidth: (width) => set({ explorerWidth: clampExplorerWidth(width) }),
      setExplorerSortOption: (option) => set({ explorerSortOption: option }),
      setExplorerFilesSplitRatio: (ratio) =>
        set({
          explorerFilesSplitRatio: Number.isFinite(ratio)
            ? clampExplorerFilesSplitRatio(ratio)
            : DEFAULT_EXPLORER_FILES_SPLIT_RATIO,
        }),
      setEnvironmentPanelOpacity: (opacity) =>
        set({ environmentPanelOpacity: clampEnvironmentPanelOpacity(opacity) }),
      toggleEnvironmentPanelTab: (tab) =>
        set((state) => {
          const isVisible = state.environmentPanelVisibleTabs.includes(tab);
          if (isVisible && state.environmentPanelVisibleTabs.length === 1) {
            return state;
          }
          return {
            environmentPanelVisibleTabs: isVisible
              ? state.environmentPanelVisibleTabs.filter((candidate) => candidate !== tab)
              : DEFAULT_ENVIRONMENT_PANEL_TABS.filter(
                  (candidate) =>
                    candidate === tab || state.environmentPanelVisibleTabs.includes(candidate),
                ),
          };
        }),
    }),
    {
      name: "panel-state",
      version: 19,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persistedState, version) =>
        migratePanelState(persistedState, version, { isWeb }) as unknown as PanelState,
      partialize: (state) => ({
        mobileView: state.mobileView,
        desktop: state.desktop,
        explorerTab: state.explorerTab,
        explorerTabByCheckout: state.explorerTabByCheckout,
        expandedPathsByWorkspace: state.expandedPathsByWorkspace,
        diffExpandedPathsByWorkspace: state.diffExpandedPathsByWorkspace,
        sidebarWidth: state.sidebarWidth,
        explorerWidth: state.explorerWidth,
        explorerSortOption: state.explorerSortOption,
        explorerFilesSplitRatio: state.explorerFilesSplitRatio,
        environmentPanelOpacity: state.environmentPanelOpacity,
        environmentPanelVisibleTabs: state.environmentPanelVisibleTabs,
      }),
    },
  ),
);

/**
 * Hook that provides platform-aware panel state.
 *
 * On mobile, uses the state machine (mobileView).
 * On desktop, uses independent booleans (desktop.agentListOpen, desktop.fileExplorerOpen).
 *
 * @param isMobile - Whether the current breakpoint is mobile
 */
export function usePanelState(isMobile: boolean) {
  const isAgentListOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isMobile }),
  );
  const isFileExplorerOpen = usePanelStore((state) =>
    selectIsFileExplorerOpen(state, { isCompact: isMobile }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const openAgentListForLayout = usePanelStore((state) => state.openAgentListForLayout);
  const closeAgentListForLayout = usePanelStore((state) => state.closeAgentListForLayout);
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const explorerTab = usePanelStore((state) => state.explorerTab);
  const explorerTabByCheckout = usePanelStore((state) => state.explorerTabByCheckout);
  const explorerWidth = usePanelStore((state) => state.explorerWidth);
  const explorerSortOption = usePanelStore((state) => state.explorerSortOption);
  const explorerFilesSplitRatio = usePanelStore((state) => state.explorerFilesSplitRatio);
  const setExplorerTab = usePanelStore((state) => state.setExplorerTab);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const activateExplorerTabForCheckout = usePanelStore(
    (state) => state.activateExplorerTabForCheckout,
  );
  const setExplorerWidth = usePanelStore((state) => state.setExplorerWidth);
  const setExplorerSortOption = usePanelStore((state) => state.setExplorerSortOption);
  const setExplorerFilesSplitRatio = usePanelStore((state) => state.setExplorerFilesSplitRatio);

  return {
    isAgentListOpen,
    isFileExplorerOpen,
    openAgentList: () => openAgentListForLayout({ isCompact: isMobile }),
    closeAgentList: () => closeAgentListForLayout({ isCompact: isMobile }),
    closeFileExplorer: isMobile ? showMobileAgent : closeDesktopFileExplorer,
    toggleAgentList: () => toggleAgentListForLayout({ isCompact: isMobile }),
    explorerTab,
    explorerTabByCheckout,
    explorerWidth,
    explorerSortOption,
    explorerFilesSplitRatio,
    setExplorerTab,
    setExplorerTabForCheckout,
    activateExplorerTabForCheckout,
    setExplorerWidth,
    setExplorerSortOption,
    setExplorerFilesSplitRatio,
  };
}
