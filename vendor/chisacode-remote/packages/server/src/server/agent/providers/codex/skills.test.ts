import { describe, expect, test } from "vitest";

import { expandCodexCustomPrompt, parseCodexFrontMatter } from "./skills.js";

describe("Codex skills and custom prompts", () => {
  test("parses custom prompt front matter without including it in the body", () => {
    expect(
      parseCodexFrontMatter(
        "---\ndescription: 'Review carefully'\nargument-hint: [path]\n---\nReview $ARGUMENTS",
      ),
    ).toEqual({
      frontMatter: {
        description: "Review carefully",
        "argument-hint": "[path]",
      },
      body: "Review $ARGUMENTS",
    });
  });

  test("expands positional, named, aggregate, escaped-dollar, and quoted arguments", () => {
    expect(
      expandCodexCustomPrompt(
        "all=$ARGUMENTS first=$1 second=$2 named=$TARGET dollar=$$",
        'alpha "two words" TARGET=src/app.ts',
      ),
    ).toBe(
      'all=alpha "two words" TARGET=src/app.ts first=alpha second=two words named=src/app.ts dollar=$',
    );
  });
});
