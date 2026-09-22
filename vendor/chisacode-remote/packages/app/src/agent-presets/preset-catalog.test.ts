import { describe, expect, test, vi } from "vitest";
import { agentPresetsQueryKey, fetchAgentPresets } from "./preset-catalog";

describe("agent preset catalog", () => {
  test("uses a host-scoped query key", () => {
    expect(agentPresetsQueryKey("server-1")).toEqual(["agentPresets", "server-1"]);
  });

  test("loads the daemon catalog instead of a local built-in copy", async () => {
    const presets = [
      {
        id: "review",
        label: "Review",
        description: "Review changes",
        provider: "default",
      },
    ];
    const listAgentPresets = vi.fn(async () => ({ presets, requestId: "request-1" }));

    await expect(fetchAgentPresets({ listAgentPresets })).resolves.toEqual(presets);
    expect(listAgentPresets).toHaveBeenCalledOnce();
  });
});
