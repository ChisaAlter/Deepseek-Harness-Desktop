import { DESKTOP_TRAFFIC_LIGHT_WIDTH } from "@/constants/layout";

/** Soft sidebar search tile — matches left-sidebar `sidebarTopAction`. */
export const DESKTOP_SIDEBAR_CONTROL_SIZE = 32;
/** Gap between the shell control and the first topbar content glyph. */
export const DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP = 12;
/** Horizontal inset from the window edge when traffic lights are absent. */
export const DESKTOP_SIDEBAR_CONTROL_EDGE_INSET = 12;
/**
 * Vertical inset matching Soft desktop sidebar top row (`desktopSidebarTopArea.paddingTop`).
 * Do not center in the 48px strip — that sits 4px higher than the search tile.
 */
export const DESKTOP_SIDEBAR_CONTROL_TOP_INSET = 12;

export interface DesktopSidebarControlInsets {
  left: number;
  top: number;
}

export interface DesktopSidebarControlLayoutInput {
  /** True when the left agent rail is currently painted (not focus-mode hidden). */
  isSidebarVisible: boolean;
  /** Electron macOS traffic-light reserve; 0 on Win/Linux and non-Electron. */
  trafficLightLeft: number;
  /** Electron titlebar height for vertical alignment; 0 when no caption overlay. */
  titlebarTop: number;
}

export interface DesktopSidebarControlLayout {
  /** Absolute position for the shell-level SidebarTrigger. */
  controlInsets: DesktopSidebarControlInsets;
  /**
   * Extra left padding content topbars need so titles don't sit under the
   * fixed control while the left rail is hidden. 0 while the rail is visible
   * (control overlays the sidebar header instead).
   */
  contentLeftPad: number;
}

/**
 * Resolves T3-style shell sidebar control geometry.
 * @param input Visibility + platform caption insets
 * @returns Control position and collapsed content clearance
 */
export function resolveDesktopSidebarControlLayout(
  input: DesktopSidebarControlLayoutInput,
): DesktopSidebarControlLayout {
  const left =
    input.trafficLightLeft > 0 ? input.trafficLightLeft : DESKTOP_SIDEBAR_CONTROL_EDGE_INSET;
  // Lock to Soft nav-top padding (12), same as the search magnifier row.
  const top = DESKTOP_SIDEBAR_CONTROL_TOP_INSET;

  const controlInsets = { left, top };
  if (input.isSidebarVisible) {
    return { controlInsets, contentLeftPad: 0 };
  }

  // Collapsed: content topbars clear the fixed control + gap.
  const contentLeftPad = left + DESKTOP_SIDEBAR_CONTROL_SIZE + DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP;
  return { controlInsets, contentLeftPad };
}

/**
 * Derives traffic-light left inset for the shell control on Electron macOS.
 * @param input Runtime platform flags
 * @returns Left inset in px
 */
export function resolveDesktopSidebarControlTrafficLightLeft(input: {
  isElectron: boolean;
  isMac: boolean;
  isFullscreen: boolean;
}): number {
  if (!input.isElectron || !input.isMac || input.isFullscreen) {
    return 0;
  }
  return DESKTOP_TRAFFIC_LIGHT_WIDTH;
}

/**
 * Left pad for chrome that sits under the fixed shell control while the rail is open.
 * @param trafficLightLeft Electron macOS traffic-light reserve (0 otherwise)
 * @returns Overlay clearance in px
 */
export function resolveDesktopSidebarControlOverlayPad(trafficLightLeft: number): number {
  const left = trafficLightLeft > 0 ? trafficLightLeft : DESKTOP_SIDEBAR_CONTROL_EDGE_INSET;
  return left + DESKTOP_SIDEBAR_CONTROL_SIZE + DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP;
}
