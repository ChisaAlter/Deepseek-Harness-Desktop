import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { assertUnreachable } from "./exhaustive";

/**
 * Formats a host connection status for UI using the app locale catalog.
 * @param status Host runtime connection status
 * @param t i18n translate function (usually from useTranslation)
 * @returns Localized status label
 */
export function formatConnectionStatus(
  status: HostRuntimeConnectionStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case "online":
      return t("workspace.routeState.status.online");
    case "connecting":
      return t("workspace.routeState.status.connecting");
    case "offline":
      return t("workspace.routeState.status.offline");
    case "error":
      return t("workspace.routeState.status.error");
    case "idle":
      return t("workspace.routeState.status.idle");
    default:
      return assertUnreachable(status);
  }
}

/** Visual tone used when rendering host connection status */
export type ConnectionStatusTone = "success" | "warning" | "error" | "muted";

/**
 * Maps a host connection status to a UI tone token
 * @param status Host runtime connection status
 * @returns Tone used for status dots and labels
 */
export function getConnectionStatusTone(status: HostRuntimeConnectionStatus): ConnectionStatusTone {
  switch (status) {
    case "online":
      return "success";
    case "connecting":
      return "warning";
    case "error":
      return "error";
    case "offline":
      return "warning";
    case "idle":
      return "muted";
    default:
      return assertUnreachable(status);
  }
}
