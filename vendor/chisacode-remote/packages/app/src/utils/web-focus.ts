interface FocusWithRetriesOptions {
  focus: () => void;
  isFocused: () => boolean;
  timeoutMs?: number;
  onSuccess?: () => void;
  onTimeout?: () => void;
}

/**
 * Retries focusing an element until focus is observed or a timeout elapses
 * @param options Focus/isFocused callbacks, optional timeout, and success/timeout hooks
 * @returns Cancel function that stops further retry attempts
 */
export function focusWithRetries({
  focus,
  isFocused,
  timeoutMs = 1500,
  onSuccess,
  onTimeout,
}: FocusWithRetriesOptions): () => void {
  let cancelled = false;
  const deadlineMs = Date.now() + timeoutMs;

  const tick = () => {
    if (cancelled) return;

    try {
      focus();
    } catch {
      // ignore
    }

    if (isFocused()) {
      onSuccess?.();
      return;
    }

    if (Date.now() >= deadlineMs) {
      onTimeout?.();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(tick);
    });
  };

  tick();

  return () => {
    cancelled = true;
  };
}
