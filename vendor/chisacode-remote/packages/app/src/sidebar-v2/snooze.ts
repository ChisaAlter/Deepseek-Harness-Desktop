/**
 * Snooze / settle semantics — ported from T3 Code's
 * `packages/client-runtime/src/state/threadSettled.ts` and adapted to
 * ChisaCode's agent model. Snooze/settled state is stored in agent labels
 * (`chisacode.sidebarSnoozedUntil` / `chisacode.sidebarSettledAt` /
 * `chisacode.sidebarSettledOverride`) so it survives restarts and syncs
 * through the daemon, mirroring how `chisacode.sidebarPinned` already works.
 */

/** Agent label keys owned by the sidebar. */
export const SIDEBAR_LABEL_SNOOZED_UNTIL = "chisacode.sidebarSnoozedUntil";
export const SIDEBAR_LABEL_SNOOZED_AT = "chisacode.sidebarSnoozedAt";
export const SIDEBAR_LABEL_SETTLED_AT = "chisacode.sidebarSettledAt";
/** "settled" pins settled; "active" pins active (blocks auto-settle). */
export const SIDEBAR_LABEL_SETTLED_OVERRIDE = "chisacode.sidebarSettledOverride";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

/**
 * A queued turn start lives for at most this long: session adoption takes
 * seconds, so a user message still unadopted after the grace window is a
 * failed start, not pending work.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/** Shell fields used by snooze/settle classification and actions. */
export interface SidebarV2ThreadShell {
  id: string;
  latestUserMessageAt: string | null;
  lastActivityAt: string | null;
  status: string | null;
  lastError: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  snoozedUntil: string | null;
  snoozedAt: string | null;
  settledAt: string | null;
  settledOverride: "settled" | "active" | null;
}

/**
 * A user message no turn has picked up yet. In ChisaCode's agent model there
 * is no turn projection, so "queued" is approximated by a user message
 * strictly newer than every other activity stamp, bounded by the grace
 * window (mirrors T3's guard against clock skew).
 * @param shell The thread shell to inspect
 * @param options Current time
 * @returns True when a queued turn start is still pending
 */
export function hasQueuedTurnStart(
  shell: Pick<SidebarV2ThreadShell, "latestUserMessageAt" | "lastActivityAt" | "status">,
  options: { readonly now: string },
): boolean {
  if (shell.latestUserMessageAt == null) {
    return false;
  }
  if (shell.status === "error") {
    return false;
  }
  const messageAt = Date.parse(shell.latestUserMessageAt);
  if (Number.isNaN(messageAt)) {
    return false;
  }
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) {
    return false;
  }
  if (Math.abs(nowMs - messageAt) > QUEUED_TURN_START_GRACE_MS) {
    return false;
  }
  if (shell.lastActivityAt == null) {
    return true;
  }
  return Date.parse(shell.lastActivityAt) < messageAt;
}

/**
 * A thread may be settled only when none of effectiveSettled's activity
 * blockers hold. Client-side twin of the server invariants so the UI can
 * disable/reject before a round trip.
 * @param shell The thread shell
 * @param options Current time
 * @returns True when settling is allowed
 */
export function canSettle(
  shell: Pick<
    SidebarV2ThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "status"
    | "latestUserMessageAt"
    | "lastActivityAt"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  if (
    shell.status === "starting" ||
    shell.status === "running" ||
    shell.status === "initializing"
  ) {
    return false;
  }
  if (hasQueuedTurnStart(shell, options)) {
    return false;
  }
  return true;
}

/**
 * A snoozed thread "raises its hand" when something happens that outranks
 * the user's snooze: the agent is blocked on them, the session failed after
 * the snooze was set, or a completion landed after the snooze. Raising a
 * hand never clears the snooze fields; it only stops the thread from
 * classifying as snoozed.
 * @param shell The snooze shell to inspect
 * @returns True when the thread demands attention despite the snooze
 */
