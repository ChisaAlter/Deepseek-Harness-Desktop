import { describe, expect, test } from "vitest";

import { buildCodexModelDefinitions } from "./models.js";

describe("Codex model definitions", () => {
  test("prefers configured model and reasoning defaults over app-server defaults", () => {
    const models = buildCodexModelDefinitions(
      {
        data: [
          {
            id: "gpt-5.4",
            displayName: "gpt 5.4",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Faster" },
              { reasoningEffort: "medium", description: "Balanced" },
            ],
          },
          {
            id: "custom-model",
            displayName: "Custom Model",
            isDefault: false,
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ],
      },
      { model: "custom-model", thinkingOptionId: "high" },
    );

    expect(models.map((model) => ({ id: model.id, isDefault: model.isDefault }))).toEqual([
      { id: "gpt-5.4", isDefault: false },
      { id: "custom-model", isDefault: true },
    ]);
    expect(models[0]?.label).toBe("GPT 5.4");
    expect(models[1]?.defaultThinkingOptionId).toBe("high");
    expect(models[1]?.thinkingOptions).toContainEqual({
      id: "high",
      label: "high",
      description: undefined,
      isDefault: true,
    });
  });

  test("returns an empty catalog for malformed app-server responses", () => {
    expect(buildCodexModelDefinitions({ data: [{ displayName: "missing id" }] }, {})).toEqual([]);
  });
});
