/**
 * Sidebar V2 logic — ported from T3 Code's `apps/web/src/components/Sidebar.logic.ts`
 * (pingdotgg/t3code) and adapted to ChisaCode's agent model.
 *
 * Ported rules are kept close to the original: static creation order (newest
 * thread on top), activity never reorders rows, settled rows sort by when the
 * work ended, NaN-safe timestamp parsing, and title-only search preserving
 * lifecycle order.
 */

/** Five visual states, three colors: amber = act now, sky = in motion, red = broken. */
export type SidebarV2Status = "approval" | "input" | "working" | "failed" | "ready";

/** Minimal session-like shape used for status resolution. */
export interface SidebarV2StatusInput {
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  status: string | null;
  lastError: string | null;
}

/**
 * NaN-safe Date.parse for sort comparators: a malformed timestamp must not
 * poison the whole ordering, so it sinks to the epoch instead.
 * @param isoDate The ISO timestamp to parse
 * @returns Epoch milliseconds, or 0 when unparseable
 */
export function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * First VALID timestamp wins: falls through on null AND on present-but-malformed
 * strings rather than sinking the row to the epoch.
 * @param candidates Timestamp candidates in priority order
 * @returns Epoch milliseconds of the first valid candidate, or 0
 */
export function firstValidTimestampMs(
  ...candidates: ReadonlyArray<string | null | undefined>
): number {
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

/**
 * String twin of firstValidTimestampMs for display labels and tick anchors.
 * @param candidates Timestamp candidates in priority order
 * @returns The first valid ISO string, or null
 */
export function firstValidTimestamp(
  ...candidates: ReadonlyArray<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    if (!Number.isNaN(Date.parse(candidate))) {
      return candidate;
    }
  }
  return null;
}

/**
 * v2 sort: static creation order, newest thread on top. Activity NEVER
 * reorders the list — a row holds its position from open until settled.
 * @param threads The threads to sort
 * @returns A sorted copy, newest createdAt first with id tie-break
 */
export function sortThreadsForSidebarV2<
  T extends { readonly id: string; readonly createdAt: string },
>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** Timestamp candidates a settled row sorts by. */
export interface SettledTimestampInput {
  settledAt: string | null;
  latestUserMessageAt: string | null;
  updatedAt: string;
}

/**
 * The timestamp a settled row sorts and labels by: settledAt when stamped
 * (explicit settles), otherwise last activity (user message first, then the
 * session's updatedAt).
 * @param thread The settled thread to resolve
 * @returns The ISO timestamp the row should sort by, or null
 */
export function resolveSettledTimestamp(thread: SettledTimestampInput): string | null {
  const settledAt = firstValidTimestamp(thread.settledAt);
  if (settledAt !== null) {
    return settledAt;
  }
  return firstValidTimestamp(thread.latestUserMessageAt, thread.updatedAt);
}

/**
 * Settled rows are history, so they order by when the work ENDED, not when
 * the thread was created or last touched.
 * @param threads The settled threads to sort
 * @returns A sorted copy, most recently settled first with id tie-break
 */
export function sortSettledThreadsForSidebarV2<
  T extends SettledTimestampInput & { readonly id: string },
>(threads: readonly T[]): T[] {
  return [...threads].sort((left, right) => {
    const leftMs = parseTimestampMs(resolveSettledTimestamp(left) ?? "");
    const rightMs = parseTimestampMs(resolveSettledTimestamp(right) ?? "");
    return rightMs - leftMs || left.id.localeCompare(right.id);
  });
}

/**
 * Resolves the v2 status of a thread: approval outranks input, input outranks
 * working, working outranks failed, everything else is ready.
 * @param input The thread signals needed for status resolution
 * @returns The resolved status
 */
export function resolveSidebarV2Status(input: SidebarV2StatusInput): SidebarV2Status {
  if (input.hasPendingApprovals) {
    return "approval";
  }
  if (input.hasPendingUserInput) {
    return "input";
  }
  if (input.status === "running" || input.status === "initializing") {
    return "working";
  }
  if (input.status === "error" || input.lastError) {
    return "failed";
  }
  return "ready";
}

/** A status pill: label plus theme token names, mirroring T3's pill model. */
export interface ThreadStatusPill {
  label: string;
  color: "amber" | "indigo" | "sky" | "violet" | "emerald" | "red";
  dotColor: string;
  pulse: boolean;
}

/** Priority order for picking a project's representative status pill. */
export const THREAD_STATUS_PRIORITY: Record<string, number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

/** Signals used to decide a thread's status pill. */
export interface ThreadStatusInput {
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  status: string | null;
  interactionMode: string | null;
  hasActionableProposedPlan: boolean;
  completedAt: string | null;
  lastVisitedAt: string | null;
  lastError: string | null;
}

/**
 * Whether a ready thread completed unseen since the user last visited it.
 * @param input Completion and visit timestamps
 * @returns True when the thread completed after the last visit (never visited = read)
 */
export function hasUnseenCompletion(input: {
  completedAt: string | null;
  lastVisitedAt: string | null;
}): boolean {
  if (!input.completedAt) {
    return false;
  }
  const completedAt = Date.parse(input.completedAt);
  if (Number.isNaN(completedAt)) {
    return false;
  }
  if (!input.lastVisitedAt) {
    return false;
  }
  const lastVisitedAt = Date.parse(input.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) {
    return true;
  }
  return completedAt > lastVisitedAt;
}

