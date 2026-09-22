import { describe, expect, it } from "vitest";
import {
  createTurnAnchorControllerDriver,
  TURN_ANCHOR_POSITION_ATTEMPT_MAX,
  TURN_ANCHOR_USER_SCROLL_AWAY_DELTA_PX,
  type TurnAnchorMeasurement,
} from "./turn-anchor-controller";

function createFrameScheduler() {
  let sequence = 0;
  const tasks = new Map<number, { cancelled: boolean; callback: () => void }>();

  return {
    schedule(callback: () => void) {
      const id = ++sequence;
      tasks.set(id, { cancelled: false, callback });
      return id;
    },
    cancel(handle: unknown) {
      const task = tasks.get(handle as number);
      if (task) {
        task.cancelled = true;
      }
    },
    size() {
      return tasks.size;
    },
    flushFrame() {
      const due: Array<() => void> = [];
      for (const [id, task] of Array.from(tasks.entries())) {
        if (task.cancelled) {
          tasks.delete(id);
          continue;
        }
        tasks.delete(id);
        due.push(task.callback);
      }
      for (const callback of due) {
        callback();
      }
    },
    flushAll(limit = 20) {
      for (let index = 0; index < limit && tasks.size > 0; index += 1) {
        this.flushFrame();
      }
    },
  };
}

function createHarness(input?: { measurement?: Partial<TurnAnchorMeasurement> }) {
  const scheduler = createFrameScheduler();
  const modes: string[] = [];
  const scrollDeltas: number[] = [];
  const baseMeasurement: TurnAnchorMeasurement = {
    data: [{ id: "anchor" }, { id: "reply-1" }, { id: "reply-2" }],
    scroll: 0,
    scrollLength: 1000,
    viewportLength: 800,
    positionAtIndex: (index) => index * 100,
    sizeAtIndex: () => 100,
    anchorIndex: 0,
    composerOverlayHeight: 120,
  };
  const measurement: TurnAnchorMeasurement = {
    ...baseMeasurement,
    ...input?.measurement,
  };
  const driver = createTurnAnchorControllerDriver({
    getMeasurement: () => measurement,
    scrollByDelta: (delta) => {
      scrollDeltas.push(delta);
    },
    onModeChange: (mode) => {
      modes.push(mode);
    },
    scheduleFrame: scheduler.schedule,
    cancelFrame: scheduler.cancel,
  });
  // Tests mutate measurement fields mid-flight (e.g. the anchor becoming
  // measurable after a retry), so expose a mutable view over the snapshot.
  const mutable = measurement as TurnAnchorMeasurement & {
    anchorIndex: number | null;
    positionAtIndex: (index: number) => number | undefined;
    scrollLength: number;
    viewportLength: number;
  };
  return { driver, scheduler, modes, scrollDeltas, measurement, mutable };
}

function sendAnchor(harness: ReturnType<typeof createHarness>, messageId = "optimistic-1") {
  harness.driver.applySendAnchor({
    reason: "message-sent",
    anchorMessageId: messageId,
    requestKey: `agent:${messageId}`,
  });
}

