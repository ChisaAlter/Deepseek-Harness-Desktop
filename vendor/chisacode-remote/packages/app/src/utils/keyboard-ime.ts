/**
 * Whether a keyboard event is part of an IME composition session
 * @param event Keyboard-like event with optional composition flags
 * @returns True while IME composition is active (including keyCode 229)
 */
export function isImeComposingKeyboardEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}
