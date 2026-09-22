import { useEffect, useState } from "react";
import type { ViewStyle } from "react-native";
import { StyleSheet, UnistyleDependency, UnistylesRuntime } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// CSS scrollbar properties are supported by React Native Web at runtime
// but are not included in React Native's ViewStyle type definition.
interface WebScrollbarStyle extends ViewStyle {
  scrollbarColor: string;
  scrollbarWidth: string;
}

function readScrollbarStyle(): WebScrollbarStyle {
  try {
    const theme = UnistylesRuntime.getTheme() as Theme;
    return {
      scrollbarColor: `${theme.colors.scrollbarHandle} transparent`,
      scrollbarWidth: "thin",
    };
  } catch {
    return {
      scrollbarColor: "transparent transparent",
      scrollbarWidth: "thin",
    };
  }
}

/**
 * Theme-reactive web scrollbar styling without useUnistyles.
 * Subscribes only to theme changes via StyleSheet.addChangeListener.
 */
export function useWebScrollbarStyle(): WebScrollbarStyle {
  const [style, setStyle] = useState<WebScrollbarStyle>(readScrollbarStyle);

  useEffect(() => {
    setStyle(readScrollbarStyle());
    const dispose = StyleSheet.addChangeListener((dependencies) => {
      if (
        dependencies.includes(UnistyleDependency.Theme) ||
        dependencies.includes(UnistyleDependency.ThemeName)
      ) {
        setStyle(readScrollbarStyle());
      }
    });
    return dispose;
  }, []);

  return style;
}
