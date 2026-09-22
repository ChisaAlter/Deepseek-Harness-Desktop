import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createToastQueue, type ToastQueue } from "./toast-queue";
import type { ToastState } from "./toast-host";

function makeToast(id: number, durationMs: number | null = 1000): ToastState {
  return {
    id,
    content: `toast-${id}`,
    nativeMessage: null,
    variant: "default",
    durationMs,
  };
}

describe("createToastQueue", () => {
  let queue: ToastQueue;
  let updates: ToastState[][];

  beforeEach(() => {
    vi.useFakeTimers();
    updates = [];
    queue = createToastQueue(3, (visible) => updates.push(visible));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("push adds to visible when below maxVisible and notifies", () => {
    queue.push(makeToast(1));
    expect(queue.getVisible()).toHaveLength(1);
    expect(queue.getVisible()[0]?.id).toBe(1);
    expect(updates).toHaveLength(1);
  });

  test("overflow pushes to pending queue without a timer", () => {
    queue.push(makeToast(1));
    queue.push(makeToast(2));
    queue.push(makeToast(3));
    queue.push(makeToast(4)); // exceeds maxVisible=3
    expect(queue.getVisible()).toHaveLength(3);
    expect(queue.getPendingCount()).toBe(1);
  });

  test("remove promotes next pending item to visible", () => {
    queue.push(makeToast(1));
    queue.push(makeToast(2));
    queue.push(makeToast(3));
    queue.push(makeToast(4)); // pending
    queue.remove(1);
    const visibleIds = queue.getVisible().map((t) => t.id);
    expect(visibleIds).toEqual([2, 3, 4]);
    expect(queue.getPendingCount()).toBe(0);
  });

  test("remove unknown id is a no-op (idempotent)", () => {
    queue.push(makeToast(1));
    const before = queue.getVisible();
    queue.remove(999);
    expect(queue.getVisible()).toEqual(before);
  });

  test("timer auto-dismisses after durationMs and promotes pending", () => {
    queue.push(makeToast(1, 100));
    queue.push(makeToast(2, 100));
    queue.push(makeToast(3, 100));
    queue.push(makeToast(4, 100)); // pending
    vi.advanceTimersByTime(100);
    expect(queue.getVisible().map((t) => t.id)).toContain(4);
  });

  test("sticky toast (durationMs null) never auto-dismisses", () => {
    queue.push(makeToast(1, null));
    vi.advanceTimersByTime(60_000);
    expect(queue.getVisible()).toHaveLength(1);
    expect(queue.getVisible()[0]?.id).toBe(1);
  });

  test("clear removes all visible and pending, stops timers", () => {
    queue.push(makeToast(1, 100));
    queue.push(makeToast(2, 100));
    queue.push(makeToast(3, 100));
    queue.push(makeToast(4, 100)); // pending
    queue.clear();
    expect(queue.getVisible()).toHaveLength(0);
    expect(queue.getPendingCount()).toBe(0);
    // Advancing timers must not trigger a promote after clear.
    vi.advanceTimersByTime(100);
    expect(queue.getVisible()).toHaveLength(0);
  });

  test("push notifies even when item goes to pending (so pendingCount updates)", () => {
    queue.push(makeToast(1));
    queue.push(makeToast(2));
    queue.push(makeToast(3));
    updates.length = 0;
    queue.push(makeToast(4)); // pending
    expect(updates).toHaveLength(1);
  });
});
