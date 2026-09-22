import { useEffect } from "react";
import { withUnistyles } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { updateDesktopWindowControls } from "@/desktop/electron/window";
import {
  dimDesktopWindowControlsBackground,
  getDesktopWindowControlsBackground,
} from "@/desktop/electron/window-controls";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useStatusBarTheme } from "@/hooks/use-status-bar-theme";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import type { Theme } from "@/styles/theme";

/** Soft Workbench topbar is 48px; native caption buttons sit in that same row. */
const SOFT_WORKBENCH_WINDOW_CONTROLS_HEIGHT = 48;

interface DesktopWindowControlsSyncViewProps {
  enabled: boolean;
  baseChromeBackground: string;
  foreground: string;
}

function DesktopWindowControlsSyncView({
  enabled,
  baseChromeBackground,
  foreground,
}: DesktopWindowControlsSyncViewProps) {
  const commandCenterOpen = useKeyboardShortcutsStore((s) => s.commandCenterOpen);
  // Soft Workbench: caption buttons always sit in the 48px chrome row on the shell
  // canvas. Never switch to a separate white 30px band on home / new-session routes.
  // Theme changes while command center is open must keep the dimmed blend; open/close
  // timing is owned by openCommandCenter / closeCommandCenter (pre-sync, no flash).
  const windowChromeBackground = commandCenterOpen
    ? dimDesktopWindowControlsBackground(baseChromeBackground)
    : baseChromeBackground;
  const overlayHeight = SOFT_WORKBENCH_WINDOW_CONTROLS_HEIGHT;

  useEffect(() => {
    if (!enabled || isNative) return;
    void updateDesktopWindowControls({
      height: overlayHeight,
      backgroundColor: windowChromeBackground,
      foregroundColor: foreground,
    }).catch((error) => {
      console.warn("[DesktopWindow] Failed to update window controls overlay", error);
    });
  }, [enabled, windowChromeBackground, foreground, overlayHeight]);

  return null;
}

const desktopWindowControlsThemeMapping = (theme: Theme) => ({
  baseChromeBackground:
    theme.colors.surfaceWorkspace || getDesktopWindowControlsBackground(theme.colors),
  foreground: theme.colors.foregroundMuted,
});

const ThemedDesktopWindowControlsSyncView = withUnistyles(DesktopWindowControlsSyncView);

function DesktopWindowControlsSync({ enabled }: { enabled: boolean }) {
  return (
    <ThemedDesktopWindowControlsSyncView
      enabled={enabled}
      uniProps={desktopWindowControlsThemeMapping}
    />
  );
}

function FaviconStatusSync() {
  useFaviconStatus();
  return null;
}

/**
 * Syncs the Android status bar appearance with the active theme.
 * On non-native platforms, renders nothing (no-op).
 */
function StatusBarThemeSync() {
  if (isNative) {
    return <InnerStatusBarThemeSync />;
  }
  return null;
}

function InnerStatusBarThemeSync() {
  useStatusBarTheme();
  return null;
}

export {
  DesktopWindowControlsSync,
  FaviconStatusSync,
  StatusBarThemeSync,
  InnerStatusBarThemeSync,
};
