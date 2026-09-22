import { UnistylesRuntime } from "react-native-unistyles";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { updateDesktopWindowControls } from "@/desktop/electron/window";
import {
  dimDesktopWindowControlsBackground,
  getDesktopWindowControlsBackground,
} from "@/desktop/electron/window-controls";

/** Soft Workbench topbar is 48px; native caption buttons sit in that same row. */
const SOFT_WORKBENCH_WINDOW_CONTROLS_HEIGHT = 48;

interface ThemeColorsForWindowControls {
  readonly foreground?: string;
  readonly foregroundMuted: string;
  readonly surface0: string;
  readonly surfaceSidebar: string;
  readonly surfaceWorkspace: string;
}

function readThemeColors(): ThemeColorsForWindowControls | null {
  try {
    const theme = UnistylesRuntime.getTheme() as { colors?: ThemeColorsForWindowControls };
    return theme.colors ?? null;
  } catch {
    return null;
  }
}

/**
 * Syncs native title-bar caption colors to match (or leave) the Soft command-center dimmer.
 * Must run before opening and after closing so Electron overlay never paints a bright frame.
 * @param open Whether command center is (or will be) open
 */
export async function syncDesktopWindowControlsForCommandCenter(open: boolean): Promise<void> {
  const colors = readThemeColors();
  if (!colors) {
    return;
  }

  const baseChromeBackground =
    colors.surfaceWorkspace || getDesktopWindowControlsBackground(colors);
  const backgroundColor = open
    ? dimDesktopWindowControlsBackground(baseChromeBackground)
    : baseChromeBackground;

  try {
    await updateDesktopWindowControls({
      height: SOFT_WORKBENCH_WINDOW_CONTROLS_HEIGHT,
      backgroundColor,
      foregroundColor: colors.foregroundMuted,
    });
  } catch (error) {
    console.warn("[DesktopWindow] Failed to sync window controls for command center", error);
  }
}

/**
 * Dims native window controls first, then opens command center (no bright flash under the dimmer).
 */
export async function openCommandCenter(): Promise<void> {
  if (useKeyboardShortcutsStore.getState().commandCenterOpen) {
    return;
  }
  await syncDesktopWindowControlsForCommandCenter(true);
  useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
}

/**
 * Closes command center first, then restores native window controls (no leftover dim after dismiss).
 */
export async function closeCommandCenter(): Promise<void> {
  if (!useKeyboardShortcutsStore.getState().commandCenterOpen) {
    return;
  }
  useKeyboardShortcutsStore.getState().setCommandCenterOpen(false);
  await syncDesktopWindowControlsForCommandCenter(false);
}
