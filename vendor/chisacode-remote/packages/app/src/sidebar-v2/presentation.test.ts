import { describe, expect, it } from "vitest";
import {
  formatRelativeTimeLabel,
  resolveSidebarV2TopStatus,
  shouldSidebarRowRecede,
} from "./presentation";

const NOW = new Date("2026-04-08T10:00:00.000Z");

describe("resolveSidebarV2TopStatus", () => {
  const base = {
    workingStartedAt: null as string | null,
    woke: false,
    unseenCompletion: false,
  };

  it("maps working to a sky Working label with its duration anchor", () => {
    const status = resolveSidebarV2TopStatus({
      ...base,
      status: "working",
      workingStartedAt: "2026-04-08T09:00:00.000Z",
    });
    expect(status).toEqual({
      label: "Working",
      color: "sky",
      workingStartedAt: "2026-04-08T09:00:00.000Z",
    });
  });

  it("maps approval/input/failed to their colored labels", () => {
    expect(resolveSidebarV2TopStatus({ ...base, status: "approval" })?.label).toBe("Approval");
    expect(resolveSidebarV2TopStatus({ ...base, status: "approval" })?.color).toBe("amber");
    expect(resolveSidebarV2TopStatus({ ...base, status: "input" })?.label).toBe("Input");
    expect(resolveSidebarV2TopStatus({ ...base, status: "input" })?.color).toBe("indigo");
    expect(resolveSidebarV2TopStatus({ ...base, status: "failed" })?.label).toBe("Failed");
    expect(resolveSidebarV2TopStatus({ ...base, status: "failed" })?.color).toBe("red");
  });

  it("shows Woke and Done for ready rows", () => {
    expect(resolveSidebarV2TopStatus({ ...base, status: "ready", woke: true })?.label).toBe("Woke");
    expect(
      resolveSidebarV2TopStatus({ ...base, status: "ready", unseenCompletion: true })?.label,
    ).toBe("Done");
  });

  it("returns null at rest", () => {
    expect(resolveSidebarV2TopStatus({ ...base, status: "ready" })).toBeNull();
  });
});

describe("shouldSidebarRowRecede", () => {
  it("recedes ready rows that are not actionable", () => {
    expect(
      shouldSidebarRowRecede({
        status: "ready",
        isUnread: false,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(true);
  });

  it("keeps unread, woke, active, and selected rows prominent", () => {
    expect(
      shouldSidebarRowRecede({
        status: "ready",
        isUnread: true,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(false);
    expect(
      shouldSidebarRowRecede({
        status: "ready",
        isUnread: false,
        isWoke: true,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(false);
    expect(
      shouldSidebarRowRecede({
        status: "ready",
        isUnread: false,
        isWoke: false,
        isActive: true,
        isSelected: false,
      }),
    ).toBe(false);
    expect(
      shouldSidebarRowRecede({
        status: "ready",
        isUnread: false,
        isWoke: false,
        isActive: false,
        isSelected: true,
      }),
    ).toBe(false);
  });
});

describe("formatRelativeTimeLabel", () => {
  it("formats now, minutes, hours, days, and dates", () => {
    expect(formatRelativeTimeLabel("2026-04-08T09:59:30.000Z", NOW)).toBe("now");
    expect(formatRelativeTimeLabel("2026-04-08T09:55:00.000Z", NOW)).toBe("5m");
    expect(formatRelativeTimeLabel("2026-04-08T07:00:00.000Z", NOW)).toBe("3h");
    expect(formatRelativeTimeLabel("2026-04-06T10:00:00.000Z", NOW)).toBe("2d");
    expect(formatRelativeTimeLabel("2026-03-01T10:00:00.000Z", NOW)).toMatch(/Mar|3月/);
  });

  it("returns empty for invalid input", () => {
    expect(formatRelativeTimeLabel(null, NOW)).toBe("");
    expect(formatRelativeTimeLabel("bad", NOW)).toBe("");
  });
});
