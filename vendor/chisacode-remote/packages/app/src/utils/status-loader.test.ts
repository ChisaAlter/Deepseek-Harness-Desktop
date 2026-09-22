import { describe, expect, it } from "vitest";
import { shouldRenderSyncedStatusLoader } from "./status-loader";

describe("shouldRenderSyncedStatusLoader", () => {
  it("renders the synced loader only for running status", () => {
    expect(shouldRenderSyncedStatusLoader({ bucket: "running" })).toBe(true);
    expect(shouldRenderSyncedStatusLoader({ bucket: "needs_input" })).toBe(false);
    expect(shouldRenderSyncedStatusLoader({ bucket: "failed" })).toBe(false);
    expect(shouldRenderSyncedStatusLoader({ bucket: "attention" })).toBe(false);
    expect(shouldRenderSyncedStatusLoader({ bucket: "done" })).toBe(false);
    expect(shouldRenderSyncedStatusLoader({ bucket: null })).toBe(false);
  });
});
