/** Floor for setTerminalDrawer; matches ui-layout TERMINAL_DRAWER_MIN. */
export const TERMINAL_DRAWER_MIN = 180
/** Open height written by toggleTerminalDrawer; matches ui-layout TERMINAL_DRAWER_DEFAULT. */
export const TERMINAL_DRAWER_DEFAULT = 280

/** Drawer height ceiling as a fraction of the viewport. */
export const MAX_DRAWER_HEIGHT_RATIO = 0.75

/**
 * Ceiling for the terminal drawer in px.
 * @param viewportHeight - window.innerHeight (or a test double).
 * @returns at least TERMINAL_DRAWER_MIN.
 */
export function maxDrawerHeight(viewportHeight: number): number {
  return Math.max(TERMINAL_DRAWER_MIN, Math.floor(viewportHeight * MAX_DRAWER_HEIGHT_RATIO))
}

/**
 * Clamp a requested drawer height into TERMINAL_DRAWER_MIN ..= 75% viewport.
 * @param height - requested height in px.
 * @param viewportHeight - window.innerHeight (or a test double).
 * @returns the clamped height.
 */
export function clampDrawerHeight(height: number, viewportHeight: number): number {
  const safe = Number.isFinite(height) ? height : TERMINAL_DRAWER_MIN
  return Math.min(Math.max(Math.round(safe), TERMINAL_DRAWER_MIN), maxDrawerHeight(viewportHeight))
}
