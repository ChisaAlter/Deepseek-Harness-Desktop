/**
 * Turn-anchor scroll controller.
 *
 * After the user sends a message the sent row should stay near the top of the
 * usable viewport while the assistant reply grows below it, instead of the
 * list sticking to the bottom. This controller owns that mode state machine:
 *
 *   following-end       list follows the live edge (sticky bottom)
 *   anchoring-new-turn  sent row is pinned near the viewport top; the reply
 *                       grows into the reserved space below
 *   free-scrolling      the user scrolled away; no automatic positioning
 *
 * It is transport-agnostic: measurement and scrolling are injected, so the
 * controller is unit-testable without DOM or list internals. The web strategy
 * provides measurement (estimated row positions) and `scrollByDelta`.
 */

import {
  TURN_ANCHOR_OFFSET_PX,
  getAnchoredTurnMetrics,
  type TurnAnchorMeasurementState,
  type TurnAnchorScrollMode,
} from "./turn-anchor-metrics";

export interface TurnAnchorRequest {
  reason: "message-sent" | "jump-to-end";
  anchorMessageId: string | null;
  requestKey: string;
}

export interface TurnAnchorSnapshot {
  mode: TurnAnchorScrollMode;
  pendingAnchorMessageId: string | null;
}

export interface TurnAnchorMeasurement extends TurnAnchorMeasurementState {
  /** Index of the anchor row in `data`, null until positionable */
  readonly anchorIndex: number | null;
  readonly composerOverlayHeight: number;
}

export interface TurnAnchorControllerDriver {
  destroy: () => void;
  getSnapshot: () => TurnAnchorSnapshot;
  applySendAnchor: (request: TurnAnchorRequest | null) => void;
  detachByUser: () => void;
  handleContentSizeChange: (params: {
    previousContentHeight: number;
    contentHeight: number;
  }) => void;
  handleScrollNearBottomChange: (params: {
    nextIsNearBottom: boolean;
    scrollDelta: number;
  }) => void;
  reevaluate: () => void;
}

interface CreateTurnAnchorControllerDriverInput {
  getMeasurement: () => TurnAnchorMeasurement;
  scrollByDelta: (delta: number) => void;
  onModeChange: (mode: TurnAnchorScrollMode) => void;
  scheduleFrame: (callback: () => void) => unknown;
  cancelFrame: (handle: unknown) => void;
}

/** User must scroll away at least this far (px) to leave anchoring. */
export const TURN_ANCHOR_USER_SCROLL_AWAY_DELTA_PX = 24;
/** Attempts to position the anchor before giving up (row not measurable yet). */
export const TURN_ANCHOR_POSITION_ATTEMPT_MAX = 12;
/**
 * Bounded retries while content has no scrollable overflow. Without this,
 * a never-growing reply would re-schedule rAF forever (T3 LegendList path
 * has no equivalent hazard).
 */
export const TURN_ANCHOR_NO_OVERFLOW_ATTEMPT_MAX = 60;

