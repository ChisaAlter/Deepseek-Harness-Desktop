import { describe, expect, it } from "vitest";
import { generateComponentPromptSection, GENERATIVE_UI_COMPONENTS } from "./component-manifest.js";

describe("generateComponentPromptSection", () => {
  it("returns a non-empty string", () => {
    const prompt = generateComponentPromptSection();
    expect(prompt).toBeTypeOf("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("does not reference render_ui tool call", () => {
    const prompt = generateComponentPromptSection();
    expect(prompt).not.toContain("render_ui");
  });

  it("contains chisacode-ui fence format instruction", () => {
    const prompt = generateComponentPromptSection();
    expect(prompt).toContain("chisacode-ui");
    expect(prompt).toContain("component=<componentId>");
    expect(prompt).toContain("Markdown code fence");
  });

  it("contains JSON prop example in the fence body", () => {
    const prompt = generateComponentPromptSection();
    expect(prompt).toContain('"prop1"');
    expect(prompt).toContain('"value1"');
    expect(prompt).toContain('"prop2"');
    expect(prompt).toContain('"value2"');
  });

  it("includes all registered components", () => {
    const prompt = generateComponentPromptSection();
    for (const c of GENERATIVE_UI_COMPONENTS) {
      expect(prompt).toContain(c.componentId);
    }
  });

  it("includes category labels", () => {
    const prompt = generateComponentPromptSection();
    expect(prompt).toContain("### Charts");
    expect(prompt).toContain("### Tables");
    expect(prompt).toContain("### Forms");
  });

  it("includes component actions in the description", () => {
    const prompt = generateComponentPromptSection();
    // form has "change" and "submit" actions
    expect(prompt).toContain('"submit"');
    expect(prompt).toContain("submitted");
    // table has "row_click" and "sort"
    expect(prompt).toContain('"sort"');
  });

  it("does not mention tool call anywhere", () => {
    const prompt = generateComponentPromptSection();
    // Neither "tool call" nor "tool_call" should appear
    expect(prompt).not.toContain("tool_call");
    expect(prompt).not.toContain("tool call");
  });
});