/**
 * Resolves the status pill for a thread (v1-style pill, used by project
 * indicators). Returns null when the thread is at rest with nothing new.
 * @param input The thread signals for pill resolution
 * @returns The pill, or null when none applies
 */
export function resolveThreadStatusPill(input: ThreadStatusInput): ThreadStatusPill | null {
  if (input.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      color: "amber",
      dotColor: "statusWarningBg",
      pulse: false,
    };
  }
  if (input.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      color: "indigo",
      dotColor: "accent",
      pulse: false,
    };
  }
  if (input.status === "running") {
    return { label: "Working", color: "sky", dotColor: "accentBright", pulse: true };
  }
  if (input.status === "initializing") {
    return { label: "Connecting", color: "sky", dotColor: "accentBright", pulse: true };
  }
  const hasPlanReadyPrompt =
    !input.hasPendingUserInput &&
    input.interactionMode === "plan" &&
    input.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return { label: "Plan Ready", color: "violet", dotColor: "accentNeon", pulse: false };
  }
  if (hasUnseenCompletion(input)) {
    return { label: "Completed", color: "emerald", dotColor: "success", pulse: false };
  }
  if (input.status === "error" || input.lastError) {
    return { label: "Failed", color: "red", dotColor: "destructive", pulse: false };
  }
  return null;
}

/**
 * Picks the highest-priority pill among a project's threads.
 * @param statuses The per-thread pills (nulls skipped)
 * @returns The representative pill, or null when every thread is at rest
 */
export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;
  for (const status of statuses) {
    if (status === null) {
      continue;
    }
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }
  return highestPriorityStatus;
}

/**
 * Search the already-ordered sidebar thread collection by title only.
 * Keeping the input order means lifecycle ordering (active, snoozed, settled)
 * remains stable while the user narrows the list.
 * @param threads The ordered threads to search
 * @param query The title query
 * @returns Matching threads in input order; [] for a blank query
 */
export function searchSidebarThreadsByTitle<T extends { readonly title: string | null }>(
  threads: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }
  return threads.filter((thread) => (thread.title ?? "").toLowerCase().includes(normalizedQuery));
}

/**
 * Limits a project's thread list for preview, guaranteeing the active thread
 * stays visible even when the list is collapsed.
 * @param input The threads, active id, expanded flag, and preview limit
 * @returns The visible threads plus hidden-count bookkeeping
 */
export function getVisibleThreadsForProject<T extends { readonly id: string }>(input: {
  threads: readonly T[];
  activeThreadId: string | null;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): { hasHiddenThreads: boolean; visibleThreads: T[]; hiddenThreads: T[] } {
  const { threads, activeThreadId, isThreadListExpanded, previewLimit } = input;
  if (isThreadListExpanded || threads.length <= previewLimit) {
    return {
      hasHiddenThreads: threads.length > previewLimit,
      visibleThreads: [...threads],
      hiddenThreads: [],
    };
  }
  const activeIndex = activeThreadId
    ? threads.findIndex((thread) => thread.id === activeThreadId)
    : -1;
  const visible =
    activeIndex >= 0 && activeIndex >= previewLimit
      ? [threads[activeIndex], ...threads.slice(0, previewLimit - 1)].filter(
          (thread): thread is T => thread !== undefined,
        )
      : threads.slice(0, previewLimit);
  const visibleIds = new Set(visible.map((thread) => thread.id));
  const hidden = threads.filter((thread) => !visibleIds.has(thread.id));
  return { hasHiddenThreads: hidden.length > 0, visibleThreads: visible, hiddenThreads: hidden };
}

/**
 * Stable reorder placing items whose ids appear in preferredIds first (in
 * preferred order), each item consumed once; the remainder keeps input order.
 * @param input The items, preferred ids, and id accessors
 * @returns The reordered items
 */
export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const remaining = [...input.items];
  const ordered: TItem[] = [];
  const usedIndices = new Set<number>();
  for (const preferredId of input.preferredIds) {
    const index = remaining.findIndex(
      (item, itemIndex) => !usedIndices.has(itemIndex) && input.getId(item) === preferredId,
    );
    if (index === -1) {
      continue;
    }
    usedIndices.add(index);
    ordered.push(remaining[index]);
  }
  for (let index = 0; index < remaining.length; index++) {
    if (!usedIndices.has(index)) {
      ordered.push(remaining[index]);
    }
  }
  return ordered;
}

/**
 * The timestamp a working thread's elapsed label counts from: the last user
 * message (closest analog to turn start in ChisaCode's agent model), falling
 * back to the session's last transition. ChisaCode has no turn model, so this
 * is an approximation of T3's latestTurn.startedAt → requestedAt → updatedAt.
 * @param input The user-message and update timestamps
 * @returns The working-start ISO string, or null
 */
export function resolveWorkingStartedAt(input: {
  lastUserMessageAt: string | null;
  updatedAt: string;
}): string | null {
  return firstValidTimestamp(input.lastUserMessageAt, input.updatedAt);
}

/**
 * Formats an elapsed duration like T3: <60s → "Ns", <60m → "Nm", else "Xh Ym".
 * @param elapsedMs The elapsed milliseconds
 * @returns The compact duration label
 */
export function formatWorkingDurationLabel(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
