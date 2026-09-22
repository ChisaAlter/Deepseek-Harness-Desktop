interface HighlightLikeToken {
  text: string;
}

// Preserve row height when a gutter or diff cell is intentionally blank.
// Non-breaking space because the gutter <Text> uses numberOfLines={1}, which
// collapses a plain ASCII space to zero height on web.
/**
 * Formats a diff gutter line number, preserving row height for blank gutters
 * @param lineNumber Line number to display, or null for an empty gutter cell
 * @returns Line number text, or a non-breaking space when blank
 */
export function formatDiffGutterText(lineNumber: number | null): string {
  return lineNumber == null ? "\u00A0" : String(lineNumber);
}

/**
 * Formats diff line content for display, keeping empty rows from collapsing
 * @param content Raw line content, if any
 * @returns Content string, or a single space when empty
 */
export function formatDiffContentText(content: string | null | undefined): string {
  return content && content.length > 0 ? content : " ";
}

/**
 * Whether a highlighted token list contains any non-empty text
 * @param tokens Highlight tokens for a diff line, if any
 * @returns True when at least one token has visible text
 */
export function hasVisibleDiffTokens(tokens: HighlightLikeToken[] | null | undefined): boolean {
  return Boolean(tokens?.some((token) => token.text.length > 0));
}
