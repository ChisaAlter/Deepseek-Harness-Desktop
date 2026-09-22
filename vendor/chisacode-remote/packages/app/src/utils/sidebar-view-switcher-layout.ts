/**
 * Width budget for the project/status view switcher.
 *
 * Placement:
 * - `full-width` (default): switcher sits on its own row under search. Only
 *   horizontal rail padding competes for space — Chinese full labels fit from
 *   MIN_SIDEBAR_WIDTH (200) upward.
 * - `inline-top`: legacy top-row share with shell spacer + trailing icons
 *   (kept for tests / if chrome is re-inlined).
 */

export type SidebarViewSwitcherDensity = "full" | "compact" | "icon";
export type SidebarViewSwitcherPlacement = "full-width" | "inline-top";

export interface SidebarViewSwitcherLayoutInput {
  /** Painted rail width in px (desktop store width or mobile drawer width). */
  sidebarWidth: number;
  /** Where the switcher is mounted. */
  placement?: SidebarViewSwitcherPlacement;
  /** Desktop reserves the fixed shell control tile when placement is inline-top. */
  variant?: "desktop" | "mobile";
  /** Extra trailing icon tiles beyond the single search control (inline-top only). */
  trailingIconCount?: number;
}

export interface SidebarViewSwitcherLayout {
  density: SidebarViewSwitcherDensity;
  /** Estimated free width for the segmented control after chrome. */
  switcherAvailableWidth: number;
  /** Hard minWidth so flex cannot crush labels. */
  switcherMinWidth: number;
  showIcons: boolean;
  showLabels: boolean;
  /** Use short i18n keys (项目/状态) instead of full (按项目/按状态). */
  useShortLabels: boolean;
}

const TOP_PADDING_X = 24;
const SHELL_SPACER = 32;
const ICON_TILE = 32;
const ROW_GAP = 6;

/** Icon + full bilingual labels + tab padding/gaps. */
const FULL_SWITCHER_MIN = 176;
/** Short labels only, no per-tab icons. */
const COMPACT_SWITCHER_MIN = 108;
/** Two icon-only tabs + track padding. */
const ICON_SWITCHER_MIN = 72;

function resolveDensity(switcherAvailableWidth: number): SidebarViewSwitcherLayout {
  if (switcherAvailableWidth >= FULL_SWITCHER_MIN) {
    return {
      density: "full",
      switcherAvailableWidth,
      switcherMinWidth: FULL_SWITCHER_MIN,
      showIcons: true,
      showLabels: true,
      useShortLabels: false,
    };
  }

  if (switcherAvailableWidth >= COMPACT_SWITCHER_MIN) {
    return {
      density: "compact",
      switcherAvailableWidth,
      switcherMinWidth: COMPACT_SWITCHER_MIN,
      showIcons: false,
      showLabels: true,
      useShortLabels: true,
    };
  }

  return {
    density: "icon",
    switcherAvailableWidth,
    switcherMinWidth: ICON_SWITCHER_MIN,
    showIcons: true,
    showLabels: false,
    useShortLabels: false,
  };
}

/**
 * Resolves view-switcher density from rail width so Chinese labels stay single-line.
 * @param input Rail width, placement, and chrome variant
 * @returns Density flags and minWidth for the segmented control
 */
export function resolveSidebarViewSwitcherLayout(
  input: SidebarViewSwitcherLayoutInput,
): SidebarViewSwitcherLayout {
  const placement = input.placement ?? "full-width";
  const variant = input.variant ?? "desktop";
  const trailingIconCount = Math.max(1, input.trailingIconCount ?? 1);
  const width =
    typeof input.sidebarWidth === "number" && Number.isFinite(input.sidebarWidth)
      ? Math.max(0, input.sidebarWidth)
      : 0;

  if (placement === "full-width") {
    // Own row under search: only horizontal padding reduces the track.
    return resolveDensity(Math.max(0, width - TOP_PADDING_X));
  }

  const shell = variant === "desktop" ? SHELL_SPACER : 0;
  const trailing = trailingIconCount * ICON_TILE;
  const childCount = (shell > 0 ? 1 : 0) + 1 + trailingIconCount;
  const gaps = Math.max(0, childCount - 1) * ROW_GAP;
  const switcherAvailableWidth = Math.max(0, width - TOP_PADDING_X - shell - trailing - gaps);
  return resolveDensity(switcherAvailableWidth);
}
