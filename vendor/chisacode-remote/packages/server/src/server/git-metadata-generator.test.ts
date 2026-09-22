import { describe, expect, test } from "vitest";
import { buildGitMetadataDiffContext } from "./git-metadata-generator.js";

describe("buildGitMetadataDiffContext", () => {
  test("preserves the existing prompt context for ordinary diffs", () => {
    const context = buildGitMetadataDiffContext(
      {
        diff: "diff --git a/file.txt b/file.txt\n+hello\n",
        structured: [
          {
            path: "file.txt",
            additions: 1,
            deletions: 0,
            isNew: false,
            isDeleted: false,
            hunks: [],
            status: "ok",
          },
        ],
      },
      120_000,
    );

    expect(context).toEqual({
      fileList: "Files changed:\nM\tfile.txt\t(+1 -0)",
      patch: "diff --git a/file.txt b/file.txt\n+hello\n",
    });
  });

  test("bounds file metadata, escapes control characters, and truncates patches", () => {
    const structured = Array.from({ length: 502 }, (_, index) => ({
      path: index === 0 ? `unsafe\n${"x".repeat(600)}` : `file-${index}.txt`,
      additions: 1,
      deletions: 0,
      isNew: false,
      isDeleted: false,
      hunks: [],
      status: "ok" as const,
    }));
    const context = buildGitMetadataDiffContext({ diff: "d".repeat(20), structured }, 10);

    expect(context.fileList).toContain("unsafe\\x0a");
    expect(context.fileList).not.toContain("unsafe\n");
    expect(context.fileList).toContain("... (2 more files omitted)");
    expect(context.fileList).not.toContain("file-500.txt");
    expect(context.patch).toBe("dddddddddd\n\n... (diff truncated to 10 chars)\n");
  });
});
