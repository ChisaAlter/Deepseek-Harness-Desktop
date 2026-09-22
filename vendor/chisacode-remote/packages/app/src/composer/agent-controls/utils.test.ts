import { describe, expect, it } from "vitest";
import {
  buildToggleFeatureMenuItems,
  formatAgentModeLabel,
  formatCompactModelLabel,
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHint,
  formatThinkingOptionLabel,
  normalizeModelId,
  resolveAgentModelSelection,
} from "./utils";

describe("buildToggleFeatureMenuItems", () => {
  it("maps plan mode into a menu descriptor and excludes other features", () => {
    expect(
      buildToggleFeatureMenuItems([
        {
          id: "plan_mode",
          type: "toggle",
          label: "Plan",
          value: false,
        },
        {
          id: "fast_mode",
          type: "toggle",
          label: "Fast",
          value: true,
        },
        {
          id: "profile",
          type: "select",
          label: "配置",
          value: "default",
          options: [{ id: "default", label: "默认" }],
        },
      ]),
    ).toEqual([{ id: "plan_mode", label: "计划模式", selected: false }]);
  });
});

describe("getAgentControlHint", () => {
  it("explains what each editable agent control does", () => {
    expect(getAgentControlHint("thinking")).toBe("推理强度");
    expect(getAgentControlHint("model")).toBe("切换模型");
    expect(getAgentControlHint("mode")).toBe("切换权限模式");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });
});

describe("formatCompactModelLabel", () => {
  it("strips only the final provider namespace", () => {
    expect(formatCompactModelLabel("openrouter/openai/gpt-5.5")).toBe("gpt-5.5");
    expect(formatCompactModelLabel("gpt-5.5")).toBe("gpt-5.5");
  });
});
describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("formatAgentModeLabel", () => {
  it("localizes known provider mode labels", () => {
    expect(formatAgentModeLabel({ id: "auto", label: "Default Permissions" })).toBe("默认权限");
    expect(formatAgentModeLabel({ id: "plan", label: "Plan" })).toBe("计划模式");
    expect(formatAgentModeLabel({ id: "full-access", label: "Full Access" })).toBe("完全访问");
    expect(formatAgentModeLabel({ id: "auto-review", label: "Auto-review" })).toBe("自动审核");
    expect(formatAgentModeLabel({ id: "acceptEdits", label: "acceptEdits" })).toBe("接受文件编辑");
  });

  it("falls back to sentence-cased labels for unknown modes", () => {
    expect(formatAgentModeLabel({ id: "read_only", label: "read_only" })).toBe("Read only");
    expect(formatAgentModeLabel({ id: "custom-review" })).toBe("Custom review");
  });
});

describe("formatThinkingOptionLabel", () => {
  it("localizes known thinking option labels", () => {
    expect(formatThinkingOptionLabel({ id: "none", label: "none" })).toBe("无");
    expect(formatThinkingOptionLabel({ id: "low", label: "low" })).toBe("低");
    expect(formatThinkingOptionLabel({ id: "medium", label: "medium" })).toBe("中");
    expect(formatThinkingOptionLabel({ id: "high", label: "high" })).toBe("高");
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "xhigh" })).toBe("超高");
  });

  it("falls back to sentence-cased labels for unknown thinking options", () => {
    expect(formatThinkingOptionLabel({ id: "extra_high", label: "extra_high" })).toBe("超高");
    expect(formatThinkingOptionLabel({ id: "think-hard", label: "think-hard" })).toBe("深度思考");
    expect(formatThinkingOptionLabel({ id: "custom-hard", label: "custom-hard" })).toBe(
      "Custom hard",
    );
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "XHigh" })).toBe("超高");
  });
});

describe("resolveAgentModelSelection", () => {
  it("prefers runtime model over configured model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("a");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("高");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("超高");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("低");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("低");
  });
});
