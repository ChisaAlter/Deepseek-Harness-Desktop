import { describe, expect, it } from "vitest";
import { runProviderToolingAction } from "./provider-tooling-action";

describe("runProviderToolingAction", () => {
  it("reports failed tooling results with the provider output", async () => {
    const requests: unknown[] = [];
    const reports: unknown[] = [];

    await runProviderToolingAction({
      providerId: "claude",
      action: "reinstall",
      client: {
        runProviderToolingAction: async (providerId, action) => {
          requests.push({ providerId, action });
          return { success: false, stderr: "npm install failed", stdout: "" };
        },
      },
      reportError: (report) => reports.push(report),
      fallbackMessage: "Install failed",
    });

    expect(requests).toEqual([{ providerId: "claude", action: "reinstall" }]);
    expect(reports).toEqual([
      {
        error: new Error("npm install failed"),
        logLabel: "[ProvidersSettings] Failed to reinstall provider claude",
        fallbackMessage: "Install failed",
      },
    ]);
  });
});
