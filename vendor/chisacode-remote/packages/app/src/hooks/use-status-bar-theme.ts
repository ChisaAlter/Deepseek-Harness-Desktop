import { useEffect } from "react";
import { StatusBar } from "react-native";
import { StyleSheet, UnistyleDependency, UnistylesRuntime } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

function applyStatusBarTheme(): void {
  try {
    const theme = UnistylesRuntime.getTheme() as Theme;
    StatusBar.setBarStyle(theme.isDark ? "light-content" : "dark-content", true);
    StatusBar.setBackgroundColor("transparent", true);
  } catch {
    // Theme may not be configured yet during bootstrap.
  }
}

/**
 * Syncs the Android status bar barStyle with the active Unistyles theme colorScheme.
 * On Android with edge-to-edge enabled, also sets the status bar background to transparent.
 *
 * Must be mounted inside ProvidersWrapper so it re-runs when the theme changes.
 *
 * - dark / auto-dark themes → light-content (white icons)
 * - light / liquid-neon / auto-light themes → dark-content (dark icons)
 *
 * Uses StyleSheet.addChangeListener instead of useUnistyles so this effect does
 * not re-render React on every Unistyles runtime tick. See docs/unistyles.md.
 */
export function useStatusBarTheme(): void {
  useEffect(() => {
    applyStatusBarTheme();
    const dispose = StyleSheet.addChangeListener((dependencies) => {
      if (
        dependencies.includes(UnistyleDependency.Theme) ||
        dependencies.includes(UnistyleDependency.ThemeName)
      ) {
        applyStatusBarTheme();
      }
    });
    return dispose;
  }, []);
}
