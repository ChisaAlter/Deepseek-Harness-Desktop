import type { GhosttyColor, GhosttyTheme } from './ghostty/core.ts'
import { DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE } from './ghostty/surface.ts'

interface TerminalColorProbe {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Paints a color onto a 1x1 canvas and reads the resolved RGBA back. */
function probeTerminalColor(value: string): TerminalColorProbe | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.clearRect(0, 0, 1, 1);
  // A color string the canvas cannot parse leaves its fillStyle assignment
  // ignored; the sentinel underneath keeps that case from reading as black.
  context.fillStyle = "rgb(7, 8, 9)";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (red === 7 && green === 8 && blue === 9 && alpha === 255) return null;

  return { r: red ?? 0, g: green ?? 0, b: blue ?? 0, a: alpha ?? 255 };
}

/** Copied from ThreadTerminalDrawer `parseTerminalColor`. */
function parseTerminalColor(value: string, fallback: GhosttyColor): GhosttyColor {
  const probe = probeTerminalColor(value);
  if (probe === null || probe.a === 0) return fallback;

  return { r: probe.r, g: probe.g, b: probe.b };
}

/** Copied from ThreadTerminalDrawer `normalizeComputedColor`. */
function normalizeComputedColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return fallback;
  }
  return value ?? fallback;
}

/** The surface treats an omitted family or size as "use the built-in default". */
export function terminalFontOptions(family: string, size: number): { family?: string; size: number } {
  const trimmed = family.trim();
  return trimmed.length > 0 ? { family: trimmed, size } : { size };
}

/**
 * Copied from `terminalThemeFromApp`. Dark also accepts this desktop's
 * `data-ds-dark-theme` because the web client does not set `html.dark`.
 * @param mountElement - the pane host, or body when omitted.
 * @returns a Ghostty theme.
 */
export function terminalThemeFromApp(mountElement?: HTMLElement | null): GhosttyTheme {
  const isDark =
    document.documentElement.classList.contains("dark") ||
    document.body.hasAttribute("data-ds-dark-theme");
  const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)";
  const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)";
  const drawerSurface =
    mountElement?.closest(".thread-terminal-drawer") ??
    document.querySelector(".thread-terminal-drawer") ??
    document.body;
  const drawerStyles = getComputedStyle(drawerSurface);
  const bodyStyles = getComputedStyle(document.body);
  const background = normalizeComputedColor(
    drawerStyles.backgroundColor,
    normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground),
  );
  const foreground = normalizeComputedColor(
    drawerStyles.color,
    normalizeComputedColor(bodyStyles.color, fallbackForeground),
  );

  const backgroundProbe = probeTerminalColor(background);

  return {
    background:
      backgroundProbe === null || backgroundProbe.a === 0
        ? isDark
          ? { r: 14, g: 18, b: 24 }
          : { r: 255, g: 255, b: 255 }
        : { r: backgroundProbe.r, g: backgroundProbe.g, b: backgroundProbe.b },
    // The pane fill carries glass alpha while a backdrop is live; the
    // renderer then clears to the DOM fill instead of compositing a second
    // mix on top of it.
    backgroundOpacity: backgroundProbe === null ? 1 : backgroundProbe.a / 255,
    foreground: parseTerminalColor(
      foreground,
      isDark ? { r: 237, g: 241, b: 247 } : { r: 28, g: 33, b: 41 },
    ),
    cursor: isDark ? { r: 180, g: 203, b: 255 } : { r: 38, g: 56, b: 78 },
    // Matches the xterm selection overlays this renderer replaced; the text
    // color underneath is left unchanged for contrast in both themes.
    selectionBackground: isDark ? "rgba(180, 203, 255, 0.25)" : "rgba(37, 63, 99, 0.2)",
  };
}

function isResolvedFontFamily(value: string): boolean {
  return value !== '' && !value.includes('var(')
}

function resolvedFontFamily(el: HTMLElement): string {
  const probe = el.ownerDocument.createElement('span')
  probe.style.fontFamily = 'var(--dsw-font-family-terminal, var(--ds-font-family-code))'
  el.appendChild(probe)
  const computed = getComputedStyle(probe).fontFamily.trim()
  probe.remove()
  if (isResolvedFontFamily(computed)) return computed
  const styles = getComputedStyle(el)
  const terminal = styles.getPropertyValue('--dsw-font-family-terminal').trim()
  if (isResolvedFontFamily(terminal)) return terminal
  const code = styles.getPropertyValue('--ds-font-family-code').trim()
  if (isResolvedFontFamily(code)) return code
  return DEFAULT_TERMINAL_FONT_FAMILY
}

function resolvedFontSize(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue('--dsw-font-size-code').trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TERMINAL_FONT_SIZE
}

export const FALLBACK_TERMINAL_FONT_FAMILY = DEFAULT_TERMINAL_FONT_FAMILY

export type XtermFont = {
  fontFamily: string
  fontSize: number
}

export function readXtermFont(el: HTMLElement): XtermFont {
  return {
    fontFamily: resolvedFontFamily(el),
    fontSize: resolvedFontSize(el),
  }
}
