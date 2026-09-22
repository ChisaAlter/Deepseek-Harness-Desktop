import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  resolveDefaultRightPanelSurface,
  usePanelStore,
  type RightPanelSurface,
} from "@/stores/panel-store";
import { createWorkspaceBrowser, useBrowserStore } from "@/stores/browser-store";
import { getIsElectron } from "@/constants/platform";

interface UseWorkspaceLayoutChromeInput {
  isMobile: boolean;
  isGitCheckout: boolean;
  workspaceDirectory: string | null;
  liveTerminalIds: readonly string[];
  createTerminal: (input?: { paneId?: string; openInCenterTab?: boolean }) => void;
  isCreateTerminalPending: boolean;
}

/**
 * Production desktop chrome: terminal drawer + unified right panel surfaces.
 * Dual-writes fileExplorerOpen for mobile/explorer compatibility during migration.
 */
export function useWorkspaceLayoutChrome({
  isMobile,
  isGitCheckout,
  workspaceDirectory,
  liveTerminalIds,
  createTerminal,
  isCreateTerminalPending,
}: UseWorkspaceLayoutChromeInput) {
  const terminalDrawerOpen = usePanelStore((state) => state.desktop.terminalDrawerOpen);
  const rightPanelOpen = usePanelStore((state) => state.desktop.rightPanelOpen);
  const rightPanelActiveSurface = usePanelStore((state) => state.desktop.rightPanelActiveSurface);
  const setTerminalDrawerOpen = usePanelStore((state) => state.setTerminalDrawerOpen);
  const toggleRightPanelOpen = usePanelStore((state) => state.toggleRightPanelOpen);
  const openRightPanelSurface = usePanelStore((state) => state.openRightPanelSurface);
  const closeRightPanel = usePanelStore((state) => state.closeRightPanel);
  const [rightPanelBrowserId, setRightPanelBrowserId] = useState<string | null>(null);
  const rightPanelBrowserIdRef = useRef<string | null>(null);

  const activeTerminalId = liveTerminalIds[0] ?? null;
  const canUseRightPanel = Boolean(workspaceDirectory) && !isMobile;
  const showBrowserSurface = getIsElectron();

  const releaseRightPanelBrowser = useCallback(() => {
    const browserId = rightPanelBrowserIdRef.current;
    if (!browserId) {
      return;
    }
    useBrowserStore.getState().removeBrowser(browserId);
    rightPanelBrowserIdRef.current = null;
    setRightPanelBrowserId(null);
  }, []);

  // Production: closing the right panel must not leak browser sessions.
  useEffect(() => {
    if (!rightPanelOpen) {
      releaseRightPanelBrowser();
    }
  }, [releaseRightPanelBrowser, rightPanelOpen]);

  useEffect(() => {
    return () => {
      releaseRightPanelBrowser();
    };
  }, [releaseRightPanelBrowser]);

  const ensureTerminalSession = useCallback(() => {
    if (!activeTerminalId && workspaceDirectory && !isCreateTerminalPending) {
      // Drawer/right-panel terminals own the session without forcing a center tab.
      createTerminal({ openInCenterTab: false });
    }
  }, [activeTerminalId, createTerminal, isCreateTerminalPending, workspaceDirectory]);

  const ensureBrowserSession = useCallback(() => {
    if (!showBrowserSurface) {
      return null;
    }
    if (rightPanelBrowserIdRef.current) {
      return rightPanelBrowserIdRef.current;
    }
    const { browserId } = createWorkspaceBrowser();
    rightPanelBrowserIdRef.current = browserId;
    setRightPanelBrowserId(browserId);
    return browserId;
  }, [showBrowserSurface]);

  const handleToggleTerminalDrawer = useCallback(() => {
    if (isMobile) {
      createTerminal();
      return;
    }
    if (terminalDrawerOpen) {
      setTerminalDrawerOpen(false);
      return;
    }
    setTerminalDrawerOpen(true);
    ensureTerminalSession();
  }, [createTerminal, ensureTerminalSession, isMobile, setTerminalDrawerOpen, terminalDrawerOpen]);

  const handleToggleRightPanel = useCallback(() => {
    if (isMobile) {
      return;
    }
    toggleRightPanelOpen({ isGit: isGitCheckout });
  }, [isGitCheckout, isMobile, toggleRightPanelOpen]);

  const handleOpenRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (isMobile) {
        return;
      }
      openRightPanelSurface(surface);
      if (surface === "terminal") {
        ensureTerminalSession();
        return;
      }
      if (surface === "browser") {
        ensureBrowserSession();
      }
    },
    [ensureBrowserSession, ensureTerminalSession, isMobile, openRightPanelSurface],
  );

  const handleCloseRightPanel = useCallback(() => {
    releaseRightPanelBrowser();
    closeRightPanel();
  }, [closeRightPanel, releaseRightPanelBrowser]);

  const handleCloseTerminalDrawer = useCallback(() => {
    setTerminalDrawerOpen(false);
  }, [setTerminalDrawerOpen]);

  const defaultSurface = useMemo(
    () => resolveDefaultRightPanelSurface(isGitCheckout),
    [isGitCheckout],
  );

  return {
    terminalDrawerOpen: !isMobile && terminalDrawerOpen,
    rightPanelOpen: !isMobile && rightPanelOpen,
    rightPanelActiveSurface: !isMobile ? rightPanelActiveSurface : null,
    activeTerminalId,
    rightPanelBrowserId,
    canUseRightPanel,
    showBrowserSurface,
    defaultSurface,
    handleToggleTerminalDrawer,
    handleToggleRightPanel,
    handleOpenRightPanelSurface,
    handleCloseRightPanel,
    handleCloseTerminalDrawer,
  };
}
