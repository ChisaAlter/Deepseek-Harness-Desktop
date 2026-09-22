import { describe, expect, it } from "vitest";
import {
  canSettle,
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
  hasQueuedTurnStart,
  resolveSnoozePresets,
  snoozeWakeDescription,
  snoozeWakeLabel,
  threadRaisedHandWhileSnoozed,
  threadWokeAt,
  type SidebarV2ThreadShell,
} from "./snooze";

function shell(input: Partial<SidebarV2ThreadShell> & { id: string }): SidebarV2ThreadShell {
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
  };
}

// Local-time constructor so preset math is timezone-stable in tests.
function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const NOW = "2026-04-08T10:00:00.000Z";

describe("resolveSnoozePresets", () => {
  it("offers hour, evening, tomorrow, next week in the morning", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10));
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "evening",
      "tomorrow",
      "next-week",
    ]);
  });

  it("drops the evening preset once evening is near or past", () => {
    expect(resolveSnoozePresets(localDate(2026, 4, 8, 17, 30)).map((preset) => preset.id)).toEqual([
      "hour",
      "tomorrow",
      "next-week",
    ]);
    expect(resolveSnoozePresets(localDate(2026, 4, 8, 21)).map((preset) => preset.id)).toEqual([
      "hour",
      "tomorrow",
      "next-week",
    ]);
  });

  it("puts next week a full week out when today is Monday", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 6, 10));
    const nextWeek = presets.find((preset) => preset.id === "next-week");
    expect(new Date(nextWeek!.snoozedUntil).getDay()).toBe(1);
    expect(new Date(nextWeek!.snoozedUntil).getDate()).toBe(13);
  });
});

describe("snoozeWakeLabel", () => {
  it("formats minutes, hours, and days", () => {
    expect(snoozeWakeLabel("2026-04-08T10:30:00.000Z", { now: NOW })).toBe("30m");
    expect(snoozeWakeLabel("2026-04-08T12:00:00.000Z", { now: NOW })).toBe("2h");
    expect(snoozeWakeLabel("2026-04-11T10:00:00.000Z", { now: NOW })).toBe("3d");
  });

  it("reads 'now' when the wake time passed", () => {
    expect(snoozeWakeLabel("2026-04-08T09:00:00.000Z", { now: NOW })).toBe("now");
  });
});

describe("snoozeWakeDescription", () => {
  const now = localDate(2026, 4, 8, 10);

  it("uses bare time today, 'tomorrow' next day, weekday within the week", () => {
    expect(snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now)).not.toContain(
      "tomorrow",
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 9, 9).toISOString(), now)).toContain(
      "tomorrow",
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 13, 9).toISOString(), now)).toMatch(/Mon|周一/);
  });
});

