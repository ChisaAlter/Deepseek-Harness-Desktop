import { Dimensions } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { getIsElectron, isAndroid, isWeb } from "@/constants/platform";

export const FOOTER_HEIGHT = 60;

// Shared header inner height (excluding safe area insets and border).
// Soft .topbar / .m-header: 48px chrome strip.
export const HEADER_INNER_HEIGHT = 48;
export const HEADER_INNER_HEIGHT_MOBILE = 48;
// Soft .topbar: 48px chrome strip (tabs/tool chrome sit inside).
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 48;
export const HEADER_TOP_PADDING_MOBILE = 4;

// Soft Workbench dimensions shared by the real Electron layout.
export const WORKBENCH_ENVIRONMENT_PANEL_WIDTH = 272;
export const WORKBENCH_ENVIRONMENT_PANEL_INSET = 8;
// Soft Workbench --nav-w.
export const WORKBENCH_SIDEBAR_WIDTH = 260;
// Soft Workbench body: near .a 14.5 / 1.65 — 14/22 keeps Chinese legible.
export const WORKBENCH_BODY_FONT_SIZE = 14;
export const WORKBENCH_BODY_LINE_HEIGHT = 22;
// Soft meta chrome (host/menu chips): 12.5 / 16.
export const WORKBENCH_META_FONT_SIZE = 12.5;
export const WORKBENCH_META_LINE_HEIGHT = 16;
export const WORKBENCH_MICRO_FONT_SIZE = 11;
export const WORKBENCH_MICRO_LINE_HEIGHT = 14;
export const MIN_INTERACTIVE_TARGET_SIZE = 28;
export const WORKBENCH_NEW_CHAT_RADIUS = 12;
export const WORKBENCH_SIDEBAR_GROUP_LINE_HEIGHT = 16;
export const WORKBENCH_TAB_MIN_WIDTH = 160;
export const WORKBENCH_TAB_MAX_WIDTH = 220;
export const WORKBENCH_TAB_ESTIMATED_CHAR_WIDTH = 35 / 3;
export const WORKBENCH_FRAME_HAIRLINE_OFFSET = 2 / 3;
export const WORKBENCH_COMPOSER_HEIGHT = 133;
export const WORKBENCH_COMPOSER_HINT_FONT_SIZE = 11;
export const WORKBENCH_COMPOSER_CONTEXT_ROW_HEIGHT = 28;
export const WORKBENCH_COMPOSER_TEXTAREA_HEIGHT = 28;
export const WORKBENCH_COMPOSER_INPUT_GAP = 6;
export const WORKBENCH_COMPOSER_INPUT_PADDING_VERTICAL = 8;
export const WORKBENCH_COMPOSER_CONTROL_HEIGHT = 28;
export const WORKBENCH_HEADER_HORIZONTAL_PADDING = 14;
export const WORKBENCH_TAB_GAP = 5;
export const WORKBENCH_ENVIRONMENT_TAB_HEIGHT = 28;
export const WORKBENCH_ENVIRONMENT_TAB_RADIUS = 8;
export const WORKBENCH_ENVIRONMENT_DIFF_SUMMARY_HEIGHT = 72;
export const WORKBENCH_ENVIRONMENT_CALLOUT_HEIGHT = 57 + 1 / 3;
export const WORKBENCH_ENVIRONMENT_SECTION_GAP = 8;
export const WORKBENCH_ENVIRONMENT_ACTION_GAP = 6;
export const WORKBENCH_ENVIRONMENT_ACTION_MARGIN_BOTTOM = 10;
export const WORKBENCH_ENVIRONMENT_BRANCH_LINE_HEIGHT = 16;
export const WORKBENCH_ENVIRONMENT_CALLOUT_TITLE_LINE_HEIGHT = 18;
export const WORKBENCH_ENVIRONMENT_CALLOUT_TEXT_LINE_HEIGHT = 16;
// Soft floating inspector elevation: --shadow-soft base with a slightly stronger
// outer veil so right-rail cards read clearly against the work surface.
export const WORKBENCH_ENVIRONMENT_PANEL_SHADOW =
  "0 1px 2px rgba(20, 23, 31, 0.05), 0 8px 24px rgba(20, 23, 31, 0.08), 0 16px 40px rgba(20, 23, 31, 0.06)";
// The inspector overlays the work surface instead of shrinking messages or the composer.
export const WORKBENCH_PANE_CONTENT_RIGHT_INSET = 0;
export const WORKBENCH_MESSAGE_LINE_HEIGHT = 22;
// Soft .stream-inner / .role-a document column (pen-bar matches this width).
export const WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH = 800;
// Soft .user-b: max-width min(460px, 88%).
export const WORKBENCH_USER_MESSAGE_MAX_WIDTH = 460;

