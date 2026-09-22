import { describe, expect, it } from "vitest";
import {
  computeNextSnoozeWakeAt,
  DEFAULT_SHELF_EXPANSION,
  nextSettledVisibleCount,
  pageSettledThreads,
  partitionThreadsForSidebarV2,
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
  sortSnoozedThreadsForSidebarV2,
  type PartitionableThread,
} from "./shelves";

function thread(input: Partial<PartitionableThread> & { id: string }): PartitionableThread {
  return {
    id: input.id,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
    lastActivityAt: input.lastActivityAt ?? null,
    status: input.status ?? "idle",
    lastError: input.lastError ?? null,
    hasPendingApprovals: input.hasPendingApprovals ?? false,
    hasPendingUserInput: input.hasPendingUserInput ?? false,
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt: input.snoozedAt ?? null,
    settledAt: input.settledAt ?? null,
    settledOverride: input.settledOverride ?? null,
    archivedAt: input.archivedAt ?? null,
    createdAt: input.createdAt ?? "2026-04-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? input.createdAt ?? "2026-04-01T00:00:00.000Z",
  };
}

const NOW = "2026-04-08T10:00:00.000Z";

describe("partitionThreadsForSidebarV2", () => {
  it("partitions active, snoozed, and settled", () => {
    const result = partitionThreadsForSidebarV2({
      threads: [
        thread({ id: "active", createdAt: "2026-04-08T09:00:00.000Z" }),
        thread({
          id: "snoozed",
          snoozedUntil: "2026-04-08T18:00:00.000Z",
          createdAt: "2026-04-08T08:00:00.000Z",
        }),
        thread({
          id: "settled",
          lastActivityAt: "2026-03-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      now: NOW,
      snoozeNow: NOW,
      autoSettleAfterDays: 3,
    });
    expect(result.activeThreads.map((item) => item.id)).toEqual(["active"]);
    expect(result.snoozedThreads.map((item) => item.id)).toEqual(["snoozed"]);
    expect(result.settledThreads.map((item) => item.id)).toEqual(["settled"]);
  });

  it("snooze outranks settle", () => {
    const result = partitionThreadsForSidebarV2({
      threads: [
        thread({
          id: "both",
          snoozedUntil: "2026-04-08T18:00:00.000Z",
          settledOverride: "settled",
          settledAt: NOW,
          lastActivityAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      now: NOW,
      snoozeNow: NOW,
      autoSettleAfterDays: 3,
    });
    expect(result.snoozedThreads.map((item) => item.id)).toEqual(["both"]);
    expect(result.settledThreads).toEqual([]);
  });

  it("excludes archived threads", () => {
    const result = partitionThreadsForSidebarV2({
      threads: [thread({ id: "gone", archivedAt: NOW })],
      now: NOW,
      snoozeNow: NOW,
      autoSettleAfterDays: null,
    });
    expect(result.activeThreads).toEqual([]);
    expect(result.snoozedThreads).toEqual([]);
    expect(result.settledThreads).toEqual([]);
  });

  it("sorts active by createdAt desc and settled by settle time desc", () => {
    const result = partitionThreadsForSidebarV2({
      threads: [
        thread({ id: "old-active", createdAt: "2026-04-01T00:00:00.000Z" }),
        thread({ id: "new-active", createdAt: "2026-04-08T09:00:00.000Z" }),
        thread({
          id: "old-settled",
          settledAt: "2026-04-01T00:00:00.000Z",
          lastActivityAt: "2026-03-01T00:00:00.000Z",
        }),
        thread({
          id: "new-settled",
          settledAt: "2026-04-08T09:00:00.000Z",
          lastActivityAt: "2026-03-02T00:00:00.000Z",
        }),
      ],
      now: NOW,
      snoozeNow: NOW,
      autoSettleAfterDays: 3,
    });
    expect(result.activeThreads.map((item) => item.id)).toEqual(["new-active", "old-active"]);
    expect(result.settledThreads.map((item) => item.id)).toEqual(["new-settled", "old-settled"]);
  });

  it("computes the next snooze wake", () => {
    const result = partitionThreadsForSidebarV2({
      threads: [
        thread({ id: "later", snoozedUntil: "2026-04-09T09:00:00.000Z" }),
        thread({ id: "soon", snoozedUntil: "2026-04-08T12:00:00.000Z" }),
      ],
      now: NOW,
      snoozeNow: NOW,
      autoSettleAfterDays: null,
    });
    expect(result.nextSnoozeWakeAt).toBe("2026-04-08T12:00:00.000Z");
  });
});

describe("computeNextSnoozeWakeAt", () => {
  it("returns null with no snoozed threads or expired wakes", () => {
    expect(computeNextSnoozeWakeAt([], NOW)).toBeNull();
    expect(computeNextSnoozeWakeAt([{ snoozedUntil: "2026-04-08T09:00:00.000Z" }], NOW)).toBeNull();
  });
});

describe("sortSnoozedThreadsForSidebarV2", () => {
  it("sorts soonest wake first", () => {
    const sorted = sortSnoozedThreadsForSidebarV2([
      { id: "later", snoozedUntil: "2026-04-09T09:00:00.000Z" },
      { id: "soon", snoozedUntil: "2026-04-08T12:00:00.000Z" },
      { id: "none", snoozedUntil: null },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["soon", "later", "none"]);
  });
});

describe("pageSettledThreads", () => {
  const settled = Array.from({ length: 30 }, (_, index) => ({
    id: `t${index}`,
  }));

  it("pages the settled tail and reports hidden count", () => {
    const result = pageSettledThreads({
      settledThreads: settled,
      settledVisibleCount: SETTLED_TAIL_INITIAL_COUNT,
      routeThreadKey: null,
      settledShelfExpanded: true,
    });
    expect(result.visibleSettledThreads).toHaveLength(SETTLED_TAIL_INITIAL_COUNT);
    expect(result.hiddenSettledCount).toBe(20);
  });

  it("forces the route thread visible past the page boundary", () => {
    const result = pageSettledThreads({
      settledThreads: settled,
      settledVisibleCount: SETTLED_TAIL_INITIAL_COUNT,
      routeThreadKey: "t29",
      settledShelfExpanded: true,
    });
    expect(result.visibleSettledThreads.map((item) => item.id)).toContain("t29");
  });

  it("keeps only the route thread when collapsed", () => {
    const result = pageSettledThreads({
      settledThreads: settled,
      settledVisibleCount: SETTLED_TAIL_INITIAL_COUNT,
      routeThreadKey: "t5",
      settledShelfExpanded: false,
    });
    expect(result.visibleSettledThreads.map((item) => item.id)).toEqual(["t5"]);
  });

  it("shows nothing when collapsed without a route thread", () => {
    const result = pageSettledThreads({
      settledThreads: settled,
      settledVisibleCount: SETTLED_TAIL_INITIAL_COUNT,
      routeThreadKey: null,
      settledShelfExpanded: false,
    });
    expect(result.visibleSettledThreads).toEqual([]);
  });
});

describe("shelf constants", () => {
  it("uses T3 defaults", () => {
    expect(SETTLED_TAIL_INITIAL_COUNT).toBe(10);
    expect(SETTLED_TAIL_PAGE_COUNT).toBe(25);
    expect(DEFAULT_SHELF_EXPANSION).toEqual({
      settledShelfExpanded: true,
      snoozedShelfExpanded: false,
    });
    expect(nextSettledVisibleCount(10)).toBe(35);
  });
});
