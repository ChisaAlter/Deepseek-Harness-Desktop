import { describe, expect, it } from "vitest";
import {
  firstValidTimestamp,
  firstValidTimestampMs,
  formatWorkingDurationLabel,
  getVisibleThreadsForProject,
  hasUnseenCompletion,
  orderItemsByPreferredIds,
  parseTimestampMs,
  resolveProjectStatusIndicator,
  resolveSidebarV2Status,
  resolveThreadStatusPill,
  searchSidebarThreadsByTitle,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
} from "./logic";

describe("parseTimestampMs", () => {
  it("parses valid ISO timestamps", () => {
    expect(parseTimestampMs("2026-01-02T00:00:00.000Z")).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );
  });

  it("sinks malformed timestamps to the epoch", () => {
    expect(parseTimestampMs("not-a-date")).toBe(0);
  });
});

describe("firstValidTimestampMs / firstValidTimestamp", () => {
  it("picks the first valid candidate and skips malformed ones", () => {
    expect(firstValidTimestampMs(null, "bad", "2026-01-02T00:00:00.000Z")).toBe(
      Date.parse("2026-01-02T00:00:00.000Z"),
    );
    expect(firstValidTimestamp("bad", "2026-01-02T00:00:00.000Z")).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns null/0 when every candidate is invalid", () => {
    expect(firstValidTimestampMs(null, "bad")).toBe(0);
    expect(firstValidTimestamp(null, "bad")).toBeNull();
  });
});

describe("sortThreadsForSidebarV2", () => {
  it("sorts newest createdAt first", () => {
    const sorted = sortThreadsForSidebarV2([
      { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "mid", createdAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["new", "mid", "old"]);
  });

  it("ties break by id localeCompare", () => {
    const sorted = sortThreadsForSidebarV2([
      { id: "b", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const input = [{ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }];
    sortThreadsForSidebarV2(input);
    expect(input).toEqual([{ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("sortSettledThreadsForSidebarV2", () => {
  it("sorts by settledAt when stamped", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      {
        id: "a",
        settledAt: "2026-01-01T00:00:00.000Z",
        latestUserMessageAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "b",
        settledAt: "2026-01-03T00:00:00.000Z",
        latestUserMessageAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["b", "a"]);
  });

  it("falls back to user message then updatedAt", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      {
        id: "a",
        settledAt: null,
        latestUserMessageAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        settledAt: null,
        latestUserMessageAt: null,
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["b", "a"]);
  });
});

describe("resolveSidebarV2Status", () => {
  const base = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    status: "idle" as string | null,
    lastError: null as string | null,
  };

  it("approval outranks input", () => {
    expect(
      resolveSidebarV2Status({ ...base, hasPendingApprovals: true, hasPendingUserInput: true }),
    ).toBe("approval");
  });

  it("input outranks working", () => {
    expect(resolveSidebarV2Status({ ...base, hasPendingUserInput: true, status: "running" })).toBe(
      "input",
    );
  });

  it("maps running/initializing to working", () => {
    expect(resolveSidebarV2Status({ ...base, status: "running" })).toBe("working");
    expect(resolveSidebarV2Status({ ...base, status: "initializing" })).toBe("working");
  });

  it("maps error to failed", () => {
    expect(resolveSidebarV2Status({ ...base, status: "error" })).toBe("failed");
  });

  it("maps everything else to ready", () => {
    expect(resolveSidebarV2Status({ ...base, status: "idle" })).toBe("ready");
    expect(resolveSidebarV2Status({ ...base, status: "closed" })).toBe("ready");
  });
});

describe("resolveThreadStatusPill", () => {
  const base = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    status: "idle" as string | null,
    interactionMode: null as string | null,
    hasActionableProposedPlan: false,
    completedAt: null as string | null,
    lastVisitedAt: null as string | null,
    lastError: null as string | null,
  };

  it("returns Pending Approval first", () => {
    expect(resolveThreadStatusPill({ ...base, hasPendingApprovals: true })?.label).toBe(
      "Pending Approval",
    );
  });

  it("returns Working for running", () => {
    expect(resolveThreadStatusPill({ ...base, status: "running" })?.label).toBe("Working");
  });

  it("returns null at rest", () => {
    expect(resolveThreadStatusPill(base)).toBeNull();
  });

  it("returns Failed for errored threads", () => {
    expect(resolveThreadStatusPill({ ...base, status: "error" })?.label).toBe("Failed");
  });
});

describe("hasUnseenCompletion", () => {
  it("is false when never visited", () => {
    expect(
      hasUnseenCompletion({ completedAt: "2026-01-02T00:00:00.000Z", lastVisitedAt: null }),
    ).toBe(false);
  });

  it("is true when completed after last visit", () => {
    expect(
      hasUnseenCompletion({
        completedAt: "2026-01-02T00:00:00.000Z",
        lastVisitedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("picks the highest priority pill", () => {
    const indicator = resolveProjectStatusIndicator([
      { label: "Completed", color: "emerald", dotColor: "success", pulse: false },
      { label: "Working", color: "sky", dotColor: "accentBright", pulse: true },
      { label: "Pending Approval", color: "amber", dotColor: "statusWarningBg", pulse: false },
    ]);
    expect(indicator?.label).toBe("Pending Approval");
  });

  it("returns null when every status is null", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });
});

describe("searchSidebarThreadsByTitle", () => {
  it("matches case-insensitively and preserves input order", () => {
    const result = searchSidebarThreadsByTitle(
      [{ title: "Alpha Beta" }, { title: "gamma" }, { title: "alpha one" }],
      "ALPHA",
    );
    expect(result.map((thread) => thread.title)).toEqual(["Alpha Beta", "alpha one"]);
  });

  it("returns [] for a blank query", () => {
    expect(searchSidebarThreadsByTitle([{ title: "x" }], "  ")).toEqual([]);
  });
});

describe("getVisibleThreadsForProject", () => {
  it("shows everything when expanded or under the limit", () => {
    expect(
      getVisibleThreadsForProject({
        threads: [{ id: "a" }, { id: "b" }],
        activeThreadId: null,
        isThreadListExpanded: false,
        previewLimit: 5,
      }),
    ).toEqual({
      hasHiddenThreads: false,
      visibleThreads: [{ id: "a" }, { id: "b" }],
      hiddenThreads: [],
    });
  });

  it("keeps the active thread visible past the preview limit", () => {
    const result = getVisibleThreadsForProject({
      threads: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "active" }],
      activeThreadId: "active",
      isThreadListExpanded: false,
      previewLimit: 3,
    });
    expect(result.visibleThreads.map((thread) => thread.id)).toContain("active");
    expect(result.hasHiddenThreads).toBe(true);
  });
});

describe("orderItemsByPreferredIds", () => {
  it("moves preferred items first and keeps the rest in order", () => {
    const ordered = orderItemsByPreferredIds({
      items: [{ id: "a" }, { id: "b" }, { id: "c" }],
      preferredIds: ["c", "a"],
      getId: (item) => item.id,
    });
    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
});

describe("formatWorkingDurationLabel", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatWorkingDurationLabel(5_000)).toBe("5s");
    expect(formatWorkingDurationLabel(65_000)).toBe("1m");
    expect(formatWorkingDurationLabel(3_900_000)).toBe("1h 5m");
  });

  it("handles invalid input", () => {
    expect(formatWorkingDurationLabel(-1)).toBe("0s");
  });
});