// Desktop settings geometry — Soft Workbench list/detail (.set-nav 240, .set-h 52).
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 240;
export const SETTINGS_DESKTOP_BACK_HEIGHT = 36;
export const SETTINGS_DESKTOP_NAV_ITEM_HEIGHT = 38;
export const SETTINGS_DESKTOP_HEADER_HEIGHT = 52;
// Soft .set-body vertical lead pad family (runtime content uses 22 28 36).
export const SETTINGS_DESKTOP_BODY_PADDING = 22;
// Soft .set-col: max-width 720.
export const SETTINGS_DESKTOP_CONTENT_OUTER_MAX_WIDTH = 720;
export const SETTINGS_ROW_HORIZONTAL_PADDING = 16;
// Soft .row .title: 14px medium.
export const SETTINGS_ROW_TITLE_FONT_SIZE = 14;
export const SETTINGS_ROW_TITLE_LINE_HEIGHT = 20;
export const SETTINGS_HINT_LINE_HEIGHT = 16;
export const SETTINGS_CONTROL_HEIGHT = 32;
export const SETTINGS_INPUT_WIDTH = 64;
export const SETTINGS_LIQUID_CONTENT_BACKGROUND = "rgba(7, 14, 27, 0.25)";
// Soft .toggle: 44 × 26 pill (design).
export const SETTINGS_SWITCH_WIDTH = 44;
export const SETTINGS_SWITCH_HEIGHT = 26;

// Max width for chat content (stream view, input area, new agent form)
export const MAX_CONTENT_WIDTH = 1008;

/** Conversation column max width as a ratio of pane height (1:1). */
export const CONVERSATION_COLUMN_MAX_WIDTH_RATIO = 1;
/**
 * Soft readability floor as a ratio of pane height (1:3).
 * Used for layout hints only — never forced as CSS minWidth wider than the
 * pane (that locks Electron/window horizontal resize).
 */
export const CONVERSATION_COLUMN_MIN_WIDTH_RATIO = 1 / 3;

export interface ConversationColumnSize {
  /** Resolved column width: min(paneWidth, maxWidth). Never exceeds the pane. */
  width: number;
  /** Soft floor (height/3). Do not apply as a CSS min larger than the pane. */
  minWidth: number;
  /** Hard cap (height × 1:1). */
  maxWidth: number;
}

/**
 * Left-aligned conversation column sizing.
 * - Max width = height (1:1); extra horizontal space is blank on the right.
 * - Width never exceeds the pane, so the window can always shrink horizontally.
 * - Soft min (height/3) is returned for callers that need a readability hint;
 *   it must not be applied as a layout min that expands past the parent.
 * @param paneWidth Measured conversation pane width in px
 * @param paneHeight Measured conversation pane height in px
 * @returns Size bounds, or null when dimensions are not measurable yet
 */
export function resolveConversationColumnSize(
  paneWidth: number,
  paneHeight: number,
): ConversationColumnSize | null {
  if (!(paneWidth > 0) || !(paneHeight > 0)) {
    return null;
  }
  const maxWidth = Math.round(paneHeight * CONVERSATION_COLUMN_MAX_WIDTH_RATIO);
  const minWidth = Math.round(paneHeight * CONVERSATION_COLUMN_MIN_WIDTH_RATIO);
  // Critical: never return a width larger than the pane. Clamping up to
  // minWidth when paneWidth < minWidth was blocking horizontal window resize.
  const width = Math.min(paneWidth, maxWidth);
  return { width, minWidth, maxWidth };
}

/**
 * Caps the conversation column at a 1:1 aspect of its height.
 * Prefer {@link resolveConversationColumnSize} when min width is also needed.
 * @param width Measured conversation pane width in px
 * @param height Measured conversation pane height in px
 * @returns Max content width, or null when not measurable
 */
export function resolveConversationColumnMaxWidth(width: number, height: number): number | null {
  return resolveConversationColumnSize(width, height)?.maxWidth ?? null;
}

// Minimum width for the main chat/agent area when sidebar is open.
// Both left-sidebar and explorer-sidebar reference this independently.
export const MIN_CHAT_WIDTH = 400;

// Horizontal gap between desktop sidebar and the center column.
// Applied as marginRight on the sidebar when open.
export const DESKTOP_SIDEBAR_GAP = 0;

// Width of the tab dropdown menu (new tab "+" button overflow menu)
export const TAB_DROPDOWN_WIDTH = 220;

// Soft .nav-foot: pad 10 10 12 + host 36 + gap 8 + foot icons 34.
export const SIDEBAR_FOOTER_HEIGHT = 100;
export const SIDEBAR_FOOTER_PADDING_LEFT = 10;

// Composer horizontal padding (left/right of the input area)
export const COMPOSER_HORIZONTAL_PADDING = 14;

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 45;

// Windows/Linux custom caption buttons (minimize/maximize/close) — top-right.
// 3×46px hit targets; 48px tall to match Soft Workbench topbar / title drag strip.
export const DESKTOP_WINDOW_CONTROLS_WIDTH = 138;
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = 48;

export {
  getIsElectron as getIsElectronRuntime,
  getIsElectronMac as getIsElectronRuntimeMac,
} from "./platform";

/**
 * Reactive hook for phone/tablet compact shell vs desktop workbench chrome.
 * Always use this instead of reading UnistylesRuntime.breakpoint directly.
 *
 * Electron desktop never flips to compact: width-based breakpoints would
 * replace the workbench (pinned sidebar + PanelLeft collapse control +
 * desktop header) with a mobile hamburger shell when the window is
 * narrowed, which is incorrect for a resizable desktop app. Browser web
 * and native still use xs/sm breakpoints.
 */
export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  if (getIsElectron()) {
    return false;
  }
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
// Android tablets (>= 768dp width) also support pane splits for multi-pane UX.
export function supportsDesktopPaneSplits(): boolean {
  if (isWeb) return true;
  if (isAndroid) {
    const { width } = Dimensions.get("window");
    return width >= 768;
  }
  return false;
}
