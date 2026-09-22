import type { SidebarV2Thread } from "./agent-adapter";
import { sidebarV2ThreadKey } from "./store";

/**
 * Plans post-settle / post-snooze forward navigation, matching T3:
 * next remaining active card, else null (caller may open a new conversation).
 * Only navigates when the parked thread is currently open.
 * @param input Route thread, ordered visible keys, settled/snoozed sets, and co-parking batch
 * @returns The next thread id to open, or null when none remains
 */
export function planForwardNavigationTarget(input: {
  routeThreadKey: string | null;
  parkedThreadKey: string;
  orderedThreadKeys: readonly string[];
  settledThreadKeys: ReadonlySet<string>;
  snoozedThreadKeys: ReadonlySet<string>;
  coParkingKeys?: ReadonlySet<string>;
}): string | null {
  if (input.routeThreadKey !== input.parkedThreadKey) {
    return null;
  }
  const currentIndex = input.orderedThreadKeys.indexOf(input.parkedThreadKey);
  if (currentIndex === -1) {
    return null;
  }
  const rotated = [
    ...input.orderedThreadKeys.slice(currentIndex + 1),
    ...input.orderedThreadKeys.slice(0, currentIndex),
  ];
  for (const key of rotated) {
    if (input.settledThreadKeys.has(key)) {
      continue;
    }
    if (input.snoozedThreadKeys.has(key)) {
      continue;
    }
    if (input.coParkingKeys?.has(key)) {
      continue;
    }
    return key;
  }
  return null;
}

/**
 * Builds ordered visible thread keys for multi-select range and forward navigation.
 * @param threads Active + visible snoozed + visible settled, already in render order
 * @returns Composite keys in render order
 */
export function buildOrderedThreadKeys(threads: readonly SidebarV2Thread[]): string[] {
  return threads.map((thread) => sidebarV2ThreadKey(thread.serverId, thread.id));
}

/**
 * Filters selected keys down to threads that are currently rendered.
 * @param selectedKeys Multi-select keys from the store
 * @param threadByKey Currently rendered threads keyed by composite id
 * @returns Selected threads that are actionable right now
 */
export function resolveSelectedThreads(
  selectedKeys: readonly string[],
  threadByKey: ReadonlyMap<string, SidebarV2Thread>,
): SidebarV2Thread[] {
  const selected: SidebarV2Thread[] = [];
  for (const key of selectedKeys) {
    const thread = threadByKey.get(key);
    if (thread) {
      selected.push(thread);
    }
  }
  return selected;
}
