interface SidebarAnimationSyncInput {
  previousIsOpen: boolean;
  nextIsOpen: boolean;
  previousWindowWidth: number;
  nextWindowWidth: number;
}

interface SidebarAnimationTargetInput {
  isOpen: boolean;
  windowWidth: number;
  sidebarWidth?: number;
}

interface DesktopSidebarResizeStateInput {
  storedWidth: number;
  viewportWidth: number;
  minWidth: number;
  maxWidth: number;
  minContentWidth: number;
}

interface SidebarAnimationTargets {
  translateX: number;
  backdropOpacity: number;
}

interface DesktopSidebarResizeState {
  width: number;
  maxWidth: number;
}

/**
 * Whether sidebar open/width animation state needs to resync with the latest props
 * @param input Previous and next open/window-width values
 * @returns True when open state or window width changed
 */
export function shouldSyncSidebarAnimation(input: SidebarAnimationSyncInput): boolean {
  return (
    input.previousIsOpen !== input.nextIsOpen || input.previousWindowWidth !== input.nextWindowWidth
  );
}

/**
 * Computes left sidebar translate/backdrop targets for the current open state
 * @param input Open flag, window width, and optional measured sidebar width
 * @returns Translate-X and backdrop opacity targets for the left drawer
 */
export function getLeftSidebarAnimationTargets(
  input: SidebarAnimationTargetInput,
): SidebarAnimationTargets {
  const sidebarWidth = resolveSidebarAnimationWidth(input);
  return {
    translateX: input.isOpen || sidebarWidth === 0 ? 0 : -sidebarWidth,
    backdropOpacity: input.isOpen ? 1 : 0,
  };
}

/**
 * Computes right sidebar translate/backdrop targets for the current open state
 * @param input Open flag, window width, and optional measured sidebar width
 * @returns Translate-X and backdrop opacity targets for the right drawer
 */
export function getRightSidebarAnimationTargets(
  input: SidebarAnimationTargetInput,
): SidebarAnimationTargets {
  const sidebarWidth = resolveSidebarAnimationWidth(input);
  return {
    translateX: input.isOpen ? 0 : sidebarWidth,
    backdropOpacity: input.isOpen ? 1 : 0,
  };
}

function resolveSidebarAnimationWidth(input: SidebarAnimationTargetInput): number {
  if (typeof input.sidebarWidth === "number" && Number.isFinite(input.sidebarWidth)) {
    return Math.max(0, input.sidebarWidth);
  }
  if (Number.isFinite(input.windowWidth)) {
    return Math.max(0, input.windowWidth);
  }
  return 0;
}

/**
 * Soft .drawer: width 86%, max-width 300.
 * @param windowWidth Viewport width in CSS pixels
 * @returns Drawer width clamped to the Soft mobile drawer geometry
 */
export function getMobileSidebarWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return 300;
  }
  const preferredWidth = windowWidth * 0.86;
  return Math.round(Math.min(windowWidth, Math.min(300, preferredWidth)));
}

/**
 * Clamps a stored desktop sidebar width against viewport and content constraints
 * @param input Stored width, viewport, and min/max geometry limits
 * @returns The effective width and max width allowed for the current viewport
 */
export function getDesktopSidebarResizeState(
  input: DesktopSidebarResizeStateInput,
): DesktopSidebarResizeState {
  const availableMaxWidth = Number.isFinite(input.viewportWidth)
    ? input.viewportWidth - input.minContentWidth
    : input.maxWidth;
  const maxWidth = Math.max(input.minWidth, Math.min(input.maxWidth, availableMaxWidth));
  const storedWidth = Number.isFinite(input.storedWidth) ? input.storedWidth : input.minWidth;
  return {
    width: Math.max(input.minWidth, Math.min(maxWidth, storedWidth)),
    maxWidth,
  };
}
