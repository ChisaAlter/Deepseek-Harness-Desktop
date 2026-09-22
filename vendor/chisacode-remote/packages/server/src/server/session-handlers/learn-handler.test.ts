import { describe, expect, test } from "vitest";

import { deriveSkillName } from "./learn-handler.js";

describe("deriveSkillName", () => {
  test("strips .md extension and returns the basename", () => {
    expect(deriveSkillName("my-skill.md")).toBe("my-skill");
    expect(deriveSkillName("nested/path/deep-skill.md")).toBe("deep-skill");
    expect(deriveSkillName("backslash\\win.md")).toBe("win");
  });

  test("falls back to learned-skill for empty names", () => {
    expect(deriveSkillName("")).toBe("learned-skill");
    expect(deriveSkillName(".md")).toBe("learned-skill");
  });

  test("rejects path-traversal filenames that would escape the staging dir", () => {
    // "..md" → basename "..md" → strip ".md" → "..", which would make
    // path.join(stagingDir, "..") escape the staging dir.
    expect(() => deriveSkillName("..md")).toThrow(/Invalid skill directory name/);
    // A bare ".." (no extension) is rejected directly.
    expect(() => deriveSkillName("..")).toThrow(/Invalid skill directory name/);
    expect(() => deriveSkillName(".")).toThrow(/Invalid skill directory name/);
    // Deep path whose basename still reduces to "..".
    expect(() => deriveSkillName("foo/..md")).toThrow(/Invalid skill directory name/);
  });

  test("does not reject filenames whose basename is a normal skill name", () => {
    // The directory part is stripped; only the basename matters for traversal.
    expect(deriveSkillName("../escape.md")).toBe("escape");
    expect(deriveSkillName("skills/my-skill.md")).toBe("my-skill");
  });
});
