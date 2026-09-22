import { describe, expect, it } from "vitest";
import { unarchiveAgent } from "./archived-agent-unarchive";

describe("unarchiveAgent", () => {
  it("reports refresh failures and restores the retry state", async () => {
    const error = new Error("daemon offline");
    const pendingStates: boolean[] = [];
    const reports: unknown[] = [];

    await unarchiveAgent({
      agentId: "agent-1",
      refreshAgent: async () => {
        throw error;
      },
      reportError: (report) => reports.push(report),
      fallbackMessage: "Unable to unarchive agent",
      setPending: (pending) => pendingStates.push(pending),
    });

    expect(pendingStates).toEqual([true, false]);
    expect(reports).toEqual([
      {
        logLabel: "[ArchivedAgentCallout] Failed to unarchive agent",
        error,
        fallbackMessage: "Unable to unarchive agent",
      },
    ]);
  });
});