describe("hasQueuedTurnStart", () => {
  it("detects a fresh user message with no activity", () => {
    expect(
      hasQueuedTurnStart(
        shell({ id: "a", latestUserMessageAt: NOW, lastActivityAt: "2026-04-08T09:59:00.000Z" }),
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("ignores messages outside the grace window", () => {
    expect(
      hasQueuedTurnStart(shell({ id: "a", latestUserMessageAt: "2026-04-08T08:00:00.000Z" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it("ignores errored sessions", () => {
    expect(
      hasQueuedTurnStart(shell({ id: "a", latestUserMessageAt: NOW, status: "error" }), {
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("canSettle / canSnooze", () => {
  it("refuses settle while blocked on the user or running", () => {
    expect(canSettle(shell({ id: "a", hasPendingApprovals: true }), { now: NOW })).toBe(false);
    expect(canSettle(shell({ id: "a", status: "running" }), { now: NOW })).toBe(false);
    expect(canSettle(shell({ id: "a", status: "idle" }), { now: NOW })).toBe(true);
  });

  it("refuses snooze while blocked on the user", () => {
    expect(canSnooze(shell({ id: "a", hasPendingUserInput: true }), { now: NOW })).toBe(false);
    expect(canSnooze(shell({ id: "a", status: "running" }), { now: NOW })).toBe(true);
  });
});

describe("effectiveSnoozed", () => {
  it("classifies snoozed while the wake time is in the future", () => {
    expect(
      effectiveSnoozed(shell({ id: "a", snoozedUntil: "2026-04-08T18:00:00.000Z" }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it("classifies active after the wake time passes", () => {
    expect(
      effectiveSnoozed(shell({ id: "a", snoozedUntil: "2026-04-08T09:00:00.000Z" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it("raises the hand on pending approval", () => {
    expect(
      effectiveSnoozed(
        shell({
          id: "a",
          snoozedUntil: "2026-04-08T18:00:00.000Z",
          hasPendingApprovals: true,
        }),
        { now: NOW },
      ),
    ).toBe(false);
  });

  it("ignores malformed snooze data", () => {
    expect(effectiveSnoozed(shell({ id: "a", snoozedUntil: "bad" }), { now: NOW })).toBe(false);
  });
});

describe("threadRaisedHandWhileSnoozed / threadWokeAt", () => {
  it("raises the hand on a fresh error after the snooze", () => {
    expect(
      threadRaisedHandWhileSnoozed(
        shell({
          id: "a",
          status: "error",
          snoozedAt: "2026-04-08T09:00:00.000Z",
          lastActivityAt: "2026-04-08T09:30:00.000Z",
        }),
      ),
    ).toBe(true);
  });

  it("does not raise the hand for a pre-existing error", () => {
    expect(
      threadRaisedHandWhileSnoozed(
        shell({
          id: "a",
          status: "error",
          snoozedAt: "2026-04-08T10:30:00.000Z",
          lastActivityAt: "2026-04-08T09:30:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("reports the wake time once the timer elapses", () => {
    expect(
      threadWokeAt(shell({ id: "a", snoozedUntil: "2026-04-08T09:00:00.000Z" }), { now: NOW }),
    ).toBe("2026-04-08T09:00:00.000Z");
  });

  it("returns null while still snoozed", () => {
    expect(
      threadWokeAt(shell({ id: "a", snoozedUntil: "2026-04-08T18:00:00.000Z" }), { now: NOW }),
    ).toBeNull();
  });
});

describe("effectiveSettled", () => {
  const base = shell({
    id: "a",
    lastActivityAt: "2026-03-01T00:00:00.000Z",
    latestUserMessageAt: "2026-03-01T00:00:00.000Z",
  });

  it("auto-settles after the inactivity window", () => {
    expect(effectiveSettled(base, { now: NOW, autoSettleAfterDays: 3 })).toBe(true);
  });

  it("stays active inside the window", () => {
    expect(
      effectiveSettled(shell({ id: "a", lastActivityAt: "2026-04-07T00:00:00.000Z" }), {
        now: NOW,
        autoSettleAfterDays: 3,
      }),
    ).toBe(false);
  });

  it("honors the explicit active override", () => {
    expect(
      effectiveSettled(
        { ...base, settledOverride: "active" },
        { now: NOW, autoSettleAfterDays: 3 },
      ),
    ).toBe(false);
  });

  it("honors the explicit settled override", () => {
    expect(
      effectiveSettled(
        { ...base, settledOverride: "settled", settledAt: NOW },
        { now: NOW, autoSettleAfterDays: 3 },
      ),
    ).toBe(true);
  });

  it("settles immediately on a merged PR", () => {
    expect(
      effectiveSettled(base, { now: NOW, autoSettleAfterDays: null, changeRequestState: "merged" }),
    ).toBe(true);
  });

  it("blocks auto-settle while a PR is open", () => {
    expect(
      effectiveSettled(base, { now: NOW, autoSettleAfterDays: 3, changeRequestState: "open" }),
    ).toBe(false);
  });

  it("stays active while running regardless of override", () => {
    expect(
      effectiveSettled(
        { ...base, status: "running", settledOverride: "settled", settledAt: NOW },
        { now: NOW, autoSettleAfterDays: 3 },
      ),
    ).toBe(false);
  });
});
