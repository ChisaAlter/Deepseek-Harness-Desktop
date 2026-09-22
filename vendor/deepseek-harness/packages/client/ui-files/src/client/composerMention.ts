const SIMPLE_MENTION_PATH_REGEX = /^[^\s@"\\]+$/

export function serializeComposerMentionPath(path: string): string {
  if (SIMPLE_MENTION_PATH_REGEX.test(path)) {
    return path
  }
  return `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function composerFileLinkBasename(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function encodeMarkdownLinkDestination(path: string): string {
  return encodeURI(path)
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
    .replaceAll('\\', '%5C')
}

export function serializeComposerFileLink(path: string): string {
  const label = escapeMarkdownLinkLabel(composerFileLinkBasename(path))
  return `[${label}](${encodeMarkdownLinkDestination(path)})`
}

/**
 * Drag payload type carrying a serialized composer mention. Set on drags that
 * start in the workspace file tree so the composer can tell them apart from
 * OS file drags and plain text selections.
 */
export const COMPOSER_MENTION_DRAG_TYPE = 'application/x-dshd-composer-mention'

export function composerMentionFromTreePath(treePath: string): string | null {
  const relativePath = treePath.replace(/\/+$/, '')
  if (relativePath.length === 0) {
    return null
  }
  return serializeComposerFileLink(relativePath)
}

export function dataTransferHasComposerMention(types: readonly string[]): boolean {
  return types.includes(COMPOSER_MENTION_DRAG_TYPE)
}

/** Composer token under the caret: `@path`, `/command`, or `/model`. */
export type ComposerTriggerKind = 'path' | 'slash-command' | 'slash-model'

/** Standalone slash-command names the composer also recognizes (unused until a caller needs the parser). */
export type ComposerSlashCommand = 'model' | 'plan' | 'default'

/** Active composer trigger span at the caret. */
export interface ComposerTrigger {
  kind: ComposerTriggerKind
  query: string
  rangeStart: number
  rangeEnd: number
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length
  return Math.max(0, Math.min(text.length, Math.floor(cursor)))
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r'
}

/**
 * Detect an active trigger (@path, /command) at the cursor position.
 *
 * Accepts an optional `isWhitespaceChar` override so callers with inline
 * placeholder characters can treat those as token boundaries.
 * @param text - full draft.
 * @param cursorInput - caret offset.
 * @param isWhitespaceChar - optional token-boundary predicate.
 * @returns the live trigger, or null.
 */
export function detectComposerTrigger(
  text: string,
  cursorInput: number,
  isWhitespaceChar?: (char: string) => boolean,
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput)
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const linePrefix = text.slice(lineStart, cursor)

  if (linePrefix.startsWith('/')) {
    const commandMatch = /^\/(\S*)$/.exec(linePrefix)
    if (commandMatch) {
      const commandQuery = commandMatch[1] || ''
      if (commandQuery.toLowerCase() === 'model') {
        return {
          kind: 'slash-model',
          query: '',
          rangeStart: lineStart,
          rangeEnd: cursor,
        }
      }
      return {
        kind: 'slash-command',
        query: commandQuery,
        rangeStart: lineStart,
        rangeEnd: cursor,
      }
    }

    const modelMatch = /^\/model(?:\s+(.*))?$/.exec(linePrefix)
    if (modelMatch) {
      return {
        kind: 'slash-model',
        query: (modelMatch[1] || '').trim(),
        rangeStart: lineStart,
        rangeEnd: cursor,
      }
    }
  }

  const wsCheck = isWhitespaceChar ?? isWhitespace
  let tokenIdx = cursor - 1
  while (tokenIdx >= 0 && !wsCheck(text.charAt(tokenIdx))) {
    tokenIdx -= 1
  }
  const tokenStart = tokenIdx + 1

  const token = text.slice(tokenStart, cursor)
  if (!token.startsWith('@')) {
    return null
  }

  return {
    kind: 'path',
    query: token.slice(1),
    rangeStart: tokenStart,
    rangeEnd: cursor,
  }
}

/**
 * Replace `[rangeStart, rangeEnd)` in `text` and return the next caret.
 * @param text - full draft.
 * @param rangeStart - inclusive start.
 * @param rangeEnd - exclusive end.
 * @param replacement - inserted text.
 * @returns the next draft and caret.
 */
export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart))
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd))
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`
  return { text: nextText, cursor: safeStart + replacement.length }
}
