import { describe, expect, test } from "vitest";

import type { AgentModelDefinition } from "./agent-sdk-types.js";
import {
  buildModelCatalog,
  defaultModelForProvider,
  estimateTurnCost,
  findCatalogModel,
  formatContextWindow,
  modelsForProvider,
} from "./model-catalog.js";

function model(partial: Partial<AgentModelDefinition> & { id: string }): AgentModelDefinition {
  return { provider: "test", label: partial.id, ...partial };
}

describe("buildModelCatalog", () => {
  test("merges models from multiple providers", () => {
    const catalog = buildModelCatalog([
      { provider: "claude", models: [model({ id: "opus" }), model({ id: "sonnet" })] },
      { provider: "codex", models: [model({ id: "gpt-5.5" })] },
    ]);
    expect(catalog.models).toHaveLength(3);
    expect(catalog.assembledAt).toBeTypeOf("number");
  });

  test("deduplicates within same provider (first wins)", () => {
    const catalog = buildModelCatalog([
      {
        provider: "claude",
        models: [model({ id: "opus", label: "First" }), model({ id: "opus", label: "Duplicate" })],
      },
    ]);
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0].label).toBe("First");
  });

  test("allows same id across different providers", () => {
    const catalog = buildModelCatalog([
      { provider: "claude", models: [model({ id: "shared" })] },
      { provider: "codex", models: [model({ id: "shared" })] },
    ]);
    expect(catalog.models).toHaveLength(2);
  });
});

describe("findCatalogModel", () => {
  const catalog = buildModelCatalog([
    { provider: "claude", models: [model({ id: "opus" })] },
    { provider: "codex", models: [model({ id: "gpt" })] },
  ]);

  test("finds existing model", () => {
    expect(findCatalogModel(catalog, "claude", "opus")?.id).toBe("opus");
  });

  test("returns undefined for missing model", () => {
    expect(findCatalogModel(catalog, "claude", "gpt")).toBeUndefined();
    expect(findCatalogModel(catalog, "unknown", "opus")).toBeUndefined();
  });
});

describe("modelsForProvider", () => {
  test("filters by provider", () => {
    const catalog = buildModelCatalog([
      { provider: "claude", models: [model({ id: "a" }), model({ id: "b" })] },
      { provider: "codex", models: [model({ id: "c" })] },
    ]);
    expect(modelsForProvider(catalog, "claude")).toHaveLength(2);
    expect(modelsForProvider(catalog, "codex")).toHaveLength(1);
    expect(modelsForProvider(catalog, "unknown")).toHaveLength(0);
  });
});

describe("defaultModelForProvider", () => {
  test("returns model with isDefault", () => {
    const catalog = buildModelCatalog([
      {
        provider: "claude",
        models: [model({ id: "a" }), model({ id: "b", isDefault: true })],
      },
    ]);
    expect(defaultModelForProvider(catalog, "claude")?.id).toBe("b");
  });

  test("falls back to first model", () => {
    const catalog = buildModelCatalog([
      { provider: "claude", models: [model({ id: "a" }), model({ id: "b" })] },
    ]);
    expect(defaultModelForProvider(catalog, "claude")?.id).toBe("a");
  });

  test("returns undefined for empty provider", () => {
    const catalog = buildModelCatalog([]);
    expect(defaultModelForProvider(catalog, "claude")).toBeUndefined();
  });
});

describe("formatContextWindow", () => {
  test("formats millions", () => {
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
  });

  test("formats thousands", () => {
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(128_000)).toBe("128K");
  });

  test("formats small values", () => {
    expect(formatContextWindow(8192)).toBe("8K");
    expect(formatContextWindow(500)).toBe("500");
  });
});

describe("estimateTurnCost", () => {
  test("returns null without cost data", () => {
    expect(estimateTurnCost(undefined, { input: 1000, output: 500 })).toBeNull();
  });

  test("calculates cost from token counts", () => {
    const cost = { input: 15, output: 75 };
    const result = estimateTurnCost(cost, { input: 1_000_000, output: 1_000_000 });
    expect(result).toBe(90); // 15 + 75
  });

  test("includes cache costs when provided", () => {
    const cost = { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 };
    const result = estimateTurnCost(cost, {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    });
    expect(result).toBe(22.125); // 3 + 15 + 0.375 + 3.75
  });

  test("returns null for empty cost object (unknown pricing, not free)", () => {
    // A defined-but-empty cost means "no pricing info"; the UI must show "—"
    // rather than reporting $0.00.
    expect(estimateTurnCost({}, { input: 1_000_000, output: 1_000_000 })).toBeNull();
  });

  test("applies a zero cacheRead rate instead of skipping it", () => {
    // A literal 0 rate (free cache reads) must not be skipped by a truthy check.
    const cost = { input: 3, output: 15, cacheRead: 0, cacheWrite: 3.75 };
    const result = estimateTurnCost(cost, {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 0,
    });
    // 3 (input) + 15 (output) + 0 (cacheRead) + 0 (no cacheWrite) = 18
    expect(result).toBe(18);
  });
});

describe("findCatalogModel case sensitivity", () => {
  test("matches case-insensitively on the model id", () => {
    const catalog = buildModelCatalog([
      { provider: "claude", models: [model({ id: "claude-opus-4-8" })] },
    ]);
    // Provider drift sends mixed-case ids; the lookup must still resolve.
    expect(findCatalogModel(catalog, "claude", "Claude-Opus-4-8")?.id).toBe("claude-opus-4-8");
    expect(findCatalogModel(catalog, "claude", "CLAUDE-OPUS-4-8")?.id).toBe("claude-opus-4-8");
  });

  test("returns undefined for unknown id (caller must handle the miss)", () => {
    const catalog = buildModelCatalog([{ provider: "claude", models: [model({ id: "a" })] }]);
    expect(findCatalogModel(catalog, "claude", "missing")).toBeUndefined();
  });
});
