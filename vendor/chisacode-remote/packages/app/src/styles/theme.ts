import { darkHighlightColors, lightHighlightColors } from "@chisacode/highlight";

export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
  },

  // Purple scale
  purple: {
    500: "#a855f7",
    600: "#9333ea",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

export const ACTIVE_THEME_NAMES = ["light", "dark", "liquid-neon", "chisaki", "aemeath"] as const;

export type ActiveThemeName = (typeof ACTIVE_THEME_NAMES)[number];
export type ThemeName = ActiveThemeName;

export const THEME_PICKER_OPTIONS = ["auto", ...ACTIVE_THEME_NAMES] as const;

export const LEGACY_THEME_MIGRATIONS = {
  zinc: "dark",
  midnight: "dark",
  claude: "dark",
  ghostty: "dark",
} as const satisfies Record<string, ActiveThemeName>;

export type LegacyThemeName = keyof typeof LEGACY_THEME_MIGRATIONS;

// Diff stat colors — light uses muted tones, dark uses the brighter palette values
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
  diffAdditionBg: "rgba(21, 128, 61, 0.12)", // green-700 at 12% opacity
  diffDeletionBg: "rgba(185, 28, 28, 0.10)", // red-700 at 10% opacity
  diffAdditionHighlightBg: "rgba(21, 128, 61, 0.35)", // green-700 at 35%
  diffDeletionHighlightBg: "rgba(185, 28, 28, 0.30)", // red-700 at 30%
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
  diffAdditionBg: "rgba(74, 222, 128, 0.15)", // green-400 at 15% opacity
  diffDeletionBg: "rgba(239, 68, 68, 0.10)", // red-500 at 10% opacity
  diffAdditionHighlightBg: "rgba(74, 222, 128, 0.40)", // green-400 at 40%
  diffDeletionHighlightBg: "rgba(239, 68, 68, 0.35)", // red-500 at 35%
};

// Soft overlay / backdrop mask — quiet ink wash, not heavy black scrim.
const lightOverlay = "rgba(20, 23, 31, 0.28)";
const darkOverlay = "rgba(0, 0, 0, 0.50)";

// Status colors — semantic signals for success/danger/warning/merged. Used by
// check statuses, PR states, and review decisions. Kept a step darker than the
// raw palette so they read as signals, not neon.
const lightStatusColors = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  statusMerged: "#7c3aed", // purple-600
  statusSuccessBg: "rgba(21, 128, 61, 0.12)", // green-700 at 12%
  statusWarningBg: "rgba(217, 119, 6, 0.12)", // amber-600 at 12%
  statusDangerBg: "rgba(185, 28, 28, 0.14)", // red-700 at 14%
};

const darkStatusColors = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  statusMerged: "#9333ea", // purple-600
  statusSuccessBg: "rgba(22, 163, 74, 0.12)", // green-600 at 12%
  statusWarningBg: "rgba(245, 158, 11, 0.12)", // amber-500 at 12%
  statusDangerBg: "rgba(220, 38, 38, 0.14)", // red-600 at 14%
};

// Semantic color tokens - Layer-based system
const lightSemanticColors = {
  // Soft Workbench light — design/chisacode-surfaces-soft.html + design-language.
  // surface0 = elevated card, surfaceWorkspace = soft shell canvas, surface1 = hover wash.
  surface0: "#ffffff",
  surface1: "#e8eaef",
  surface2: "#eef0f4",
  surface3: "#e2e5ec",
  surface4: "#d5d9e2",
  surfaceDiffEmpty: "#f4f5f8",
  surfaceSidebar: "#f0f1f5",
  surfaceSidebarHover: "#e8eaef",
  surfaceWorkspace: "#f4f5f8",

  foreground: "#14171f",
  foregroundMuted: "#6f7686",
  foregroundFaint: "#9aa1b0",
  foregroundSubtleText: "#3d4452",
  foregroundSoft: "rgba(20, 23, 31, 0.8)",

  scrollbarHandle: "#9aa1b0",

  border: "#e4e6ec",
  borderAccent: "#d5d9e2",

  accent: "#2a6cf0",
  accentBright: "#3d7dff",
  accentNeon: "#5b8cff",
  accentForeground: "#ffffff",

  destructive: "#ef4444",
  destructiveForeground: "#ffffff",
  success: "#18a34a",
  successForeground: "#ffffff",
  warning: "#f59e0b",
  overlay: lightOverlay,
  blockquoteBorder: "#2a6cf0",
  backgroundCss: "#f4f5f8",
  userBubbleGradient: "linear-gradient(135deg, #2a6cf0, #3d7dff 56%, #5b8cff)",

  // Legacy aliases (for gradual migration)
  background: "#f4f5f8",
  popover: "#ffffff",
  popoverForeground: "#14171f",
  primary: "#1a1d26",
  primaryForeground: "#ffffff",
  secondary: "#eef0f4",
  secondaryForeground: "#14171f",
  muted: "#eef0f4",
  mutedForeground: "#6f7686",
  accentBorder: "#d5d9e2",
  input: "#ffffff",
  ring: "#2a6cf0",

  ...lightDiffColors,
  ...lightStatusColors,

  terminal: {
    background: "#f4f5f8",
    foreground: "#14171f",
    cursor: "#2a6cf0",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(42, 108, 240, 0.16)",
    selectionForeground: "#14171f",

    black: "#14171f",
    red: "#dc2626",
    green: "#18a34a",
    yellow: "#ca8a04",
    blue: "#2a6cf0",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#ffffff",

    brightBlack: "#3d4452",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#3d7dff",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#fafafa",
  },
} as const;

