import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { MAX_VISIBLE_WORK_LOG_ENTRIES, deriveWorkLogCollapse } from "./turn-fold";

function makeToolCall(id: string): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(1000),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Read",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: "file.txt", output: null },
      },
    },
  };
}

describe("deriveWorkLogCollapse", () => {
  it("returns an empty result for no entries", () => {
    const result = deriveWorkLogCollapse({ toolEntries: [], expanded: false });
    expect(result.visibleEntries).toEqual([]);
    expect(result.hiddenCount).toBe(0);
    expect(result.hasHidden).toBe(false);
  });

  it("keeps everything when at or below the max visible count", () => {
    const entries = [makeToolCall("t1")];
    const result = deriveWorkLogCollapse({ toolEntries: entries, expanded: false });
    expect(result.visibleEntries).toEqual(entries);
    expect(result.hiddenCount).toBe(0);
    expect(result.hasHidden).toBe(false);
  });

  it("collapses to the last entry when more than max visible", () => {
    const entries = [makeToolCall("t1"), makeToolCall("t2"), makeToolCall("t3")];
    const result = deriveWorkLogCollapse({ toolEntries: entries, expanded: false });
    expect(result.visibleEntries.map((entry) => entry.id)).toEqual(["t3"]);
    expect(result.hiddenCount).toBe(2);
    expect(result.hasHidden).toBe(true);
  });

  it("shows everything when expanded", () => {
    const entries = [makeToolCall("t1"), makeToolCall("t2"), makeToolCall("t3")];
    const result = deriveWorkLogCollapse({ toolEntries: entries, expanded: true });
    expect(result.visibleEntries.map((entry) => entry.id)).toEqual(["t1", "t2", "t3"]);
    expect(result.hiddenCount).toBe(2);
    expect(result.hasHidden).toBe(true);
  });

  it("honors a custom maxVisible", () => {
    const entries = [makeToolCall("t1"), makeToolCall("t2"), makeToolCall("t3")];
    const result = deriveWorkLogCollapse({ toolEntries: entries, expanded: false, maxVisible: 2 });
    expect(result.visibleEntries.map((entry) => entry.id)).toEqual(["t2", "t3"]);
    expect(result.hiddenCount).toBe(1);
  });

  it("exposes the default max visible count", () => {
    expect(MAX_VISIBLE_WORK_LOG_ENTRIES).toBe(1);
  });

  it("preserves entry identity for memoized row rendering", () => {
    const entries = [makeToolCall("t1"), makeToolCall("t2")];
    const result = deriveWorkLogCollapse({ toolEntries: entries, expanded: false });
    expect(result.visibleEntries[0]).toBe(entries[1]);
  });
});
