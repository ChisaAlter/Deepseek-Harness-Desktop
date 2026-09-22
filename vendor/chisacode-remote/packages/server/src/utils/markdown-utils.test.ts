import { describe, expect, test } from "vitest";

import {
  classifyCodeBlock,
  hasInlineMath,
  parseDiffLines,
  truncateCjkUrl,
} from "./markdown-utils.js";

describe("truncateCjkUrl", () => {
  test("splits CJK characters from URL", () => {
    const [url, trailing] = truncateCjkUrl("https://x.com/foo（中文");
    expect(url).toBe("https://x.com/foo");
    expect(trailing).toBe("（中文");
  });

  test("returns input unchanged for pure ASCII URL", () => {
    const [url, trailing] = truncateCjkUrl("https://example.com/path?q=1");
    expect(url).toBe("https://example.com/path?q=1");
    expect(trailing).toBe("");
  });

  test("handles fullwidth punctuation", () => {
    const [url, trailing] = truncateCjkUrl("https://x.com/foo。bar");
    expect(url).toBe("https://x.com/foo");
    expect(trailing).toBe("。bar");
  });
});

describe("classifyCodeBlock", () => {
  test("classifies diff languages", () => {
    expect(classifyCodeBlock("diff")).toBe("diff");
    expect(classifyCodeBlock("patch")).toBe("diff");
    expect(classifyCodeBlock("DIFF")).toBe("diff");
  });

  test("classifies diagram languages", () => {
    expect(classifyCodeBlock("mermaid")).toBe("diagram");
    expect(classifyCodeBlock("plantuml")).toBe("diagram");
  });

  test("classifies math languages", () => {
    expect(classifyCodeBlock("math")).toBe("math");
    expect(classifyCodeBlock("latex")).toBe("math");
  });

  test("defaults to code", () => {
    expect(classifyCodeBlock("typescript")).toBe("code");
    expect(classifyCodeBlock(undefined)).toBe("code");
    expect(classifyCodeBlock("")).toBe("code");
  });
});

describe("parseDiffLines", () => {
  test("parses unified diff with hunk headers", () => {
    const diff = `@@ -1,3 +1,4 @@
 context
-removed
+added1
+added2`;
    const lines = parseDiffLines(diff);
    expect(lines[0].kind).toBe("header");
    expect(lines[1].kind).toBe("context");
    expect(lines[1].oldLine).toBe(1);
    expect(lines[2].kind).toBe("delete");
    expect(lines[2].content).toBe("removed");
    expect(lines[3].kind).toBe("add");
    expect(lines[3].content).toBe("added1");
    expect(lines[4].kind).toBe("add");
    expect(lines[4].content).toBe("added2");
  });

  test("parses meta lines", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
index abc123..def456 100644`;
    const lines = parseDiffLines(diff);
    expect(lines.every((l) => l.kind === "meta")).toBe(true);
  });

  test("tracks line numbers correctly", () => {
    const diff = `@@ -10,3 +20,3 @@
 same
-old
+new`;
    const lines = parseDiffLines(diff);
    expect(lines[1].oldLine).toBe(10);
    expect(lines[1].newLine).toBe(20);
    expect(lines[2].oldLine).toBe(11);
    expect(lines[3].newLine).toBe(21);
  });
});

describe("hasInlineMath", () => {
  test("detects inline math", () => {
    expect(hasInlineMath("The formula $E=mc^2$ is famous")).toBe(true);
    expect(hasInlineMath("$x^2 + y^2 = z^2$")).toBe(true);
  });

  test("rejects currency amounts", () => {
    expect(hasInlineMath("costs $5 and $10")).toBe(false);
  });

  test("rejects text without math", () => {
    expect(hasInlineMath("no math here")).toBe(false);
  });
});
