import { describe, expect, test } from "vitest";
import { applyAgentPresetToDraft, resolveAgentPresetApplication } from "./apply-preset";

describe("applyAgentPresetToDraft", () => {
  test("fills a draft without starting an agent", () => {
    expect(
      applyAgentPresetToDraft(
        { provider: "codex" },
        {
          id: "review",
          label: "Review",
          description: "",
          provider: "default",
          modeId: "read-only",
          systemPrompt: "Review carefully",
          samplePrompts: ["Review this diff"],
        },
      ),
    ).toEqual({
      provider: "codex",
      modeId: "read-only",
      model: null,
      systemPrompt: "Review carefully",
      samplePrompt: "Review this diff",
    });
  });

  test("preserves a prompt the user already wrote", () => {
    expect(
      applyAgentPresetToDraft(
        { provider: "codex", samplePrompt: "Keep my draft" },
        {
          id: "review",
          label: "Review",
          description: "",
          provider: "default",
          samplePrompts: ["Review this diff"],
        },
      ).samplePrompt,
    ).toBe("Keep my draft");
  });

  test("keeps unavailable selections editable and reports unsupported references", () => {
    expect(
      resolveAgentPresetApplication({
        draft: { provider: "codex", modeId: "auto", model: "gpt-5" },
        preset: {
          id: "private-review",
          label: "Private review",
          description: "",
          provider: "missing-provider",
          modeId: "read-only",
          model: "missing-model",
          skillIds: ["review"],
          mcpServerIds: ["github"],
        },
        availability: {
          providerIds: new Set(["codex"]),
        },
      }),
    ).toEqual({
      draft: {
        provider: "codex",
        modeId: "auto",
        model: "gpt-5",
        systemPrompt: undefined,
        samplePrompt: undefined,
      },
      unappliedFields: ["provider", "skillIds", "mcpServerIds"],
    });
  });
});
