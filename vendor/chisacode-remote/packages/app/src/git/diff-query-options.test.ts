import { describe, expect, it } from "vitest";
import { normalizeCheckoutDiffCompare } from "./diff-query-options";

describe("normalizeCheckoutDiffCompare", () => {
  it("trims base refs for stable base diff subscriptions", () => {
    expect(
      normalizeCheckoutDiffCompare({
        mode: "base",
        baseRef: " origin/main ",
        ignoreWhitespace: true,
      }),
    ).toEqual({
      mode: "base",
      baseRef: "origin/main",
      ignoreWhitespace: true,
    });
  });

  it("drops blank base refs so equivalent requests share a cache key", () => {
    expect(
      normalizeCheckoutDiffCompare({
        mode: "base",
        baseRef: "   ",
      }),
    ).toEqual({
      mode: "base",
      ignoreWhitespace: false,
    });
  });

  it("ignores base refs for uncommitted diffs", () => {
    expect(
      normalizeCheckoutDiffCompare({
        mode: "uncommitted",
        baseRef: "origin/main",
        ignoreWhitespace: true,
      }),
    ).toEqual({
      mode: "uncommitted",
      ignoreWhitespace: true,
    });
  });
});
