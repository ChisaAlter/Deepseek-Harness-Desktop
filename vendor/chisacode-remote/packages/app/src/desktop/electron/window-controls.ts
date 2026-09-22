interface DesktopWindowControlsColors {
  readonly foreground?: string;
  readonly surface0: string;
  readonly surfaceSidebar: string;
  readonly surfaceWorkspace: string;
}

const DARK_WINDOW_CONTROLS_BACKGROUND = "#181B1A";
const LIGHT_WINDOW_CONTROLS_BACKGROUND = "#ffffff";
const OPAQUE_HEX_COLOR = /^#[\da-f]{6}$/i;
// Matches command-center Soft backdrop (`rgba(20, 23, 31, 0.28)`).
const COMMAND_CENTER_BACKDROP_RGB = { r: 20, g: 23, b: 31 } as const;
const COMMAND_CENTER_BACKDROP_ALPHA = 0.28;

function isOpaqueHexColor(color: string): boolean {
  return OPAQUE_HEX_COLOR.test(color.trim());
}

function shouldUseDarkFallback(foreground: string | undefined): boolean {
  if (!foreground || !isOpaqueHexColor(foreground)) {
    return false;
  }

  const red = Number.parseInt(foreground.slice(1, 3), 16);
  const green = Number.parseInt(foreground.slice(3, 5), 16);
  const blue = Number.parseInt(foreground.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.6;
}

function parseOpaqueHex(color: string): { r: number; g: number; b: number } | null {
  const trimmed = color.trim();
  if (!isOpaqueHexColor(trimmed)) {
    return null;
  }
  return {
    r: Number.parseInt(trimmed.slice(1, 3), 16),
    g: Number.parseInt(trimmed.slice(3, 5), 16),
    b: Number.parseInt(trimmed.slice(5, 7), 16),
  };
}

function toOpaqueHex(rgb: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/**
 * Blends an opaque shell canvas with the Soft command-center dimmer so native
 * title-bar caption buttons match the web backdrop (Electron overlay stays above Web content).
 * @param baseBackground Opaque hex shell color (e.g. surfaceWorkspace)
 * @returns Dimmed opaque hex for titleBarOverlay
 */
export function dimDesktopWindowControlsBackground(baseBackground: string): string {
  const base = parseOpaqueHex(baseBackground);
  if (!base) {
    return baseBackground;
  }
  const alpha = COMMAND_CENTER_BACKDROP_ALPHA;
  const inv = 1 - alpha;
  return toOpaqueHex({
    r: base.r * inv + COMMAND_CENTER_BACKDROP_RGB.r * alpha,
    g: base.g * inv + COMMAND_CENTER_BACKDROP_RGB.g * alpha,
    b: base.b * inv + COMMAND_CENTER_BACKDROP_RGB.b * alpha,
  });
}

export function getDesktopWindowControlsBackground(colors: DesktopWindowControlsColors): string {
  // Soft Workbench: caption overlay matches the shell canvas, not elevated cards (surface0 white).
  const workspaceColor = colors.surfaceWorkspace.trim();
  if (isOpaqueHexColor(workspaceColor)) {
    return workspaceColor;
  }

  const sidebarColor = colors.surfaceSidebar.trim();
  if (isOpaqueHexColor(sidebarColor)) {
    return sidebarColor;
  }

  const titlebarColor = colors.surface0.trim();
  if (isOpaqueHexColor(titlebarColor)) {
    return titlebarColor;
  }

  return shouldUseDarkFallback(colors.foreground)
    ? DARK_WINDOW_CONTROLS_BACKGROUND
    : LIGHT_WINDOW_CONTROLS_BACKGROUND;
}
