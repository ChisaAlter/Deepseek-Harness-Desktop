import type { ConnectionState } from "@chisacode/client/internal/daemon-client";
import type { AppStateStatus } from "react-native";

interface AndroidForegroundServicePolicyInput {
  appState: AppStateStatus | "unknown";
  connectionStatus: ConnectionState["status"] | "reconnecting" | "error";
}

/**
 * Determines whether Android needs a foreground service to retain the daemon connection.
 * @param input Current native app state and daemon connection status
 * @returns Whether the foreground service should be running
 */
export function shouldRunAndroidForegroundService({
  appState,
  connectionStatus,
}: AndroidForegroundServicePolicyInput): boolean {
  return appState === "background" && connectionStatus === "connected";
}