describe("createTurnAnchorControllerDriver", () => {
  it("starts in following-end with no pending anchor", () => {
    const harness = createHarness();
    expect(harness.driver.getSnapshot()).toEqual({
      mode: "following-end",
      pendingAnchorMessageId: null,
    });
  });

  it("enters anchoring-new-turn on send and pins the anchor row", () => {
    const harness = createHarness();
    sendAnchor(harness);

    expect(harness.driver.getSnapshot().mode).toBe("anchoring-new-turn");
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBe("optimistic-1");
    expect(harness.scheduler.size()).toBe(1);

    harness.scheduler.flushAll();
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
    // target = anchorTop(0) - offset(16) clamped to 0; delta = 0 - 0 = 0 → no scroll
    expect(harness.scrollDeltas).toEqual([]);
  });

  it("pins to a non-zero anchor offset when the anchor is not the first row", () => {
    const harness = createHarness({
      measurement: { anchorIndex: 2, scroll: 0 },
    });
    sendAnchor(harness);
    harness.scheduler.flushAll();
    // anchorTop = 2*100 = 200; target = 200 - 16 = 184
    expect(harness.scrollDeltas).toEqual([184]);
  });

  it("does not scroll when the delta is sub-pixel", () => {
    const harness = createHarness({
      measurement: { anchorIndex: 0 },
    });
    sendAnchor(harness);
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
  });

  it("retries while the anchor row is not yet measurable", () => {
    const harness = createHarness({
      measurement: { anchorIndex: null },
    });
    sendAnchor(harness);
    harness.scheduler.flushFrame();
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBe("optimistic-1");

    harness.mutable.anchorIndex = 2;
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([184]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
  });

  it("gives up after the attempt limit while unmeasurable", () => {
    const harness = createHarness({
      measurement: { anchorIndex: null },
    });
    sendAnchor(harness);
    harness.scheduler.flushAll(TURN_ANCHOR_POSITION_ATTEMPT_MAX + 5);
    expect(harness.scheduler.size()).toBe(0);
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
  });

  it("retries while the anchor position is not finite", () => {
    const harness = createHarness({
      measurement: { anchorIndex: 2, positionAtIndex: () => Number.NaN },
    });
    sendAnchor(harness);
    harness.scheduler.flushFrame();
    expect(harness.scrollDeltas).toEqual([]);

    harness.mutable.positionAtIndex = (index) => index * 100;
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([184]);
  });

  it("detaches to free-scrolling when the user scrolls away", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.driver.detachByUser();
    expect(harness.driver.getSnapshot().mode).toBe("free-scrolling");
    // The cancelled attempt must not produce a scroll.
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
  });

  it("ignores duplicate send anchors with the same request key", () => {
    const harness = createHarness();
    sendAnchor(harness);
    sendAnchor(harness);
    expect(harness.scheduler.size()).toBe(1);
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
  });

  it("jump-to-end resumes following-end and clears the anchor", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.driver.applySendAnchor({
      reason: "jump-to-end",
      anchorMessageId: null,
      requestKey: "jump:1",
    });
    expect(harness.driver.getSnapshot().mode).toBe("following-end");
    // The cancelled attempt must not produce a scroll.
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
  });

  it("content growth re-attempts positioning only while unlanded", () => {
    const harness = createHarness({
      measurement: { anchorIndex: null },
    });
    sendAnchor(harness);
    harness.scheduler.flushFrame();
    expect(harness.scheduler.size()).toBe(1);

    harness.mutable.anchorIndex = 2;
    harness.driver.handleContentSizeChange({
      previousContentHeight: 900,
      contentHeight: 1200,
    });
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([184]);
  });

  it("gives up when content never grows past the viewport (no-overflow budget)", () => {
    const harness = createHarness({
      measurement: { anchorIndex: 3, scrollLength: 500, viewportLength: 800 },
    });
    sendAnchor(harness);
    // Budget is TURN_ANCHOR_NO_OVERFLOW_ATTEMPT_MAX (60) successful retries,
    // then the next frame clears the pending request.
    for (let i = 0; i < 60; i += 1) {
      harness.scheduler.flushFrame();
    }
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBe("optimistic-1");
    harness.scheduler.flushFrame();
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
    expect(harness.scrollDeltas).toEqual([]);
  });

  it("waits for scrollable overflow before pinning, then clamps to the max scroll", () => {
    const harness = createHarness({
      measurement: { anchorIndex: 3, scrollLength: 500, viewportLength: 800 },
    });
    sendAnchor(harness);
    harness.scheduler.flushFrame();
    // No overflow (maxScroll 0): the pin would clamp to 0, so keep pending
    // until the reply grows enough to scroll.
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBe("optimistic-1");

    harness.mutable.viewportLength = 300;
    harness.scheduler.flushAll();
    // maxScroll = 500 - 300 = 200 < target 284: scroll as far as possible and
    // settle — the row lands in the upper viewport while the turn is short.
    expect(harness.scrollDeltas).toEqual([200]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
  });

  it("reveals the reply end when the anchored turn overflows the usable viewport", () => {
    const harness = createHarness({
      measurement: {
        anchorIndex: 0,
        scroll: 0,
        scrollLength: 300,
        viewportLength: 100,
        data: [{ id: "anchor" }, { id: "reply" }],
        positionAtIndex: (index) => index * 100,
        sizeAtIndex: () => 100,
      },
    });
    sendAnchor(harness);
    harness.scheduler.flushAll();
    // Anchor pinned at top: target = 0 - 16 → clamped 0, delta 0.
    expect(harness.scrollDeltas).toEqual([]);

    // Turn end at 200; usable viewport = 300 - 120 - 16 = 164 → target scroll
    // = 200 - 164 = 36.
    harness.driver.handleContentSizeChange({
      previousContentHeight: 300,
      contentHeight: 400,
    });
    expect(harness.scrollDeltas).toEqual([36]);
  });

  it("content growth after landing keeps the pinned scroll position when no overflow", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.scheduler.flushAll();

    harness.driver.handleContentSizeChange({
      previousContentHeight: 900,
      contentHeight: 1600,
    });
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot().pendingAnchorMessageId).toBeNull();
  });

  it("returning to the bottom resumes following-end", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.scheduler.flushAll();
    harness.driver.handleScrollNearBottomChange({
      nextIsNearBottom: true,
      scrollDelta: 8,
    });
    expect(harness.driver.getSnapshot().mode).toBe("following-end");
  });

  it("a large deliberate scroll back to the bottom stays free", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.scheduler.flushAll();
    harness.driver.handleScrollNearBottomChange({
      nextIsNearBottom: true,
      scrollDelta: TURN_ANCHOR_USER_SCROLL_AWAY_DELTA_PX + 4,
    });
    expect(harness.driver.getSnapshot().mode).toBe("anchoring-new-turn");
  });

  it("not near bottom keeps the current mode", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.scheduler.flushAll();
    harness.driver.handleScrollNearBottomChange({
      nextIsNearBottom: false,
      scrollDelta: 0,
    });
    expect(harness.driver.getSnapshot().mode).toBe("anchoring-new-turn");
  });

  it("destroy cancels pending work and clears the request", () => {
    const harness = createHarness({
      measurement: { anchorIndex: null },
    });
    sendAnchor(harness);
    harness.driver.destroy();
    harness.scheduler.flushAll();
    expect(harness.scrollDeltas).toEqual([]);
    expect(harness.driver.getSnapshot()).toEqual({
      mode: "anchoring-new-turn",
      pendingAnchorMessageId: null,
    });
  });

  it("reevaluate schedules an attempt while anchored and pending", () => {
    const harness = createHarness({
      measurement: { anchorIndex: null },
    });
    sendAnchor(harness);
    harness.scheduler.flushFrame();
    expect(harness.scheduler.size()).toBe(1);

    harness.driver.reevaluate();
    expect(harness.scheduler.size()).toBe(1);
  });

  it("reevaluate is a no-op once the anchor landed", () => {
    const harness = createHarness();
    sendAnchor(harness);
    harness.scheduler.flushAll();
    harness.driver.reevaluate();
    expect(harness.scheduler.size()).toBe(0);
  });

  it("emits mode changes to the subscriber", () => {
    const harness = createHarness();
    sendAnchor(harness);
    expect(harness.modes).toEqual(["anchoring-new-turn"]);
    harness.driver.detachByUser();
    expect(harness.modes).toEqual(["anchoring-new-turn", "free-scrolling"]);
  });
});
