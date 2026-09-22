import { describe, expect, it } from "vitest";
import { buildAgentStateSelector } from "@/composer/agent-state-selector";

describe("composer agent state selector", () => {
  it("reuses the empty feature list for missing draft agents", () => {
    const selector = buildAgentStateSelector("server-1", "draft-1");
    const state = { sessions: {} } as Parameters<typeof selector>[0];

    const first = selector(state);
    const second = selector(state);

    expect(second.features).toBe(first.features);
  });
});
