import { useCallback, useEffect, useMemo } from "react";
import { BackHandler } from "react-native";

import { isWeb } from "@/constants/platform";
import { useExplorerOpenGesture } from "@/hooks/use-explorer-open-gesture";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import { selectIsFileExplorerOpen, usePanelStore } from "@/stores/panel-store";

type PanelState = ReturnType<typeof usePanelStore.getState>;

interface UseWorkspaceExplorerActionsInput {
  normalizedServerId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  isMobile: boolean;
  isRouteFocused: boolean;
}

interface UseWorkspaceExplorerActionsResult {
  isExplorerOpen: boolean;
  activeExplorerCheckout: ExplorerCheckoutContext | null;
  openFileExplorerForCheckout: PanelState["openFileExplorerForCheckout"];
  toggleFileExplorerForCheckout: PanelState["toggleFileExplorerForCheckout"];
  closeDesktopFileExplorer: PanelState["closeDesktopFileExplorer"];
  setExplorerTabForCheckout: PanelState["setExplorerTabForCheckout"];
  showMobileAgent: PanelState["showMobileAgent"];
  handleToggleExplorer: () => void;
  explorerToggleAccessibilityState: { expanded: boolean };
  explorerOpenGesture: ReturnType<typeof useExplorerOpenGesture>;
}

/** Owns workspace explorer identity, panel actions, open gesture, and native back handling. */
export function useWorkspaceExplorerActions(
  input: UseWorkspaceExplorerActionsInput,
): UseWorkspaceExplorerActionsResult {
  const { normalizedServerId, workspaceDirectory, isGitCheckout, isMobile, isRouteFocused } = input;
  const isExplorerOpen = usePanelStore((state) =>
    selectIsFileExplorerOpen(state, { isCompact: isMobile }),
  );
  const canOpenExplorerFromAgentView = usePanelStore(
    (state) =>
      state.mobileView === "agent" && !selectIsFileExplorerOpen(state, { isCompact: true }),
  );
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const toggleFileExplorerForCheckout = usePanelStore(
    (state) => state.toggleFileExplorerForCheckout,
  );
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const activeExplorerCheckout = useMemo<ExplorerCheckoutContext | null>(() => {
    if (!normalizedServerId || !workspaceDirectory) {
      return null;
    }
    return { serverId: normalizedServerId, cwd: workspaceDirectory, isGit: isGitCheckout };
  }, [isGitCheckout, normalizedServerId, workspaceDirectory]);

  const openExplorerForWorkspace = useCallback(() => {
    if (activeExplorerCheckout) {
      openFileExplorerForCheckout({ isCompact: isMobile, checkout: activeExplorerCheckout });
    }
  }, [activeExplorerCheckout, isMobile, openFileExplorerForCheckout]);

  const handleToggleExplorer = useCallback(() => {
    if (activeExplorerCheckout) {
      toggleFileExplorerForCheckout({ isCompact: isMobile, checkout: activeExplorerCheckout });
    }
  }, [activeExplorerCheckout, isMobile, toggleFileExplorerForCheckout]);

  const explorerToggleAccessibilityState = useMemo(
    () => ({ expanded: isExplorerOpen }),
    [isExplorerOpen],
  );
  const explorerOpenGesture = useExplorerOpenGesture({
    enabled: isMobile && canOpenExplorerFromAgentView,
    onOpen: openExplorerForWorkspace,
  });

  useEffect(() => {
    if (!isRouteFocused || isWeb || !isExplorerOpen) {
      return;
    }
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isExplorerOpen) {
        showMobileAgent();
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [isExplorerOpen, isRouteFocused, showMobileAgent]);

  return {
    isExplorerOpen,
    activeExplorerCheckout,
    openFileExplorerForCheckout,
    toggleFileExplorerForCheckout,
    closeDesktopFileExplorer,
    setExplorerTabForCheckout,
    showMobileAgent,
    handleToggleExplorer,
    explorerToggleAccessibilityState,
    explorerOpenGesture,
  };
}