// ---------------------------------------------------------------------------
// Dark theme variant builder
// ---------------------------------------------------------------------------

interface DarkThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  surfaceWorkspace: string;
  foreground: string;
  foregroundMuted: string;
  foregroundFaint: string;
  foregroundSubtleText: string;
  /** Foreground at 80% alpha — used for AI assistant prose (T3 `text-foreground/80`).
   *  Implemented as a color token (not container opacity) so code blocks, tables,
   *  and other child surfaces with their own color override stay full-strength. */
  foregroundSoft: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentNeon: string;
  accentForeground?: string;
  destructive: string;
  success: string;
  warning: string;
  backgroundCss: string;
  userBubbleGradient: string;
  ringColor?: string;
}

const darkTerminalAnsi = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

function buildDarkSemanticColors(tint: DarkThemeConfig) {
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surfaceWorkspace,

    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundFaint: tint.foregroundFaint,
    foregroundSubtleText: tint.foregroundSubtleText,
    foregroundSoft: tint.foregroundSoft,

    scrollbarHandle: tint.scrollbarHandle,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentNeon: tint.accentNeon,
    accentForeground: tint.accentForeground ?? "#ffffff",

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.success,
    successForeground: "#ffffff",
    warning: tint.warning,
    overlay: darkOverlay,
    blockquoteBorder: tint.accent,
    backgroundCss: tint.backgroundCss,
    userBubbleGradient: tint.userBubbleGradient,

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: tint.foreground,
    primary: tint.foreground,
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: tint.foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: tint.ringColor ?? tint.accent,

    ...darkDiffColors,
    ...darkStatusColors,

    terminal: {
      background: tint.surface0,
      foreground: "#fafafa",
      cursor: "#fafafa",
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: "#fafafa",
      black: tint.surfaceSidebar,
      ...darkTerminalAnsi,
      brightBlack: tint.surface3,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Soft Workbench dark — design/chisacode-design-language.html [data-theme="dark"].
const chisacodeDarkColors = buildDarkSemanticColors({
  surface0: "#1a1f2a",
  surface1: "#222836",
  surface2: "#232a38",
  surface3: "#2a3140",
  surface4: "#2c3342",
  surfaceDiffEmpty: "#151922",
  surfaceSidebar: "#151922",
  surfaceSidebarHover: "#222836",
  surfaceWorkspace: "#12151c",
  foreground: "#e9edf6",
  foregroundMuted: "#8b93a7",
  foregroundFaint: "#6b7386",
  foregroundSubtleText: "#b6becd",
  foregroundSoft: "rgba(233, 237, 246, 0.8)",
  scrollbarHandle: "#2c3342",
  border: "#2c3342",
  borderAccent: "#3a4254",
  accent: "#6ea0ff",
  accentBright: "#8bb4ff",
  accentNeon: "#6ea0ff",
  destructive: "#ff4772",
  success: "#4ade80",
  warning: "#eab308",
  backgroundCss: "#0b0d12",
  userBubbleGradient:
    "linear-gradient(135deg, rgba(110, 160, 255, 0.92), rgba(110, 160, 255, 0.72))",
  ringColor: "#6ea0ff",
});

const liquidNeonLightColors = {
  surface0: "#06111f",
  surface1: "rgba(255, 255, 255, 0.09)",
  surface2: "rgba(255, 255, 255, 0.13)",
  surface3: "rgba(255, 255, 255, 0.19)",
  surface4: "rgba(255, 255, 255, 0.28)",
  surfaceDiffEmpty: "rgba(255, 255, 255, 0.09)",
  surfaceSidebar: "rgba(255, 255, 255, 0.055)",
  surfaceSidebarHover: "rgba(99, 230, 255, 0.13)",
  surfaceWorkspace: "rgba(8, 18, 32, 0.46)",
  foreground: "#f7fbff",
  foregroundMuted: "#bfd0ea",
  foregroundFaint: "#8fa7c9",
  foregroundSubtleText: "#9fb5d3",
  foregroundSoft: "rgba(247, 251, 255, 0.8)",
  scrollbarHandle: "rgba(255, 255, 255, 0.28)",
  border: "rgba(255, 255, 255, 0.18)",
  borderAccent: "rgba(99, 230, 255, 0.32)",
  accent: "#00a3ff",
  accentBright: "#63e6ff",
  accentNeon: "#a855f7",
  accentForeground: "#ffffff",
  destructive: "#ff6fbe",
  destructiveForeground: "#ffffff",
  success: "#68f6b4",
  successForeground: "#ffffff",
  warning: "#ffe083",
  overlay: darkOverlay,
  blockquoteBorder: "#00a3ff",
  backgroundCss:
    "radial-gradient(circle at 12% -8%, rgba(0, 163, 255, 0.45), transparent 34%), radial-gradient(circle at 92% 10%, rgba(255, 79, 216, 0.3), transparent 30%), linear-gradient(150deg, #06111f 0%, #071726 46%, #0a0820 100%)",
  userBubbleGradient:
    "linear-gradient(135deg, rgba(0, 163, 255, 0.55), rgba(99, 230, 255, 0.32) 48%, rgba(168, 85, 247, 0.45))",
  background: "#06111f",
  popover: "rgba(255, 255, 255, 0.13)",
  popoverForeground: "#f7fbff",
  primary: "#f7fbff",
  primaryForeground: "#06111f",
  secondary: "rgba(255, 255, 255, 0.13)",
  secondaryForeground: "#f7fbff",
  muted: "rgba(255, 255, 255, 0.13)",
  mutedForeground: "#bfd0ea",
  accentBorder: "rgba(99, 230, 255, 0.32)",
  input: "rgba(255, 255, 255, 0.13)",
  ring: "#00a3ff",
  diffAddition: "#4ade80",
  diffDeletion: "#ef4444",
  diffAdditionBg: "rgba(74, 222, 128, 0.15)",
  diffDeletionBg: "rgba(239, 68, 68, 0.10)",
  diffAdditionHighlightBg: "rgba(74, 222, 128, 0.40)",
  diffDeletionHighlightBg: "rgba(239, 68, 68, 0.35)",
  statusSuccess: "#16a34a",
  statusDanger: "#dc2626",
  statusWarning: "#f59e0b",
  statusMerged: "#9333ea",
  statusSuccessBg: "rgba(22, 163, 74, 0.12)",
  statusWarningBg: "rgba(245, 158, 11, 0.12)",
  statusDangerBg: "rgba(220, 38, 38, 0.14)",
  terminal: {
    background: "#06111f",
    foreground: "#F7FBFF",
    cursor: "#63E6FF",
    cursorAccent: "#06111f",
    selectionBackground: "rgba(0,163,255,0.2)",
    selectionForeground: "#F7FBFF",
    black: "#081424",
    red: "#e07070",
    green: "#5dba80",
    yellow: "#d4a44a",
    blue: "#6a9de0",
    magenta: "#b07ad0",
    cyan: "#4aabb8",
    white: "#d4d4d8",
    brightRed: "#e89090",
    brightGreen: "#7ecf9a",
    brightYellow: "#e0be6e",
    brightBlue: "#8ab4e8",
    brightMagenta: "#c49ae0",
    brightCyan: "#6ec2cc",
    brightBlack: "#1a2840",
    brightWhite: "#F7FBFF",
  },
} as const;

export const SPACING = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  xs: 12,
  code: 12,
  codeInline: 13, // base - 3 — inline code is slightly smaller than body text
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
  // Markdown heading/body line heights (fixed px values for consistent rendering)
  heading1: 32,
  heading2: 28,
  heading3: 26,
  heading4: 24,
  heading5: 22,
  heading6: 20,
  body: 22,
  listItem: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

// Soft Workbench radii: --r-sm 8 / --r-md 12 / --r-lg 16 / --r-xl 18–20.
// `base` keeps 6 for 20px plus chips (design .new-btn .plus).
export const BORDER_RADIUS = {
  none: 0,
  sm: 8,
  base: 6,
  md: 12,
  lg: 16,
  xl: 18,
  "2xl": 18,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

const commonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
} as const;

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.35)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    shadowOpacity: 1,
    elevation: 3,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.35)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    shadowOpacity: 1,
    elevation: 10,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.50)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    shadowOpacity: 1,
    elevation: 12,
  },
} as const;

