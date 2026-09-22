/**
 * Viewport fit policy shared by every xterm pane (drawer and surface).
 * Zero-size hosts and mid-layout PTY resizes are skipped so a collapsed
 * drawer or in-progress split never becomes a 1-row ConPTY.
 */

/** Second fit after mount, once CSS grid/flex has a used box. */
export const FIT_SETTLE_MS = 30

/**
 * Delay before `ptyResize`. FitAddon updates the local grid immediately;
 * notifying the PTY on every split step makes PowerShell reprint the prompt
 * against a 1-row / 2-col ConPTY.
 */
export const PTY_RESIZE_DEBOUNCE_MS = 150

/**
 * Whether FitAddon can measure this host. The check is on the padding-less
 * content box: a collapsed drawer or a 0-width surfaces column leaves the
 * host with only its padding (`clientWidth` 8 for a 4px inset), and fitting
 * that would clamp the grid to FitAddon's 2-column minimum and squeeze the
 * live ConPTY with it.
 * @param el - the xterm host element.
 * @returns true when both content-box axes are positive.
 */
export function hostHasFitSize(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView
  const style = view === null ? undefined : view.getComputedStyle(el)
  const pad = (value: string | undefined): number => {
    const parsed = Number.parseFloat(value ?? '')
    return Number.isFinite(parsed) ? parsed : 0
  }
  const padX = pad(style?.paddingLeft) + pad(style?.paddingRight)
  const padY = pad(style?.paddingTop) + pad(style?.paddingBottom)
  return el.clientWidth - padX > 0 && el.clientHeight - padY > 0
}

/**
 * xterm `minimumContrastRatio`. `1` disables boosting so dim vs info stays
 * whatever the TUI emitted. WCAG 4.5 flattened those two toward the same
 * luminance on the opaque well. Ghostty does not remap contrast.
 */
export const TERMINAL_MINIMUM_CONTRAST = 1

/**
 * Whether a refit may keep following output to the bottom. Only a viewport
 * already resting on the last line follows; anywhere above, the user is
 * reading scrollback and the refit must not move it.
 * @param buffer - xterm's active buffer, when the renderer exposes one.
 * @returns true when the viewport is at (or has no measurable) bottom.
 */
export function shouldFollowOutput(buffer: { viewportY?: number, baseY?: number } | undefined): boolean {
  if (buffer === undefined) return true
  if (typeof buffer.viewportY !== 'number' || typeof buffer.baseY !== 'number') return true
  return buffer.viewportY >= buffer.baseY
}
