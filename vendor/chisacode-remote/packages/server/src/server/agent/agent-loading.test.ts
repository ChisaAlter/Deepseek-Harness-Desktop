import { describe, expect, test, vi } from "vitest";

import {
  AGENT_PRELOAD_LIMIT,
  preloadAgents,
  selectAgentsForPreload,
  type EnsureAgentLoadedDeps,
} from "./agent-loading.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

describe("selectAgentsForPreload", () => {
  test("returns the top N agents by updatedAt descending", () => {
    const selected = selectAgentsForPreload(
      [
        { id: "a1", updatedAt: "2026-08-01T00:00:00.000Z" },
        { id: "a2", updatedAt: "2026-08-09T00:00:00.000Z" },
        { id: "a3", updatedAt: "2026-08-05T00:00:00.000Z" },
        { id: "a4", updatedAt: "2026-08-08T00:00:00.000Z" },
      ],
      3,
    );

    expect(selected).toEqual(["a2", "a4", "a3"]);
  });

  test("returns only available agents when fewer than N", () => {
    const selected = selectAgentsForPreload(
      [
        { id: "only-1", updatedAt: "2026-08-01T00:00:00.000Z" },
        { id: "only-2", updatedAt: "2026-08-02T00:00:00.000Z" },
      ],
      AGENT_PRELOAD_LIMIT,
    );

    expect(selected).toEqual(["only-2", "only-1"]);
  });

  test("returns empty for empty input or non-positive limit", () => {
    expect(selectAgentsForPreload([], 3)).toEqual([]);
    expect(
      selectAgentsForPreload([{ id: "a1", updatedAt: "2026-08-01T00:00:00.000Z" }], 0),
    ).toEqual([]);
  });

  test("keeps input order for equal timestamps", () => {
    const selected = selectAgentsForPreload(
      [
        { id: "first", updatedAt: "2026-08-01T00:00:00.000Z" },
        { id: "second", updatedAt: "2026-08-01T00:00:00.000Z" },
        { id: "third", updatedAt: "2026-08-01T00:00:00.000Z" },
      ],
      2,
    );
    expect(selected).toEqual(["first", "second"]);
  });
});

describe("preloadAgents", () => {
  test("does not throw when ensureAgentLoaded fails", async () => {
    const logger = createTestLogger();
    const debug = vi.spyOn(logger, "debug");
    const deps: EnsureAgentLoadedDeps = {
      agentManager: {
        getAgent: () => null,
        getRegisteredProviderIds: () => ["codex"],
      } as unknown as AgentManager,
      agentStorage: {
        get: async () => null,
      } as unknown as AgentStorage,
      logger,
    };

    expect(() => preloadAgents(["missing-agent"], deps)).not.toThrow();
    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalled();
    });
  });
});
