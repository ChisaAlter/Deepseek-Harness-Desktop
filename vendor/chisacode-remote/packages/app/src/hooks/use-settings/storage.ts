import type { QueryClient } from "@tanstack/react-query";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  LEGACY_THEME_MIGRATIONS,
  THEME_PICKER_OPTIONS,
  type LegacyThemeName,
  type ThemeName,
} from "@/styles/theme";

export const APP_SETTINGS_KEY = "@chisacode:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_APP_SETTINGS_KEY = "@chisacode:app-settings";
const LEGACY_SETTINGS_KEY = "@chisacode:settings";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type AppLanguage = "zh-CN" | "en";

const VALID_THEMES = new Set<string>(THEME_PICKER_OPTIONS);
const LEGACY_THEMES = new Set<string>(Object.keys(LEGACY_THEME_MIGRATIONS));
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
const VALID_APP_LANGUAGES = new Set<AppLanguage>(["zh-CN", "en"]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;

export interface AppSettings {
  theme: ThemeName | "auto";
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  showReasoning: boolean;
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: "light",
  language: "zh-CN",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  showReasoning: true,
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface DesktopSettingsBridge {
  isElectron(): boolean;
  loadDesktopSettings(): Promise<DesktopSettings>;
  migrateLegacyDesktopSettings(input: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
    language?: AppLanguage;
  }): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
  desktop: DesktopSettingsBridge;
  allowedThemes?: ReadonlySet<string>;
  fallbackTheme?: ThemeName;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const current =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const next = normalizeAppSettings({ ...current, ...input.updates }, input.deps);
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await deps.storage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>;
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettings(parsed, deps),
      } satisfies AppSettings;
      const serializedNext = JSON.stringify(next);
      if (serializedNext !== stored) {
        await deps.storage.setItem(APP_SETTINGS_KEY, serializedNext);
      }
      return next;
    }

    const legacyAppStored = await deps.storage.getItem(LEGACY_APP_SETTINGS_KEY);
    if (legacyAppStored) {
      const legacyAppParsed = JSON.parse(legacyAppStored) as Partial<AppSettings>;
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettings(legacyAppParsed, deps),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    const legacyStored = await deps.storage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed, deps),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const legacyDesktopSettings = deps.desktop.isElectron()
    ? await loadLegacyDesktopSettingsFromStorage(deps.storage)
    : null;
  const appSettings = await loadAppSettingsFromStorage(deps);

  if (!deps.desktop.isElectron()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await deps.desktop.migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await deps.desktop.loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    language: desktopSettings.language,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

function pickAppSettings(stored: Partial<AppSettings>, deps: SettingsDeps): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const theme = normalizeTheme(stored.theme, deps);
  if (theme) {
    result.theme = theme;
  }
  if (typeof stored.language === "string" && VALID_APP_LANGUAGES.has(stored.language)) {
    result.language = stored.language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  if (typeof stored.showReasoning === "boolean") {
    result.showReasoning = stored.showReasoning;
  }
  return result;
}

function pickAppSettingsFromLegacy(
  legacy: Record<string, unknown>,
  deps: SettingsDeps,
): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const theme = normalizeTheme(legacy.theme, deps);
  if (theme) {
    result.theme = theme;
  }
  return result;
}

function normalizeAppSettings(settings: AppSettings, deps: SettingsDeps): AppSettings {
  const theme = normalizeTheme(settings.theme, deps);
  return {
    ...settings,
    theme: theme ?? DEFAULT_CLIENT_SETTINGS.theme,
  };
}

function normalizeTheme(
  theme: unknown,
  deps?: Pick<SettingsDeps, "allowedThemes" | "fallbackTheme">,
): AppSettings["theme"] | null {
  if (typeof theme !== "string") {
    return null;
  }

  const migratedTheme = LEGACY_THEMES.has(theme)
    ? LEGACY_THEME_MIGRATIONS[theme as LegacyThemeName]
    : theme;

  if (!VALID_THEMES.has(migratedTheme)) {
    return null;
  }
  if (!deps?.allowedThemes || deps.allowedThemes.has(migratedTheme)) {
    return migratedTheme as AppSettings["theme"];
  }
  return deps.fallbackTheme ?? DEFAULT_CLIENT_SETTINGS.theme;
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

async function loadLegacyDesktopSettingsFromStorage(storage: KeyValueStorage): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
  language?: AppLanguage;
} | null> {
  const stored = await loadRendererSettingsPayload(storage);
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
    language?: AppLanguage;
  } = {};

  if (stored.language === "en" || stored.language === "zh-CN") {
    result.language = stored.language;
  }
  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel === "stable" || stored.releaseChannel === "beta") {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<Record<string, unknown> | null> {
  const current = await storage.getItem(APP_SETTINGS_KEY);
  if (current) {
    return JSON.parse(current) as Record<string, unknown>;
  }

  const legacyCurrent = await storage.getItem(LEGACY_APP_SETTINGS_KEY);
  if (legacyCurrent) {
    return JSON.parse(legacyCurrent) as Record<string, unknown>;
  }

  const legacy = await storage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return JSON.parse(legacy) as Record<string, unknown>;
}
