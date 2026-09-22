import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  loadAppSettingsFromStorage,
  loadSettingsFromStorage,
  parseTerminalScrollbackLines,
  saveAppSettings,
  type SettingsDeps,
} from "./storage";
import { createFakeDesktopBridge, createInMemoryKeyValueStorage } from "./fakes";
import {
  ANDROID_FALLBACK_THEME,
  ANDROID_THEME_OPTIONS,
  THEME_PICKER_OPTIONS,
} from "@/styles/theme";

const LEGACY_SETTINGS_KEY = "@chisacode:settings";
const LEGACY_APP_SETTINGS_KEY = "@chisacode:app-settings";

function makeDeps(
  overrides: {
    storage?: ReturnType<typeof createInMemoryKeyValueStorage>;
    desktop?: ReturnType<typeof createFakeDesktopBridge>;
    allowedThemes?: SettingsDeps["allowedThemes"];
    fallbackTheme?: SettingsDeps["fallbackTheme"];
  } = {},
): SettingsDeps & {
  storage: ReturnType<typeof createInMemoryKeyValueStorage>;
  desktop: ReturnType<typeof createFakeDesktopBridge>;
} {
  return {
    storage: overrides.storage ?? createInMemoryKeyValueStorage(),
    desktop: overrides.desktop ?? createFakeDesktopBridge(),
    allowedThemes: overrides.allowedThemes,
    fallbackTheme: overrides.fallbackTheme,
  };
}

const androidThemePolicy = {
  allowedThemes: new Set(ANDROID_THEME_OPTIONS),
  fallbackTheme: ANDROID_FALLBACK_THEME,
};

describe("loadAppSettingsFromStorage", () => {
  it("defaults theme to blockchain light when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.theme).toBe("light");
  });

  it("defaults language to Simplified Chinese when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.language).toBe("zh-CN");
  });

  it("defaults reasoning display to enabled when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.showReasoning).toBe(true);
  });

  it("seeds storage with the client defaults when nothing is persisted", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify(DEFAULT_CLIENT_SETTINGS),
    );
  });

  it("loads configured terminal scrollback lines from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ terminalScrollbackLines: 42_000 }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.terminalScrollbackLines).toBe(42_000);
  });

  it("loads configured language from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ language: "en" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.language).toBe("en");
  });

  it("loads configured reasoning display from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ showReasoning: false }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.showReasoning).toBe(false);
  });

  it("normalizes invalid reasoning display values to enabled", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ showReasoning: "no" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.showReasoning).toBe(true);
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  });

  it("loads the chisaki theme from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "chisaki" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.theme).toBe("chisaki");
  });

  it.each(["zinc", "midnight", "claude", "ghostty"] as const)(
    "migrates legacy %s theme to cyber dark and rewrites storage",
    async (legacyTheme) => {
      const deps = makeDeps({
        storage: createInMemoryKeyValueStorage({
          [APP_SETTINGS_KEY]: JSON.stringify({ theme: legacyTheme }),
        }),
      });

      const result = await loadAppSettingsFromStorage(deps);

      expect(result.theme).toBe("dark");
      expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
    },
  );

  it.each(THEME_PICKER_OPTIONS)("keeps the active %s theme", async (theme) => {
    const deps = makeDeps({
      ...androidThemePolicy,
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.theme).toBe(theme);
  });

  it("normalizes an unknown theme to blockchain light and rewrites storage", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "future-theme", language: "en" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.theme).toBe("light");
    expect(result.language).toBe("en");
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  });

  it("normalizes terminal scrollback lines from storage", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ terminalScrollbackLines: 1_000_000.9 }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.terminalScrollbackLines).toBe(1_000_000);
  });

  it("migrates the legacy theme key into the new settings object", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_SETTINGS_KEY]: JSON.stringify({
          theme: "dark",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual({
      theme: "dark",
      language: "zh-CN",
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      showReasoning: true,
    });
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  });

  it("migrates legacy chisacode app settings into chisacode app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_APP_SETTINGS_KEY]: JSON.stringify({
          language: "en",
          terminalScrollbackLines: 42_000,
        }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      language: "en",
      terminalScrollbackLines: 42_000,
    });
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  });
});

