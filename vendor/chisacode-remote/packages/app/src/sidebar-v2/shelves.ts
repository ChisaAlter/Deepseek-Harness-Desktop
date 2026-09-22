/**
 * Sidebar V2 shelf partition — ported from T3 Code's SidebarV2 partition
 * memo (`apps/web/src/components/SidebarV2.tsx`) and the mobile twin
 * (`apps/mobile/src/features/threads/threadListV2.ts`). Threads partition
 * into active / snoozed / settled; snooze outranks settle; archived threads
 * are excluded entirely; the route thread stays visible across paging and
 * collapsed shelves.
 */
import {
  effectiveSettled,
  effectiveSnoozed,
  threadWokeAt,
  type SidebarV2ThreadShell,
} from "./snooze";
import {
  resolveSettledTimestamp,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
} from "./logic";

/** Default size of the settled tail before "Show more". */
export const SETTLED_TAIL_INITIAL_COUNT = 10;
/** Page size added by "Show more". */
export const SETTLED_TAIL_PAGE_COUNT = 25;

/** Shelf defaults: settled expands, snoozed collapses. */
export interface ShelfExpansionState {
  settledShelfExpanded: boolean;
  snoozedShelfExpanded: boolean;
}

export const DEFAULT_SHELF_EXPANSION: ShelfExpansionState = {
  settledShelfExpanded: true,
  snoozedShelfExpanded: false,
};

/** Inputs consumed by the partition; structurally satisfied by the adapter's thread model. */
export type PartitionableThread = SidebarV2ThreadShell & {
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The partition result: three shelves plus wake bookkeeping. */
export interface SidebarV2Partition<T extends PartitionableThread> {
  activeThreads: T[];
  snoozedThreads: T[];
  settledThreads: T[];
  /** Soonest upcoming snooze wake; null when nothing is snoozed. */
  nextSnoozeWakeAt: string | null;
}

/**
 * Partitions threads into the three v2 shelves.
 * @param input The threads, current time, auto-settle window, and optional PR state lookup
 * @returns The partitioned shelves, each in its shelf's sort order
 */
export function partitionThreadsForSidebarV2<T extends PartitionableThread>(input: {
  threads: readonly T[];
  now: string;
  snoozeNow: string;
  autoSettleAfterDays: number | null;
  changeRequestStateByKey?: ReadonlyMap<string, "open" | "closed" | "merged" | null>;
}): SidebarV2Partition<T> {
  const active: T[] = [];
  const snoozed: T[] = [];
  const settled: T[] = [];

  for (const thread of input.threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    // Snooze outranks settled classification: an explicitly snoozed thread
    // belongs to the shelf even if it would also auto-settle.
    if (effectiveSnoozed(thread, { now: input.snoozeNow })) {
      snoozed.push(thread);
      continue;
    }
    const changeRequestState = input.changeRequestStateByKey?.get(thread.id) ?? null;
    if (
      effectiveSettled(thread, {
        now: input.now,
        autoSettleAfterDays: input.autoSettleAfterDays,
        changeRequestState,
      })
    ) {
      settled.push(thread);
      continue;
    }
    active.push(thread);
  }

  const nextSnoozeWakeAt = computeNextSnoozeWakeAt(snoozed, input.snoozeNow);

  return {
    activeThreads: sortThreadsForSidebarV2(active),
    snoozedThreads: sortSnoozedThreadsForSidebarV2(snoozed),
    settledThreads: sortSettledThreadsForSidebarV2(settled),
    nextSnoozeWakeAt,
  };
}

/**
 * Soonest upcoming wake among snoozed threads; null when nothing is snoozed.
 * @param snoozedThreads The snoozed shelf (any order)
 * @param now The reference time
 * @returns The earliest ISO wake timestamp, or null
 */
export function computeNextSnoozeWakeAt(
  snoozedThreads: readonly Pick<PartitionableThread, "snoozedUntil">[],
  now: string,
): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const thread of snoozedThreads) {
    if (thread.snoozedUntil == null) {
      continue;
    }
    const wakeMs = Date.parse(thread.snoozedUntil);
    if (Number.isNaN(wakeMs) || wakeMs <= Date.parse(now)) {
      continue;
    }
    if (wakeMs < earliestMs) {
      earliest = thread.snoozedUntil;
      earliestMs = wakeMs;
    }
  }
  return earliest;
}

