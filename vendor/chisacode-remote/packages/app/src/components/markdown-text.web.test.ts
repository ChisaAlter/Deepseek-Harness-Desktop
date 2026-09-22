import { describe, expect, it } from "vitest";
import { MARKDOWN_TEXT_SPAN_WEB_STYLE } from "./markdown-text.web";

describe("MarkdownTextSpan web layout", () => {
  it("keeps Paseo-aligned inline flow (no full-width block spans)", () => {
    expect(MARKDOWN_TEXT_SPAN_WEB_STYLE).toEqual({
      display: "inline",
    });
  });
});