export function createTurnAnchorControllerDriver(
  input: CreateTurnAnchorControllerDriverInput,
): TurnAnchorControllerDriver {
  let mode: TurnAnchorScrollMode = "following-end";
  let pendingRequest: TurnAnchorRequest | null = null;
  let attemptCount = 0;
  let noOverflowAttemptCount = 0;
  let attemptHandle: unknown = null;

  const setModeInternal = (nextMode: TurnAnchorScrollMode) => {
    if (mode === nextMode) {
      return;
    }
    mode = nextMode;
    input.onModeChange(nextMode);
  };

  const cancelPendingAttempt = () => {
    if (attemptHandle !== null) {
      input.cancelFrame(attemptHandle);
      attemptHandle = null;
    }
  };

  const positionAnchor = () => {
    attemptHandle = null;
    const measurement = input.getMeasurement();
    if (measurement.anchorIndex === null) {
      if (attemptCount < TURN_ANCHOR_POSITION_ATTEMPT_MAX) {
        attemptCount += 1;
        attemptHandle = input.scheduleFrame(positionAnchor);
      } else {
        // Give up: the anchor row never became measurable. Clear the pending
        // request so the composer busy/anchoring state does not stick.
        pendingRequest = null;
        attemptCount = 0;
      }
      return;
    }

    // Pin the anchor row near the top of the usable viewport. The composer
    // overlay and the anchor offset eat into the usable height; the sent row
    // itself stays put and the reply grows below it.
    const anchorTop = measurement.positionAtIndex(measurement.anchorIndex);
    if (typeof anchorTop !== "number" || !Number.isFinite(anchorTop)) {
      if (attemptCount < TURN_ANCHOR_POSITION_ATTEMPT_MAX) {
        attemptCount += 1;
        attemptHandle = input.scheduleFrame(positionAnchor);
      } else {
        pendingRequest = null;
        attemptCount = 0;
      }
      return;
    }

    const targetScroll = Math.max(0, anchorTop - TURN_ANCHOR_OFFSET_PX);
    const maxScroll = Math.max(0, measurement.scrollLength - measurement.viewportLength);
    if (maxScroll <= 0) {
      // No scrollable overflow yet: the reply has not grown enough for the
      // row to be positioned. Retry briefly; give up if content never grows
      // so we do not schedule rAF forever.
      if (noOverflowAttemptCount < TURN_ANCHOR_NO_OVERFLOW_ATTEMPT_MAX) {
        noOverflowAttemptCount += 1;
        attemptHandle = input.scheduleFrame(positionAnchor);
      } else {
        pendingRequest = null;
        attemptCount = 0;
        noOverflowAttemptCount = 0;
      }
      return;
    }
    const delta = Math.min(targetScroll, maxScroll) - measurement.scroll;
    if (Math.abs(delta) >= 1) {
      input.scrollByDelta(delta);
    }
    pendingRequest = null;
    attemptCount = 0;
    noOverflowAttemptCount = 0;
  };

  const scheduleAttempt = () => {
    if (attemptHandle !== null) {
      return;
    }
    attemptHandle = input.scheduleFrame(positionAnchor);
  };

  return {
    destroy() {
      cancelPendingAttempt();
      pendingRequest = null;
    },
    getSnapshot() {
      return {
        mode,
        pendingAnchorMessageId: pendingRequest?.anchorMessageId ?? null,
      };
    },
    applySendAnchor(request) {
      if (!request) {
        return;
      }
      if (pendingRequest?.requestKey === request.requestKey) {
        return;
      }
      cancelPendingAttempt();
      pendingRequest = request;
      attemptCount = 0;
      noOverflowAttemptCount = 0;
      if (request.reason === "jump-to-end") {
        setModeInternal("following-end");
        pendingRequest = null;
        return;
      }
      setModeInternal("anchoring-new-turn");
      scheduleAttempt();
    },
    detachByUser() {
      if (mode !== "anchoring-new-turn") {
        return;
      }
      cancelPendingAttempt();
      pendingRequest = null;
      attemptCount = 0;
      noOverflowAttemptCount = 0;
      setModeInternal("free-scrolling");
    },
    handleContentSizeChange(params) {
      if (mode !== "anchoring-new-turn") {
        return;
      }
      if (pendingRequest !== null) {
        // Content grew while waiting for overflow / measurable row: reset the
        // no-overflow budget so a short reply that later expands can still pin.
        noOverflowAttemptCount = 0;
        scheduleAttempt();
        return;
      }
      if (params.contentHeight <= params.previousContentHeight) {
        // Shrinks or no-ops keep the pinned scroll position.
        return;
      }
      // The reply is expanding below the pinned row. Keep the reply's end
      // visible once the turn overflows the usable viewport, exactly like the
      // anchored-turn reveal in the reference implementation.
      const measurement = input.getMeasurement();
      if (measurement.anchorIndex === null) {
        return;
      }
      const metrics = getAnchoredTurnMetrics({
        state: measurement,
        anchorIndex: measurement.anchorIndex,
        composerOverlayHeight: measurement.composerOverlayHeight,
        anchorOffset: TURN_ANCHOR_OFFSET_PX,
      });
      if (metrics && metrics.scrollDeltaToRevealEnd >= 1) {
        input.scrollByDelta(metrics.scrollDeltaToRevealEnd);
      }
    },
    handleScrollNearBottomChange(params) {
      if (mode === "following-end") {
        return;
      }
      if (!params.nextIsNearBottom) {
        return;
      }
      const intentional = Math.abs(params.scrollDelta) >= TURN_ANCHOR_USER_SCROLL_AWAY_DELTA_PX;
      // Returning to the live edge resumes following unless this was a big
      // deliberate jump that should stay free.
      if (!intentional) {
        cancelPendingAttempt();
        pendingRequest = null;
        attemptCount = 0;
        noOverflowAttemptCount = 0;
        setModeInternal("following-end");
      }
    },
    reevaluate() {
      if (mode !== "anchoring-new-turn" || pendingRequest === null) {
        return;
      }
      scheduleAttempt();
    },
  };
}
