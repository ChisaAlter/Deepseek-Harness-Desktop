import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  writePrivateFileAtomicSync,
  writePrivateFileSync,
} from "./private-files.js";

const modeMask = 0o777;
function modeOf(path: string): number {
  return statSync(path).mode & modeMask;
}

describe("private file helpers", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("creates private directories and files with the expected POSIX modes", () => {
    const root = mkdtempSync(join(tmpdir(), "chisacode-private-"));
    roots.push(root);
    const nested = join(root, "nested", "config");
    ensurePrivateDirectory(nested);
    const file = join(nested, "secret.json");
    writePrivateFileSync(file, "secret");
    expect(readFileSync(file, "utf8")).toBe("secret");
    if (process.platform !== "win32") {
      expect(modeOf(nested)).toBe(PRIVATE_DIRECTORY_MODE);
      expect(modeOf(file)).toBe(PRIVATE_FILE_MODE);
    }
  });

  it("replaces atomically and does not leave temporary files", () => {
    const root = mkdtempSync(join(tmpdir(), "chisacode-atomic-"));
    roots.push(root);
    const file = join(root, "config.json");
    writePrivateFileAtomicSync(file, "first");
    writePrivateFileAtomicSync(file, "second");
    expect(readFileSync(file, "utf8")).toBe("second");
    expect(readdirSync(root)).toEqual(["config.json"]);
  });

  it("cleans the temporary file when the destination rename cannot complete", () => {
    const root = mkdtempSync(join(tmpdir(), "chisacode-failure-"));
    roots.push(root);
    const invalidTarget = join(root, "missing", "config.json");
    writePrivateFileAtomicSync(invalidTarget, "data");
    expect(readFileSync(invalidTarget, "utf8")).toBe("data");
    expect(readdirSync(join(root, "missing"))).toEqual(["config.json"]);
  });
});