export function threadRaisedHandWhileSnoozed(
  shell: Pick<
    SidebarV2ThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "status"
    | "lastError"
    | "snoozedAt"
    | "lastActivityAt"
  >,
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return true;
  }
  if (
    (shell.status === "error" || shell.lastError != null) &&
    (shell.snoozedAt == null ||
      (shell.lastActivityAt != null &&
        Date.parse(shell.lastActivityAt) > Date.parse(shell.snoozedAt)))
  ) {
    return true;
  }
  return false;
}

/**
 * A thread may be snoozed unless the agent is blocked on the user: hiding a
 * pending approval or user-input request defeats the request, and a queued
 * turn start is invisible pending work the same way it is for settle.
 * @param shell The thread shell
 * @param options Current time
 * @returns True when snoozing is allowed
 */
export function canSnooze(
  shell: Pick<
    SidebarV2ThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "latestUserMessageAt"
    | "lastActivityAt"
    | "status"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  if (hasQueuedTurnStart(shell, options)) {
    return false;
  }
  return true;
}

/**
 * Snoozed resolution: hidden from the inbox while the wake time is in the
 * future and the thread has not raised its hand. Timer wakes are derived —
 * no event fires when snoozedUntil passes; the stale fields simply stop
 * classifying as snoozed.
 * @param shell The thread shell
 * @param options Current time
 * @returns True when the thread should classify as snoozed
 */
export function effectiveSnoozed(
  shell: Pick<
    SidebarV2ThreadShell,
    | "snoozedUntil"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "status"
    | "lastError"
    | "snoozedAt"
    | "lastActivityAt"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.snoozedUntil == null) {
    return false;
  }
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) {
    return false;
  }
  if (wakeAtMs <= Date.parse(options.now)) {
    return false;
  }
  return !threadRaisedHandWhileSnoozed(shell);
}

/**
 * When a previously-snoozed thread woke, or null if it never snoozed or is
 * still snoozed. Used for the "Woke" indicator: the thread reappears in its
 * original sort position (the inbox sort is deliberately static), so the
 * wake signal has to carry the weight.
 * @param shell The thread shell
 * @param options Current time
 * @returns The wake timestamp, or null
 */
export function threadWokeAt(
  shell: Pick<
    SidebarV2ThreadShell,
    | "snoozedUntil"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "status"
    | "lastError"
    | "snoozedAt"
    | "lastActivityAt"
  >,
  options: { readonly now: string },
): string | null {
  if (shell.snoozedUntil == null) {
    return null;
  }
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) {
    return null;
  }
  if (threadRaisedHandWhileSnoozed(shell)) {
    return shell.lastActivityAt ?? shell.snoozedAt ?? null;
  }
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

/**
 * Settled resolution over the label-backed settle lifecycle. Activity
 * blockers (pending approval/user-input, a live session, an unadjudicated
 * queued turn) hold a thread active regardless of any override. Past the
 * blockers, the explicit user override wins in both directions; without
 * one, a thread auto-settles on inactivity past the window.
 * @param shell The thread shell
 * @param options Current time, auto-settle window, and optional PR state
 * @returns True when the thread should classify as settled
 */
export function effectiveSettled(
  shell: Pick<
    SidebarV2ThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "status"
    | "latestUserMessageAt"
    | "lastActivityAt"
    | "settledAt"
    | "settledOverride"
  >,
  options: {
    readonly now: string;
    readonly autoSettleAfterDays: number | null;
    readonly changeRequestState?: "open" | "closed" | "merged" | null;
  },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  if (
    shell.status === "starting" ||
    shell.status === "running" ||
    shell.status === "initializing"
  ) {
    return false;
  }
  if (hasQueuedTurnStart(shell, options)) {
    const serverAdjudicated =
      shell.settledOverride === "settled" &&
      shell.settledAt !== null &&
      shell.latestUserMessageAt !== null &&
      Date.parse(shell.settledAt) >= Date.parse(shell.latestUserMessageAt);
    if (!serverAdjudicated) {
      return false;
    }
  }
  if (shell.settledOverride === "settled") {
    return true;
  }
  if (shell.settledOverride === "active") {
    return false;
  }
  if (options.changeRequestState === "merged" || options.changeRequestState === "closed") {
    return true;
  }
  if (options.changeRequestState === "open") {
    return false;
  }
  if (options.autoSettleAfterDays === null) {
    return false;
  }
  if (shell.lastActivityAt === null) {
    return false;
  }
  return (
    Date.parse(shell.lastActivityAt) <
    Date.parse(options.now) - options.autoSettleAfterDays * DAY_MS
  );
}

