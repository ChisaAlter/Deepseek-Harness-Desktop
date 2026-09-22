import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolvePathInsideBase } from "./workspace-path.js";

describe("ACP workspace path boundary", () => {
  test("accepts the workspace and descendants while rejecting escapes", () => {
    const base = path.resolve("acp-workspace-root");
    const child = path.join(base, "src", "file.ts");
    const dotDotNamedChild = path.join(base, "..cache", "file.ts");

    expect(resolvePathInsideBase(base, base)).toBe(base);
    expect(resolvePathInsideBase(child, base)).toBe(child);
    expect(resolvePathInsideBase(dotDotNamedChild, base)).toBe(dotDotNamedChild);
    expect(() => resolvePathInsideBase(path.join(base, "..", "outside.txt"), base)).toThrow(
      "escapes the project directory",
    );
    expect(() =>
      resolvePathInsideBase(path.resolve("different-workspace", "file.ts"), base),
    ).toThrow("escapes the project directory");
  });
});