/**
 * Snoozed rows sort by soonest wake first: "what comes back next" is the
 * shelf's question.
 * @param threads The snoozed threads
 * @returns A sorted copy, soonest wake first with id tie-break
 */
export function sortSnoozedThreadsForSidebarV2<
  T extends { readonly id: string; readonly snoozedUntil: string | null },
>(threads: readonly T[]): T[] {
  return [...threads].sort((left, right) => {
    const leftMs =
      left.snoozedUntil == null ? Number.POSITIVE_INFINITY : Date.parse(left.snoozedUntil);
    const rightMs =
      right.snoozedUntil == null ? Number.POSITIVE_INFINITY : Date.parse(right.snoozedUntil);
    const diff =
      (Number.isNaN(leftMs) ? Number.POSITIVE_INFINITY : leftMs) -
      (Number.isNaN(rightMs) ? Number.POSITIVE_INFINITY : rightMs);
    return diff || left.id.localeCompare(right.id);
  });
}

/** A woke thread's signal: the wake timestamp when it should show "Woke". */
export function resolveThreadWokeTimestamp(
  thread: PartitionableThread,
  now: string,
): string | null {
  return threadWokeAt(thread, { now });
}

/** Settled-time label source: settledAt when stamped, else last activity. */
export function resolveSettledLabelTimestamp(thread: PartitionableThread): string | null {
  return resolveSettledTimestamp(thread);
}

/**
 * Applies settled-tail paging, guaranteeing the route thread stays visible
 * even past the page boundary.
 * @param input The settled shelf, visible count, route thread key, and expansion state
 * @returns The rendered settled rows plus how many are hidden
 */
export function pageSettledThreads<T extends { readonly id: string }>(input: {
  settledThreads: readonly T[];
  settledVisibleCount: number;
  routeThreadKey: string | null;
  settledShelfExpanded: boolean;
}): { visibleSettledThreads: T[]; hiddenSettledCount: number } {
  const { settledThreads, settledVisibleCount, routeThreadKey, settledShelfExpanded } = input;
  if (!settledShelfExpanded) {
    if (routeThreadKey === null) {
      return { visibleSettledThreads: [], hiddenSettledCount: settledThreads.length };
    }
    const routeThread = settledThreads.find((thread) => thread.id === routeThreadKey);
    if (routeThread === undefined) {
      return { visibleSettledThreads: [], hiddenSettledCount: settledThreads.length };
    }
    return { visibleSettledThreads: [routeThread], hiddenSettledCount: settledThreads.length - 1 };
  }
  if (settledThreads.length <= settledVisibleCount) {
    return { visibleSettledThreads: [...settledThreads], hiddenSettledCount: 0 };
  }
  const visible = settledThreads.slice(0, settledVisibleCount);
  if (routeThreadKey !== null) {
    const routeIndex = settledThreads.findIndex((thread) => thread.id === routeThreadKey);
    if (routeIndex >= settledVisibleCount) {
      const routeThread = settledThreads[routeIndex];
      if (routeThread !== undefined) {
        visible[visible.length - 1] = routeThread;
      }
    }
  }
  return {
    visibleSettledThreads: visible,
    hiddenSettledCount: settledThreads.length - visible.length,
  };
}

/** The next visible-count step for the settled tail. */
export function nextSettledVisibleCount(current: number): number {
  return current + SETTLED_TAIL_PAGE_COUNT;
}
