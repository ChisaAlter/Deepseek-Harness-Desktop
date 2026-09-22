import { describe, expect, it } from "vitest";
import {
  buildOrderedThreadKeys,
  planForwardNavigationTarget,
  resolveSelectedThreads,
} from "./actions";
import type { SidebarV2Thread } from "./agent-adapter";

function thread(id: string, serverId = "s1"): SidebarV2Thread {
  return {
    id,
    serverId,
    title: id,
    provider: "mock",
    status: "idle",
    lastError: null,
    lastActivityAt: "2026-04-08T10:00:00.000Z",
    latestUserMessageAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-08T10:00:00.000Z",
    archivedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    snoozedUntil: null,
    snoozedAt: null,
    settledAt: null,
    settledOverride: null,
    projectKey: "p",
    projectName: "p",
    branch: null,
    cwd: "/tmp",
    worktreePath: null,
    changeRequestState: null,
    lastVisitedAt: null,
    requiresFinishedAttention: false,
    model: null,
  };
}

describe("planForwardNavigationTarget", () => {
  it("returns null when parked thread is not the open route", () => {
    expect(
      planForwardNavigationTarget({
        routeThreadKey: "s1:a",
        parkedThreadKey: "s1:b",
        orderedThreadKeys: ["s1:a", "s1:b", "s1:c"],
        settledThreadKeys: new Set(),
        snoozedThreadKeys: new Set(),
      }),
    ).toBeNull();
  });

  it("picks the next active card after the parked thread", () => {
    expect(
      planForwardNavigationTarget({
        routeThreadKey: "s1:a",
        parkedThreadKey: "s1:a",
        orderedThreadKeys: ["s1:a", "s1:b", "s1:c"],
        settledThreadKeys: new Set(["s1:b"]),
        snoozedThreadKeys: new Set(),
      }),
    ).toBe("s1:c");
  });

  it("skips co-parking keys from a bulk batch", () => {
    expect(
      planForwardNavigationTarget({
        routeThreadKey: "s1:a",
        parkedThreadKey: "s1:a",
        orderedThreadKeys: ["s1:a", "s1:b", "s1:c"],
        settledThreadKeys: new Set(),
        snoozedThreadKeys: new Set(),
        coParkingKeys: new Set(["s1:a", "s1:b"]),
      }),
    ).toBe("s1:c");
  });
});

describe("buildOrderedThreadKeys / resolveSelectedThreads", () => {
  it("builds composite keys and resolves selected threads", () => {
    const threads = [thread("a"), thread("b")];
    const keys = buildOrderedThreadKeys(threads);
    expect(keys).toEqual(["s1:a", "s1:b"]);
    const map = new Map(threads.map((item, index) => [keys[index]!, item] as const));
    expect(resolveSelectedThreads(["s1:b", "missing"], map).map((item) => item.id)).toEqual(["b"]);
  });
});