const defaultGlass = {
  enabled: false,
  blurIntensity: 0,
  shell: "transparent",
  panel: "transparent",
  popover: "transparent",
  sheet: "transparent",
  chrome: "transparent",
  border: "transparent",
  highlight: "transparent",
  glow: "transparent",
  tint: "transparent",
  edge: "transparent",
  innerShadow: "transparent",
  specular: "transparent",
  refraction: "transparent",
  caustic: "transparent",
  cssBackdropFilter: "none",
  cardBorder: "transparent",
} as const;

const liquidNeonGlass = {
  enabled: true,
  blurIntensity: 22,
  shell: "rgba(7, 14, 27, 0.3)",
  panel: "rgba(255,255,255,0.08)",
  popover: "rgba(6,17,31,0.94)",
  sheet: "rgba(6,17,31,0.92)",
  chrome: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.16)",
  highlight: "rgba(255,255,255,0.20)",
  glow: "rgba(99,230,255,0.12)",
  tint: "rgba(0,163,255,0.06)",
  edge: "rgba(99,230,255,0.24)",
  innerShadow: "rgba(0,163,255,0.08)",
  specular: "rgba(255,255,255,0.32)",
  refraction: "rgba(168,85,247,0.08)",
  caustic: "rgba(0,163,255,0.10)",
  cssBackdropFilter: "blur(22px) saturate(1.4)",
  cardBorder: "rgba(255,255,255,0.12)",
} as const;

