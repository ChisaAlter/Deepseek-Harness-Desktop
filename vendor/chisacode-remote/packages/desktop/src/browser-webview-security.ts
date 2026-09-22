/**
 * Security-critical URL validation and keyboard shortcut filtering for
 * browser webviews. Extracted from main.ts so they can be unit-tested
 * without spinning up an Electron process.
 */

/** Keyboard shortcuts the main process forwards into the renderer. */
export const FORWARDED_CHISACODE_SHORTCUT_KEYS = new Set([
  "b",
  "e",
  "w",
  "t",
  "k",
  "/",
  "\\",
  ",",
  ".",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "enter",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);

/**
 * Validates that a webview source URL is on the allowlist (http, https,
 * or about:blank). Returns `true` for undefined — the caller treats a
 * missing src as a no-op.
 */
export function isAllowedBrowserWebviewUrl(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.href === "about:blank"
    );
  } catch {
    return false;
  }
}

/** Detects Cmd/Ctrl+R — browser page refresh (no modifier keys held). */
export function isBrowserRefreshInput(input: {
  type: string;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  control?: boolean;
  key: string;
}): boolean {
  if (input.type !== "keyDown" || input.alt || input.shift) {
    return false;
  }
  return !!(input.meta || input.control) && input.key.toLowerCase() === "r";
}

/** Detects Cmd/Ctrl+L — browser URL bar focus (no modifier keys held). */
export function isBrowserLocationInput(input: {
  type: string;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  control?: boolean;
  key: string;
}): boolean {
  if (input.type !== "keyDown" || input.alt || input.shift) {
    return false;
  }
  return !!(input.meta || input.control) && input.key.toLowerCase() === "l";
}

/** Detects a known ChisaCode shortcut that should be forwarded to the renderer. */
export function isForwardableChisaCodeShortcutInput(input: {
  type: string;
  meta?: boolean;
  control?: boolean;
  key: string;
}): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!input.meta && !input.control) {
    return false;
  }
  return FORWARDED_CHISACODE_SHORTCUT_KEYS.has(input.key.toLowerCase());
}
