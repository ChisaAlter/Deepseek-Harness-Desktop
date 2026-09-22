import os from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";

// Partially mock node:fs so we can simulate a rename failure on the
// promises.rename path while keeping the rest of the real implementation.
// atomic-write.ts imports `promises as fs` from "node:fs", so we must mock
// "node:fs" (not "node:fs/promises") for the override to take effect.
//
// The mock factory is hoisted by vitest before top-level imports resolve, so
// it must NOT close over outer variables (they may be in TDZ at hoist time).
// We `await import(...)` for `path` inside the factory instead.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const nodePath = await import("node:path");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        if (nodePath.basename(newPath) === "rename-fails.txt") {
          throw new Error("rename failed: simulated");
        }
        return actual.promises.rename(oldPath, newPath);
      }),
    },
  };
});

// node:fs imports below resolve against the mocked module. The synchronous
// helpers (mkdtempSync etc.) are spread from `actual` in the factory, so they
// remain the real implementations.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "./atomic-write.js";

const tmpRoots: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFileAtomic", () => {
  test("writes a string payload that reads back identically", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "file.txt");
    await writeFileAtomic(target, "hello 世界 🎉");
    expect(readFileSync(target, "utf8")).toBe("hello 世界 🎉");
  });

  test("writes a Buffer payload that reads back identically", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "bin.dat");
    const payload = Buffer.from([0, 1, 2, 255, 254, 253]);
    await writeFileAtomic(target, payload);
    expect(readFileSync(target)).toEqual(payload);
  });

  test("overwrites an existing file with new contents", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "file.txt");
    writeFileSync(target, "old contents");
    await writeFileAtomic(target, "new contents");
    expect(readFileSync(target, "utf8")).toBe("new contents");
  });

  test("creates missing parent directories before writing", async () => {
    const dir = makeTmpDir();
    const target = path.join(dir, "nested", "deeper", "file.txt");
    await writeFileAtomic(target, "nested");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("nested");
  });

  test.skipIf(process.platform === "win32")("honours an explicit 0o600 mode on POSIX", async () => {
    // POSIX modes do not apply on Windows; skipped there via test.skipIf so
    // the win32 run reports it as skipped rather than an empty pass.
    const dir = makeTmpDir();
    const target = path.join(dir, "secret.txt");
    await writeFileAtomic(target, "secret", { mode: 0o600 });
    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("cleans up the temp file when the rename fails", async () => {
    const dir = makeTmpDir();
    // The mocked rename throws specifically for this target filename.
    const target = path.join(dir, "rename-fails.txt");

    await expect(writeFileAtomic(target, "payload")).rejects.toThrow("rename failed: simulated");

    const entries = readdirSync(dir);
    const leftoverTmp = entries.filter((name) => name.endsWith(".tmp"));
    expect(leftoverTmp).toEqual([]);

    // The target file must not exist (the rename never succeeded).
    expect(existsSync(target)).toBe(false);
  });
});
