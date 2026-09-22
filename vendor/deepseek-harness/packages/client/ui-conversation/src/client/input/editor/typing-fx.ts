/**
 * Typing-effect detection. The overlay animates a ghost of each freshly
 * typed character without touching the Lexical-owned text DOM; this module
 * holds the pure halves — which updates count as user keystrokes and which
 * text got inserted — so the DOM layer stays thin and the rules stay
 * testable.
 */
import {
  $getRoot,
  COMPOSITION_END_TAG, COMPOSITION_START_TAG, CUT_TAG,
  HISTORIC_TAG, HISTORY_MERGE_TAG, HISTORY_PUSH_TAG,
  PASTE_TAG, SKIP_COLLAB_TAG,
  type EditorState,
} from 'lexical'

/** Inserted text longer than this is a bulk change (autocomplete, fill), not keystrokes. */
export const MAX_TYPING_FX_INSERT_CHARS = 16

/** Upper bound of simultaneously rendered echoes; older ones retire early. */
export const MAX_TYPING_FX_ECHOES = 24

/**
 * Update tags that never echo through the keystroke path. History tags cover
 * undo/redo AND the facade's programmatic writes (seed/restore/batch
 * mutations all ride HISTORY_MERGE_TAG); paste/cut and the composition-start
 * boundary cover the rest of the non-keystroke surface. COMPOSITION_END_TAG
 * stays listed so no caller can reach the plain-diff path with it — a commit
 * is handled by the explicit composition branch in typingFxInsertedText.
 */
const TYPING_FX_SKIP_TAGS: ReadonlySet<string> = new Set<string>([
  PASTE_TAG,
  CUT_TAG,
  HISTORIC_TAG,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  COMPOSITION_START_TAG,
  COMPOSITION_END_TAG,
  SKIP_COLLAB_TAG,
])

/** Plain text of one committed editor state (paragraph separators included). */
export function readEditorText(state: EditorState): string {
  return state.read(() => $getRoot().getTextContent())
}

/**
 * The text a single update inserted, or null when the change was not a pure
 * insertion. Common-prefix/suffix diff: `prev` trimmed of what `next` still
 * carries on both ends leaves exactly the new span. Deletions and
 * replacements report only their inserted part; pure deletions report null.
 */
export function diffInsertedText(prev: string, next: string): string | null {
  if (next.length <= prev.length) return null
  let prefix = 0
  const limit = Math.min(prev.length, next.length)
  while (prefix < limit && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1
  let suffix = 0
  while (
    suffix < limit - prefix
    && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) suffix += 1
  const inserted = next.slice(prefix, next.length - suffix)
  return inserted === '' ? null : inserted
}

/** Length and visibility gate shared by the keystroke and commit paths. */
function echoableSpan(inserted: string | null): string | null {
  if (inserted === null || inserted.length > MAX_TYPING_FX_INSERT_CHARS) return null
  return /^\s+$/.test(inserted) ? null : inserted
}

/**
 * The echoable text of one update, or null when the update must not animate.
 * A change echoes only when it is a user keystroke: an IME composition in
 * flight, a paste/cut, a history operation, a programmatic write, a bulk
 * insertion, and whitespace-only inserts (invisible ghosts) all pass null.
 * A composition-end commit is the one exception — it echoes the span
 * inserted since composition start, diffed against `compositionBase`,
 * because the update's own prev already carries the preview text.
 */
export function typingFxInsertedText(args: {
  readonly prev: string
  readonly next: string
  readonly tags: ReadonlySet<string>
  readonly composing: boolean
  /** Text snapshot from composition start; unset for an orphan end update. */
  readonly compositionBase?: string | null
}): string | null {
  if (args.composing) return null
  if (args.tags.has(COMPOSITION_END_TAG)) {
    return echoableSpan(diffInsertedText(args.compositionBase ?? args.prev, args.next))
  }
  for (const tag of args.tags) {
    if (TYPING_FX_SKIP_TAGS.has(tag)) return null
  }
  return echoableSpan(diffInsertedText(args.prev, args.next))
}
