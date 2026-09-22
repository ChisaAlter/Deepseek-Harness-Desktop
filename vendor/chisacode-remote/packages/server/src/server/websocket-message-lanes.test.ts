import { describe, expect, test } from "vitest";

import { MessageLaneExecutor, classifySessionMessageLane } from "./websocket-message-lanes.js";

describe("classifySessionMessageLane", () => {
  test("marks cancel and permission as preempt", () => {
    expect(classifySessionMessageLane("agent.cancel.request").class).toBe("preempt");
    expect(classifySessionMessageLane("permission.response").class).toBe("preempt");
  });

  test("keys voice/dictation by stream/request id", () => {
    const a = classifySessionMessageLane("dictation.chunk", { requestId: "r1" });
    const b = classifySessionMessageLane("dictation.finish", { requestId: "r1" });
    const c = classifySessionMessageLane("dictation.chunk", { requestId: "r2" });
    expect(a.laneKey).toBe(b.laneKey);
    expect(a.laneKey).not.toBe(c.laneKey);
  });

  test("keys terminal messages by terminal id", () => {
    const a = classifySessionMessageLane("terminal.input", { terminalId: "t1" });
    const b = classifySessionMessageLane("terminal.resize", { terminalId: "t1" });
    expect(a.laneKey).toBe(b.laneKey);
  });
});

describe("MessageLaneExecutor", () => {
  test("serializes same lane and allows different lanes concurrently", async () => {
    const executor = new MessageLaneExecutor({ maxDepthPerLane: 8 });
    const order: string[] = [];

    const a1 = executor.schedule("voice:1");
    const b1 = executor.schedule("voice:2");
    expect(a1.ok && b1.ok).toBe(true);
    if (!a1.ok || !b1.ok) {
      return;
    }

    let releaseA1!: () => void;
    const a1Hold = new Promise<void>((resolve) => {
      releaseA1 = resolve;
    });

    const p1 = (async () => {
      await a1.waitForTurn;
      order.push("a1-start");
      await a1Hold;
      order.push("a1-end");
      a1.release();
    })();

    const a2 = executor.schedule("voice:1");
    expect(a2.ok).toBe(true);
    if (!a2.ok) {
      return;
    }
    const p2 = (async () => {
      await a2.waitForTurn;
      order.push("a2");
      a2.release();
    })();

    const pB = (async () => {
      await b1.waitForTurn;
      order.push("b1");
      b1.release();
    })();

    await Promise.resolve();
    expect(order.includes("a1-start")).toBe(true);
    expect(order.includes("b1")).toBe(true);
    expect(order.includes("a2")).toBe(false);
    releaseA1();
    await Promise.all([p1, p2, pB]);
    expect(order.indexOf("a1-end")).toBeLessThan(order.indexOf("a2"));
  });

  test("returns overflow when lane depth exceeded and preserves busy semantics", () => {
    const overflows: string[] = [];
    const executor = new MessageLaneExecutor({
      maxDepthPerLane: 2,
      onOverflow: (key) => overflows.push(key),
    });
    const first = executor.schedule("terminal:t");
    const second = executor.schedule("terminal:t");
    const third = executor.schedule("terminal:t");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe("lane_overflow");
    }
    expect(overflows).toEqual(["terminal:t"]);
    if (first.ok) {
      first.release();
    }
    if (second.ok) {
      // second may still be waiting; close cleans up
    }
    executor.close();
  });

  test("close rejects queued waiters", async () => {
    const executor = new MessageLaneExecutor({ maxDepthPerLane: 4 });
    const first = executor.schedule("k");
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    await first.waitForTurn;
    const second = executor.schedule("k");
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    const wait = second.waitForTurn.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    executor.close("connection closed");
    await expect(wait).resolves.toContain("connection closed");
    first.release();
  });
});
