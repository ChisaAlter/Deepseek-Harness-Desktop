let focusRestoreElement: HTMLElement | null = null;

/**
 * Stores the element that should regain focus after the command center closes
 * @param el Element to restore, or null to clear the stored target
 */
export function setCommandCenterFocusRestoreElement(el: HTMLElement | null): void {
  focusRestoreElement = el;
}

/**
 * Takes and clears the stored command-center focus restore element
 * @returns Previously stored element, or null when none was set
 */
export function takeCommandCenterFocusRestoreElement(): HTMLElement | null {
  const el = focusRestoreElement;
  focusRestoreElement = null;
  return el;
}

/**
 * Clears any stored command-center focus restore element without returning it
 */
export function clearCommandCenterFocusRestoreElement(): void {
  focusRestoreElement = null;
}
