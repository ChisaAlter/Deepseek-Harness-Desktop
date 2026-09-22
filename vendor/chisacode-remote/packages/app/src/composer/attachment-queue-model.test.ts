import { describe, expect, it } from "vitest";

import { formatGithubItemLabel, resolveGithubItemKindLabel } from "./attachment-queue-model";

describe("composer attachment queue model", () => {
  it("formats GitHub item kind and visible labels", () => {
    expect(resolveGithubItemKindLabel("pr")).toBe("PR");
    expect(resolveGithubItemKindLabel("issue")).toBe("issue");
    expect(formatGithubItemLabel({ number: 42, title: "Fix attachment rendering" })).toBe(
      "#42 Fix attachment rendering",
    );
  });
});
