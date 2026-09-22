import { describe, expect, it } from "vitest";

import { shouldRunAndroidForegroundService } from "./android-foreground-service-policy";

describe("shouldRunAndroidForegroundService", () => {
  it("runs only while the connected app is in the background", () => {
    expect(
      shouldRunAndroidForegroundService({ appState: "background", connectionStatus: "connected" }),
    ).toBe(true);

    for (const appState of ["active", "inactive", "unknown"] as const) {
      expect(shouldRunAndroidForegroundService({ appState, connectionStatus: "connected" })).toBe(
        false,
      );
    }

    for (const connectionStatus of [
      "idle",
      "connecting",
      "reconnecting",
      "disconnected",
      "disposed",
      "error",
    ] as const) {
      expect(shouldRunAndroidForegroundService({ appState: "background", connectionStatus })).toBe(
        false,
      );
    }
  });
});
