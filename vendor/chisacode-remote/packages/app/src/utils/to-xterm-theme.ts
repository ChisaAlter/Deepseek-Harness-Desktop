import type { ITheme } from "@xterm/xterm";

import type { Theme } from "@/styles/theme";

type TerminalPalette = Theme["colors"]["terminal"];

/**
 * Maps the app terminal color palette to an xterm.js theme object
 * @param terminal Theme terminal palette tokens
 * @returns xterm-compatible theme colors
 */
export function toXtermTheme(terminal: TerminalPalette): ITheme {
  return {
    background: terminal.background,
    foreground: terminal.foreground,
    cursor: terminal.cursor,
    cursorAccent: terminal.cursorAccent,
    selectionBackground: terminal.selectionBackground,
    selectionForeground: terminal.selectionForeground,

    black: terminal.black,
    red: terminal.red,
    green: terminal.green,
    yellow: terminal.yellow,
    blue: terminal.blue,
    magenta: terminal.magenta,
    cyan: terminal.cyan,
    white: terminal.white,

    brightBlack: terminal.brightBlack,
    brightRed: terminal.brightRed,
    brightGreen: terminal.brightGreen,
    brightYellow: terminal.brightYellow,
    brightBlue: terminal.brightBlue,
    brightMagenta: terminal.brightMagenta,
    brightCyan: terminal.brightCyan,
    brightWhite: terminal.brightWhite,
  };
}
