/** Readiness event for a terminal renderer stream key */
export interface TerminalRendererReadyChange {
  streamKey: string;
  isReady: boolean;
}

/**
 * Applies a renderer ready/unready event to the currently tracked ready stream key
 * @param currentReadyStreamKey Stream key currently considered ready, if any
 * @param change Incoming ready-state change for a stream key
 * @returns The updated ready stream key, or null when none is ready
 */
export function applyTerminalRendererReadyChange(
  currentReadyStreamKey: string | null,
  change: TerminalRendererReadyChange,
): string | null {
  if (change.isReady) {
    return change.streamKey;
  }

  return currentReadyStreamKey === change.streamKey ? null : currentReadyStreamKey;
}

/**
 * Whether a ready-state change should trigger replaying the terminal snapshot
 * @param input Ready-state change and the stream key owned by this terminal
 * @returns True when the change marks this terminal's stream as ready
 */
export function shouldReplayTerminalSnapshotForRenderer(input: {
  change: TerminalRendererReadyChange;
  terminalStreamKey: string;
}): boolean {
  return input.change.isReady && input.change.streamKey === input.terminalStreamKey;
}

/**
 * Whether the terminal loading overlay should stay visible for the focused workspace
 * @param input Focus, attach, error, and ready-stream state for the terminal pane
 * @returns True while focused, not in error, and still attaching or not renderer-ready
 */
export function shouldShowTerminalLoadingOverlay(input: {
  isWorkspaceFocused: boolean;
  hasStreamError: boolean;
  isAttaching: boolean;
  rendererReadyStreamKey: string | null;
  terminalStreamKey: string;
}): boolean {
  return (
    input.isWorkspaceFocused &&
    !input.hasStreamError &&
    (input.isAttaching || input.rendererReadyStreamKey !== input.terminalStreamKey)
  );
}
