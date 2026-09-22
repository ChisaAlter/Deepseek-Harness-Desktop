import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LayoutChangeEvent } from "react-native";

import {
  resolveConversationColumnSize,
  WORKBENCH_ENVIRONMENT_PANEL_INSET,
} from "@/constants/layout";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import type { WorkspaceEnvironmentDockState } from "@/screens/workspace/workspace-environment-dock-model";

type WorkspaceEnvironmentPanelMode = "auto" | "forced-open" | "forced-closed";
type ExplorerPanelAction = (input: {
  isCompact: boolean;
  checkout: ExplorerCheckoutContext;
}) => void;
type SetExplorerTabForCheckout = (
  input: ExplorerCheckoutContext & { tab: "changes" | "files" },
) => void;

interface UseWorkspaceEnvironmentPanelStateInput {
  panelWidth: number;
  isMobile: boolean;
  isExplorerOpen: boolean;
  activeExplorerCheckout: ExplorerCheckoutContext | null;
  closeDesktopFileExplorer: () => void;
  openFileExplorerForCheckout: ExplorerPanelAction;
  toggleFileExplorerForCheckout: ExplorerPanelAction;
  setExplorerTabForCheckout: SetExplorerTabForCheckout;
}

interface UseWorkspaceEnvironmentPanelStateResult {
  environmentDockState: WorkspaceEnvironmentDockState;
  setEnvironmentDockState: Dispatch<SetStateAction<WorkspaceEnvironmentDockState>>;
  setEnvironmentPanelMode: Dispatch<SetStateAction<WorkspaceEnvironmentPanelMode>>;
  isEnvironmentPanelVisible: boolean;
  handleCenterContentLayout: (event: LayoutChangeEvent) => void;
  handleToggleEnvironmentPanel: () => void;
  handleOpenEnvironmentChanges: () => void;
}

function getEnvironmentExplorerTab(checkout: ExplorerCheckoutContext): "changes" | "files" {
  return checkout.isGit ? "changes" : "files";
}

/**
 * Whether the floating inspector can sit fully in the right gutter without
 * covering the left-aligned conversation column. The panel overlays chat — it
 * does not shrink the stream — so auto-open requires spare blank space on the
 * right only.
 * @param contentWidth Measured center-column width
 * @param panelWidth Floating inspector width
 * @param contentHeight Measured center-column height (drives 1:1 / 1:3 chat bounds)
 * @returns True only when the right gutter fits the panel plus its inset
 */
export function shouldAutoShowEnvironmentPanel(
  contentWidth: number,
  panelWidth: number,
  contentHeight: number,
): boolean {
  if (!(contentWidth > 0) || !(contentHeight > 0) || !(panelWidth > 0)) {
    return false;
  }
  const column = resolveConversationColumnSize(contentWidth, contentHeight);
  // Left-aligned: right gutter is everything past the conversation column.
  const chatWidth = column?.width ?? contentWidth;
  const rightGutter = Math.max(0, contentWidth - chatWidth);
  const panelOccupied = panelWidth + WORKBENCH_ENVIRONMENT_PANEL_INSET;
  return rightGutter >= panelOccupied;
}

/** Owns responsive environment-panel visibility, dock state, and explorer transitions. */
export function useWorkspaceEnvironmentPanelState(
  input: UseWorkspaceEnvironmentPanelStateInput,
): UseWorkspaceEnvironmentPanelStateResult {
  const {
    panelWidth,
    isMobile,
    isExplorerOpen,
    activeExplorerCheckout,
    closeDesktopFileExplorer,
    openFileExplorerForCheckout,
    toggleFileExplorerForCheckout,
    setExplorerTabForCheckout,
  } = input;
  // Soft Workbench: inspector starts closed (header toggle opens it).
  const [environmentPanelMode, setEnvironmentPanelMode] =
    useState<WorkspaceEnvironmentPanelMode>("forced-closed");
  const [centerContentSize, setCenterContentSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [environmentDockState, setEnvironmentDockState] = useState<WorkspaceEnvironmentDockState>({
    open: false,
    activeTab: "git-summary",
  });

  const hasEnoughSpaceForEnvironmentPanel = useMemo(() => {
    // Stay closed until the center column has been measured — never flash open
    // before layout, and never auto-open when the panel would cover chat.
    if (!centerContentSize) {
      return false;
    }
    return shouldAutoShowEnvironmentPanel(
      centerContentSize.width,
      panelWidth,
      centerContentSize.height,
    );
  }, [centerContentSize, panelWidth]);
  // auto → only when right gutter is large enough (see shouldAutoShow…).
  // forced-open → always visible (header toggle); forced-closed → always hidden.
  // Manual close sticks until the user opens again (does not re-auto on resize).
  const isEnvironmentPanelVisible =
    environmentPanelMode === "forced-open" ||
    (environmentPanelMode === "auto" && hasEnoughSpaceForEnvironmentPanel);

  useEffect(() => {
    if (!isMobile && isEnvironmentPanelVisible && isExplorerOpen) {
      closeDesktopFileExplorer();
    }
  }, [closeDesktopFileExplorer, isEnvironmentPanelVisible, isExplorerOpen, isMobile]);

  const handleCenterContentLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCenterContentSize((current) =>
      current?.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const handleToggleEnvironmentPanel = useCallback(() => {
    if (!isEnvironmentPanelVisible) {
      setEnvironmentDockState((state) => ({ ...state, open: true }));
    }
    setEnvironmentPanelMode(isEnvironmentPanelVisible ? "forced-closed" : "forced-open");
    if (!isEnvironmentPanelVisible && isExplorerOpen && activeExplorerCheckout) {
      if (isMobile) {
        toggleFileExplorerForCheckout({
          isCompact: true,
          checkout: activeExplorerCheckout,
        });
      } else {
        closeDesktopFileExplorer();
      }
    }
  }, [
    activeExplorerCheckout,
    closeDesktopFileExplorer,
    isEnvironmentPanelVisible,
    isExplorerOpen,
    isMobile,
    toggleFileExplorerForCheckout,
  ]);

  const handleOpenEnvironmentChanges = useCallback(() => {
    if (!activeExplorerCheckout) {
      return;
    }
    const tab = getEnvironmentExplorerTab(activeExplorerCheckout);
    setExplorerTabForCheckout({
      ...activeExplorerCheckout,
      tab,
    });
    openFileExplorerForCheckout({
      isCompact: isMobile,
      checkout: activeExplorerCheckout,
    });
    // Production: opening Files/Diff right surface always dismisses the floating env card.
    setEnvironmentPanelMode("forced-closed");
    setEnvironmentDockState((state) => ({ ...state, open: false }));
  }, [activeExplorerCheckout, isMobile, openFileExplorerForCheckout, setExplorerTabForCheckout]);

  return {
    environmentDockState,
    setEnvironmentDockState,
    setEnvironmentPanelMode,
    isEnvironmentPanelVisible,
    handleCenterContentLayout,
    handleToggleEnvironmentPanel,
    handleOpenEnvironmentChanges,
  };
}
