import { describe, expect, it } from "vitest";
import type { RenderRules } from "react-native-markdown-display";
import { mergeMarkdownRules } from "./merge-rules";

describe("mergeMarkdownRules", () => {
  it("returns base when no extension is provided", () => {
    const base: RenderRules = {
      text: () => null,
    };
    expect(mergeMarkdownRules(base, undefined)).toBe(base);
  });

  it("lets extension rules override matching keys only", () => {
    const baseText = () => null;
    const baseFence = () => null;
    const extensionFence = () => null;
    const base: RenderRules = {
      text: baseText,
      fence: baseFence,
    };
    const extension: RenderRules = {
      fence: extensionFence,
    };
    const merged = mergeMarkdownRules(base, extension);
    expect(merged.text).toBe(baseText);
    expect(merged.fence).toBe(extensionFence);
  });
});
