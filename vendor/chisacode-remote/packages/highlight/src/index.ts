export type { HighlightStyle, HighlightToken } from "./types.js";
export { getParserForFile, isLanguageSupported, getSupportedExtensions } from "./parsers.js";
export { highlightCode, highlightLine } from "./highlighter.js";
export { darkHighlightColors, lightHighlightColors } from "./colors.js";
export {
  isSyntaxThemeId,
  resolveSyntaxColors,
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_OPTIONS,
} from "./themes.js";
export type { SyntaxColors, SyntaxThemeId, SyntaxThemeOption } from "./themes.js";
