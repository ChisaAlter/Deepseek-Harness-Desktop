import { StyleSheet } from "react-native-unistyles";
import { darkTheme, aemeathTheme, chisakiTheme, lightTheme, liquidNeonTheme } from "./theme";

StyleSheet.configure({
  themes: {
    light: lightTheme,
    dark: darkTheme,
    liquidNeon: liquidNeonTheme,
    chisaki: chisakiTheme,
    aemeath: aemeathTheme,
  },
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
  },
});

// Type augmentation for TypeScript
interface AppThemes {
  light: typeof lightTheme;
  dark: typeof darkTheme;
  liquidNeon: typeof liquidNeonTheme;
  chisaki: typeof chisakiTheme;
  aemeath: typeof aemeathTheme;
}

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