export type SnoozePresetId = "hour" | "evening" | "tomorrow" | "next-week";

export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  /** Menu-row time column; complements the label instead of repeating it. */
  readonly whenLabel: string;
  /** ISO wake time. */
  readonly snoozedUntil: string;
}

function snoozeTimeOfDayLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function snoozeAtHour(base: Date, hour: number): Date {
  const next = new Date(base);
  next.setHours(hour, 0, 0, 0);
  return next;
}

// Calendar-day advance instead of adding DAY_MS: fixed millisecond offsets
// land on the wrong local day across DST transitions.
function addSnoozeDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Shared "snooze until" choices for every client. "This evening" only
 * appears while it is meaningfully before evening.
 * @param now The reference time for preset math
 * @returns The snooze presets in menu order
 */
export function resolveSnoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  const inAnHour = new Date(now.getTime() + HOUR_MS);
  const presets: SnoozePreset[] = [
    {
      id: "hour",
      label: "In 1 hour",
      whenLabel: snoozeTimeOfDayLabel(inAnHour),
      snoozedUntil: inAnHour.toISOString(),
    },
  ];

  const evening = snoozeAtHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      whenLabel: snoozeTimeOfDayLabel(evening),
      snoozedUntil: evening.toISOString(),
    });
  }

  const tomorrow = snoozeAtHour(addSnoozeDays(now, 1), MORNING_HOUR);
  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    whenLabel: snoozeTimeOfDayLabel(tomorrow),
    snoozedUntil: tomorrow.toISOString(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = snoozeAtHour(addSnoozeDays(now, daysUntilMonday), MORNING_HOUR);
  presets.push({
    id: "next-week",
    label: "Next week",
    whenLabel: `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${snoozeTimeOfDayLabel(nextWeek)}`,
    snoozedUntil: nextWeek.toISOString(),
  });

  return presets;
}

/**
 * Compact "wakes in" label for snoozed rows: "2h", "18h", "3d". Minutes
 * round up so a snooze never reads "0m" while still hidden.
 * @param snoozedUntil The wake timestamp
 * @param options Current time
 * @returns The compact wake label
 */
export function snoozeWakeLabel(snoozedUntil: string, options: { readonly now: string }): string {
  const wakeMs = Date.parse(snoozedUntil);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(wakeMs) || Number.isNaN(nowMs)) {
    return "now";
  }
  const remainingMs = wakeMs - nowMs;
  if (remainingMs <= 0) {
    return "now";
  }
  if (remainingMs < HOUR_MS) {
    return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
  }
  if (remainingMs < DAY_MS) {
    return `${Math.ceil(remainingMs / HOUR_MS)}h`;
  }
  return `${Math.ceil(remainingMs / DAY_MS)}d`;
}

/**
 * Human wake time for menus and toasts: "tomorrow 9:00", "Mon 9:00",
 * "17:30" (today). Ported from T3's Sidebar.snooze.ts.
 * @param snoozedUntil The wake timestamp
 * @param now The reference time
 * @returns The human-readable wake description
 */
export function snoozeWakeDescription(snoozedUntil: string, now: Date): string {
  const wake = new Date(snoozedUntil);
  if (Number.isNaN(wake.getTime())) {
    return "";
  }
  const time = wake.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDelta = Math.floor((wake.getTime() - startOfToday.getTime()) / DAY_MS);
  if (dayDelta === 0) {
    return time;
  }
  if (dayDelta === 1) {
    return `tomorrow ${time}`;
  }
  const weekday = wake.toLocaleDateString(undefined, { weekday: "short" });
  if (dayDelta < 7) {
    return `${weekday} ${time}`;
  }
  const date = wake.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}
