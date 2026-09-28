/** Titlebar panel shortcut matching: skip inputs, textareas, and terminal panes. */

/**
 * True when a keydown target sits inside a Ghostty terminal pane
 * (`[data-terminal-pane]`, the host `ui-user-terminal` renders around its
 * canvas and hidden input textarea).
 * @param target - keydown target element.
 * @returns whether the target belongs to a terminal pane.
 */
function isTerminalPaneTarget(target: HTMLElement): boolean {
  return target.closest('[data-terminal-pane]') !== null
}

/**
 * True when a keydown target is an editable field or the terminal, so panel
 * shortcuts must not steal the key.
 * @param target - event target.
 * @returns whether the shortcut listener should ignore this event.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (isTerminalPaneTarget(target)) return true
  return isTextEntryTarget(target)
}

/**
 * True when a keydown target is a text entry field outside the terminal. The
 * terminal-drawer toggle still applies while typing inside the terminal —
 * Ghostty's input is a textarea inside `[data-terminal-pane]`, which this
 * deliberately does not count — so that shortcut checks this instead of
 * {@link isEditableKeyboardTarget}.
 * @param target - event target.
 * @returns whether the target is a text input outside the terminal.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (isTerminalPaneTarget(target)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  const contentEditable = target.contentEditable
  if (contentEditable === 'true' || contentEditable === 'plaintext-only') return true
  return target.isContentEditable || target.getAttribute('contenteditable') === 'true'
}

/**
 * True for Ctrl/Cmd+\\ (surfaces column).
 * @param event - keydown event.
 * @returns true when the surfaces column shortcut fired.
 */
export function isSurfacesShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  return event.key === '\\' || event.code === 'Backslash'
}

/**
 * True for Ctrl/Cmd+` (terminal drawer). `ui-user-terminal`'s
 * `isTerminalDrawerShortcut` mirrors this chord (cross-package value imports
 * are forbidden); keep the two in sync.
 * @param event - keydown event.
 * @returns true when the terminal drawer shortcut fired.
 */
export function isTerminalShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  return event.key === '`' || event.code === 'Backquote'
}
