import { describe, expect, test } from "vitest";

import { classifyCodeBlock, hasInlineMath, parseDiffLines, truncateCjkUrl } from "./markdown-utils";

describe("truncateCjkUrl", () => {
  test("returns input unchanged with empty trailing when no CJK boundary", () => {
    expect(truncateCjkUrl("https://example.com/foo")).toEqual(["https://example.com/foo", ""]);
  });

  test("splits at the first CJK character", () => {
    const [url, trailing] = truncateCjkUrl("https://x.com/foo（中文）");
    expect(url).toBe("https://x.com/foo");
    expect(trailing).toBe("（中文）");
  });

  test("returns input unchanged when CJK char is at index 0", () => {
    expect(truncateCjkUrl("（foo")).toEqual(["（foo", ""]);
  });
});

describe("classifyCodeBlock", () => {
  test("classifies diff languages", () => {
    expect(classifyCodeBlock("diff")).toBe("diff");
    expect(classifyCodeBlock("patch")).toBe("diff");
    expect(classifyCodeBlock("udiff")).toBe("diff");
  });

  test("classifies diagram languages", () => {
    expect(classifyCodeBlock("mermaid")).toBe("diagram");
    expect(classifyCodeBlock("plantuml")).toBe("diagram");
    expect(classifyCodeBlock("graphviz")).toBe("diagram");
    expect(classifyCodeBlock("dot")).toBe("diagram");
  });

  test("classifies math languages", () => {
    expect(classifyCodeBlock("math")).toBe("math");
    expect(classifyCodeBlock("latex")).toBe("math");
    expect(classifyCodeBlock("tex")).toBe("math");
  });

  test("falls back to code for unknown or missing language", () => {
    expect(classifyCodeBlock(undefined)).toBe("code");
    expect(classifyCodeBlock("typescript")).toBe("code");
    expect(classifyCodeBlock("  ")).toBe("code");
  });

  test("is case-insensitive and trims", () => {
    expect(classifyCodeBlock("  Mermaid  ")).toBe("diagram");
    expect(classifyCodeBlock("DIFF")).toBe("diff");
  });
});

describe("hasInlineMath", () => {
  test("detects inline math delimiters", () => {
    expect(hasInlineMath("$E=mc^2$")).toBe(true);
    expect(hasInlineMath("the value $x$ is")).toBe(true);
  });

  test("rejects currency-like patterns", () => {
    // A closing $ followed by a digit is currency ($5 $10), not math.
    expect(hasInlineMath("$5 $10")).toBe(false);
  });

  test("rejects empty or whitespace-only content", () => {
    expect(hasInlineMath("$ $")).toBe(false);
    expect(hasInlineMath("")).toBe(false);
  });
});

describe("parseDiffLines", () => {
  test("parses a hunk header and add/delete/context lines", () => {
    const diff = "@@ -1,2 +1,2 @@\n context\n-deleted\n+added";
    const lines = parseDiffLines(diff);
    expect(lines).toHaveLength(4);
    expect(lines[0].kind).toBe("header");
    expect(lines[1].kind).toBe("context");
    expect(lines[2].kind).toBe("delete");
    expect(lines[3].kind).toBe("add");
    expect(lines[2].content).toBe("deleted");
    expect(lines[3].content).toBe("added");
  });

  test("tracks old/new line numbers", () => {
    const lines = parseDiffLines("@@ -5,2 +5,2 @@\n ctx\n-old\n+new");
    // hunk starts at old=5, new=5.
    // context: old=5/new=5, then both increment to 6.
    expect(lines[1].oldLine).toBe(5);
    expect(lines[1].newLine).toBe(5);
    // delete: old=6 (after context bumped), then old increments.
    expect(lines[2].oldLine).toBe(6);
    expect(lines[2].newLine).toBeNull();
    // add: new=6 (after context bumped; delete does not touch newLine).
    expect(lines[3].newLine).toBe(6);
    expect(lines[3].oldLine).toBeNull();
  });

  test("marks meta lines (---, +++, index)", () => {
    const lines = parseDiffLines("--- a/file\n+++ b/file\nindex abc..def");
    expect(lines.every((l) => l.kind === "meta")).toBe(true);
  });
});