const liquidNeonShadow = {
  sm: {
    shadowColor: "rgba(0,163,255,0.08)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0,163,255,0.12)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(99,230,255,0.16), rgba(168,85,247,0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    isDark: true,
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
    },
    glass: defaultGlass,
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(chisacodeDarkColors);

export const liquidNeonTheme = {
  isDark: true,
  colorScheme: "dark" as const,
  colors: {
    ...liquidNeonLightColors,
    palette: baseColors,
    syntax: darkHighlightColors,
  },
  glass: liquidNeonGlass,
  shadow: liquidNeonShadow,
  ...commonTheme,
} as const;

// Soft Workbench elevation: quiet cards + floating composer only.
// shadowOpacity is required on native; web floating panels should prefer boxShadow.
const lightShadow = {
  sm: {
    shadowColor: "rgba(20, 23, 31, 0.08)",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 1,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(20, 23, 31, 0.12)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    shadowOpacity: 1,
    elevation: 6,
  },
  lg: {
    shadowColor: "rgba(20, 23, 31, 0.14)",
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 36,
    shadowOpacity: 1,
    elevation: 10,
  },
} as const;

/** Widens literal string types to string while preserving object structure */
type Widened<T> = T extends string ? string : { [K in keyof T]: Widened<T[K]> };

function buildLightTheme(semanticColors: Widened<typeof lightSemanticColors>) {
  return {
    isDark: false,
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
    },
    glass: defaultGlass,
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const lightTheme = buildLightTheme(lightSemanticColors);

// Deep rose-black dark theme
const chisakiDarkColors = buildDarkSemanticColors({
  surface0: "#09070a",
  surface1: "#171116",
  surface2: "#211820",
  surface3: "#2b2028",
  surface4: "#56303c",
  surfaceDiffEmpty: "#171116",
  surfaceSidebar: "#0d090d",
  surfaceSidebarHover: "#2a1721",
  surfaceWorkspace: "#120d12",
  foreground: "#f8eef2",
  foregroundMuted: "#b49da7",
  foregroundFaint: "#826c76",
  foregroundSubtleText: "#b49da7",
  foregroundSoft: "rgba(248, 238, 242, 0.8)",
  scrollbarHandle: "#56303c",
  border: "#34242d",
  borderAccent: "#56303c",
  accent: "#b7132f",
  accentBright: "#ff4b67",
  accentNeon: "#ff3158",
  destructive: "#ff3158",
  success: "#2dd49d",
  warning: "#f6b954",
  backgroundCss: "#09070a",
  userBubbleGradient: "linear-gradient(135deg, #b7132f, #ff3158)",
  ringColor: "#b7132f",
});
export const chisakiTheme = buildDarkTheme(chisakiDarkColors);

// Aemeath — 粉蓝浅色
const aemeathSemanticColors = {
  ...lightSemanticColors,

  surface0: "#fbfdff",
  surface1: "#fffefe",
  surface2: "#fff7fb",
  surface3: "#eef9ff",
  surface4: "#dbeef8",
  surfaceDiffEmpty: "#fbfdff",
  surfaceSidebar: "#fff8fc",
  surfaceSidebarHover: "#f8edf5",
  surfaceWorkspace: "#ffffff",

  foreground: "#2b2028",
  foregroundMuted: "#806f7c",
  foregroundFaint: "#a2939f",
  foregroundSubtleText: "#806f7c",
  foregroundSoft: "rgba(43, 32, 40, 0.8)",

  border: "#f0e3eb",
  borderAccent: "#dbeef8",

  accent: "#f2a7c8",
  accentBright: "#f6b3d0",
  accentNeon: "#9bdcf2",
  accentForeground: "#342333",
  destructive: "#d94c78",
  success: "#39af83",
  successForeground: "#ffffff",
  warning: "#d9932f",

  blockquoteBorder: "#f2a7c8",
  backgroundCss: "#fbfdff",
  userBubbleGradient: "linear-gradient(135deg, #f2a7c8, #9bdcf2)",
  background: "#fbfdff",
  popover: "#fffefe",
  popoverForeground: "#2b2028",
  primary: "#2b2028",
  primaryForeground: "#fffefe",
  secondary: "#fff7fb",
  secondaryForeground: "#2b2028",
  muted: "#fff7fb",
  mutedForeground: "#806f7c",
  accentBorder: "#dbeef8",
  input: "#fff7fb",
  ring: "#f2a7c8",

  terminal: {
    ...lightSemanticColors.terminal,
    background: "#FBFDFF",
    foreground: "#2B2028",
    cursor: "#E87BA8",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(232, 123, 168, 0.18)",
    selectionForeground: "#2B2028",
  },
} as const;
export const aemeathTheme = buildLightTheme(aemeathSemanticColors);

// Keep compatibility with existing code
export const theme = darkTheme;

// Export a union type that works for both themes
export type Theme =
  | typeof darkTheme
  | typeof lightTheme
  | typeof chisakiTheme
  | typeof liquidNeonTheme
  | typeof aemeathTheme;

export function isLiquidNeonThemeName(themeName: ThemeName | "auto"): boolean {
  return themeName === "liquid-neon";
}

export const ANDROID_THEME_OPTIONS = THEME_PICKER_OPTIONS;
export const ANDROID_FALLBACK_THEME: ActiveThemeName = "light";

type UnistylesThemeKey = "light" | "dark" | "liquidNeon" | "chisaki" | "aemeath";

export const THEME_TO_UNISTYLES: Record<ThemeName, UnistylesThemeKey> = {
  light: "light",
  dark: "dark",
  "liquid-neon": "liquidNeon",
  chisaki: "chisaki",
  aemeath: "aemeath",
};

export const THEME_SWATCHES: Record<ThemeName, string> = {
  light: "#2a6cf0",
  dark: "#6ea0ff",
  "liquid-neon": "#00a3ff",
  chisaki: "#b7132f",
  aemeath: "#f2a7c8",
};

export const THEME_PREVIEWS: Record<
  ThemeName,
  {
    surface: string;
    border: string;
    line: string;
    accent: string;
  }
> = {
  light: {
    surface: lightSemanticColors.surface0,
    border: lightSemanticColors.border,
    line: lightSemanticColors.surface3,
    accent: lightSemanticColors.accent,
  },
  dark: {
    surface: chisacodeDarkColors.surface0,
    border: chisacodeDarkColors.border,
    line: chisacodeDarkColors.surface3,
    accent: chisacodeDarkColors.accent,
  },
  "liquid-neon": {
    surface: liquidNeonLightColors.surfaceWorkspace,
    border: liquidNeonLightColors.borderAccent,
    line: liquidNeonLightColors.border,
    accent: liquidNeonLightColors.accent,
  },
  chisaki: {
    surface: chisakiDarkColors.surface0,
    border: chisakiDarkColors.borderAccent,
    line: chisakiDarkColors.surface3,
    accent: chisakiDarkColors.accent,
  },
  aemeath: {
    surface: aemeathSemanticColors.surface0,
    border: aemeathSemanticColors.border,
    line: aemeathSemanticColors.surface3,
    accent: aemeathSemanticColors.accent,
  },
};