describe("loadSettingsFromStorage", () => {
  it("defaults built-in daemon management to enabled when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("defaults release channel to stable when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadSettingsFromStorage(deps);

    expect(result.releaseChannel).toBe("stable");
  });

  it("ignores renderer-owned daemon management state outside Electron", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          theme: "light",
          manageBuiltInDaemon: false,
        }),
      }),
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result).toEqual({
      theme: "light",
      language: "zh-CN",
      manageBuiltInDaemon: true,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      showReasoning: true,
      releaseChannel: "stable",
    });
  });

  it("ignores renderer-owned release channel outside Electron", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ releaseChannel: "beta" }),
      }),
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result.releaseChannel).toBe("stable");
  });

  it("loads language from app settings outside Electron", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ language: "en" }),
      }),
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result.language).toBe("en");
  });

  it("uses desktop settings language inside Electron", async () => {
    const desktop = createFakeDesktopBridge({
      isElectron: true,
      settings: {
        language: "zh-CN",
        releaseChannel: "stable",
        daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
      },
    });
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "light", language: "en" }),
      }),
      desktop,
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result).toEqual({
      theme: "light",
      language: "zh-CN",
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      showReasoning: true,
      manageBuiltInDaemon: true,
      releaseChannel: "stable",
    });
  });

  it("migrates legacy desktop-owned settings through the bridge before reading effective settings", async () => {
    const desktop = createFakeDesktopBridge({
      isElectron: true,
      settings: {
        language: "zh-CN",
        releaseChannel: "beta",
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
      },
    });
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          theme: "light",
          language: "en",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        }),
      }),
      desktop,
    });

    const result = await loadSettingsFromStorage(deps);

    expect(desktop.migrationsApplied).toEqual([
      { manageBuiltInDaemon: false, releaseChannel: "beta", language: "en" },
    ]);
    expect(result).toEqual({
      theme: "light",
      language: "zh-CN",
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      showReasoning: true,
      manageBuiltInDaemon: false,
      releaseChannel: "beta",
    });
  });

  it("does not call the desktop bridge outside Electron", async () => {
    const desktop = createFakeDesktopBridge({ isElectron: false });
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "light" }),
      }),
      desktop,
    });

    const result = await loadSettingsFromStorage(deps);

    expect(desktop.migrationsApplied).toEqual([]);
    expect(result).toEqual({
      theme: "light",
      language: "zh-CN",
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      showReasoning: true,
      manageBuiltInDaemon: true,
      releaseChannel: "stable",
    });
  });
});

describe("saveAppSettings", () => {
  it("saves terminal scrollback through app settings persistence", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify(DEFAULT_CLIENT_SETTINGS),
      }),
    });
    const queryClient = new QueryClient();

    await saveAppSettings({
      queryClient,
      updates: { terminalScrollbackLines: 42_000 },
      deps,
    });

    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        terminalScrollbackLines: 42_000,
      }),
    );
  });

  it("saves language through app settings persistence", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify(DEFAULT_CLIENT_SETTINGS),
      }),
    });
    const queryClient = new QueryClient();

    await saveAppSettings({
      queryClient,
      updates: { language: "en" },
      deps,
    });

    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        language: "en",
      }),
    );
  });

  it("saves reasoning display through app settings persistence", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify(DEFAULT_CLIENT_SETTINGS),
      }),
    });
    const queryClient = new QueryClient();

    await saveAppSettings({
      queryClient,
      updates: { showReasoning: false },
      deps,
    });

    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        showReasoning: false,
      }),
    );
  });
});

describe("parseTerminalScrollbackLines", () => {
  it("clamps negative values to the minimum and rejects non-numeric strings", () => {
    expect(parseTerminalScrollbackLines("-10")).toBe(0);
    expect(parseTerminalScrollbackLines("abc")).toBeNull();
  });
});
