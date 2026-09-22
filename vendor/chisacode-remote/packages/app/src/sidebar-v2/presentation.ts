/**
 * Sidebar V2 row presentation — ported from T3 SidebarV2's status slot
 * (`apps/web/src/components/SidebarV2.tsx` topStatus logic). Five states,
 * three colors: amber = act now, sky = in motion, red = broken; ready is
 * the unlabeled resting state. Unread completion is tracked separately.
 */
import { formatWorkingDurationLabel, type SidebarV2Status } from "./logic";

/** A status slot label with its theme color key. */
export interface SidebarV2TopStatus {
  label: string;
  color: "sky" | "amber" | "indigo" | "red" | "emerald";
  /** ISO timestamp a working duration counts from. */
  workingStartedAt: string | null;
}

/** Inputs for resolving the status slot. */
export interface SidebarV2TopStatusInput {
  status: SidebarV2Status;
  /** ISO timestamp the running turn started (working duration anchor). */
  workingStartedAt: string | null;
  /** True when the thread woke from snooze. */
  woke: boolean;
  /** True when a ready thread completed unseen. */
  unseenCompletion: boolean;
}

/**
 * Resolves the top-status slot: the label + color shown on a card's first
 * line, or null when the row falls back to the relative time label.
 * @param input The status, working anchor, woke, and unseen-completion flags
 * @returns The top status, or null when the row should show a time label
 */
export function resolveSidebarV2TopStatus(
  input: SidebarV2TopStatusInput,
): SidebarV2TopStatus | null {
  switch (input.status) {
    case "working":
      return { label: "Working", color: "sky", workingStartedAt: input.workingStartedAt };
    case "approval":
      return { label: "Approval", color: "amber", workingStartedAt: null };
    case "input":
      return { label: "Input", color: "indigo", workingStartedAt: null };
    case "failed":
      return { label: "Failed", color: "red", workingStartedAt: null };
    case "ready":
      break;
  }
  if (input.woke) {
    return { label: "Woke", color: "amber", workingStartedAt: null };
  }
  if (input.unseenCompletion) {
    return { label: "Done", color: "emerald", workingStartedAt: null };
  }
  return null;
}

/**
 * Whether an in-flight row should visually recede: ready and in-flight rows
 * dim unless they are unread, woke, active, or selected, so only
 * human-actionable rows stand out.
 * @param input The row state
 * @returns True when the row should render dimmed
 */
export function shouldSidebarRowRecede(input: {
  status: SidebarV2Status;
  isUnread: boolean;
  isWoke: boolean;
  isActive: boolean;
  isSelected: boolean;
}): boolean {
  const isInFlight =
    input.status === "working" || input.status === "approval" || input.status === "input";
  const shouldRecede = input.status === "ready" || isInFlight;
  return shouldRecede && !input.isUnread && !input.isWoke && !input.isActive && !input.isSelected;
}

/** Relative-time label: "now", "5m", "3h", "2d", or a date for older items. */
export function formatRelativeTimeLabel(isoTimestamp: string | null, now: Date): string {
  if (!isoTimestamp) {
    return "";
  }
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const nowMs = now.getTime();
  const elapsedMs = nowMs - timestamp;
  if (elapsedMs < 60_000) {
    return "now";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export { formatWorkingDurationLabel };
