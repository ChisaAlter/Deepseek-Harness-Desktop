import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveChisaCodeHome } from "./chisacode-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolveChisaCodeHome permissions", () => {
  test("creates CHISACODE_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "chisacode-home-parent-"));
    const chisacodeHome = path.join(parent, "home");
    try {
      expect(resolveChisaCodeHome({ CHISACODE_HOME: chisacodeHome })).toBe(chisacodeHome);
      expect(modeOf(chisacodeHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("resolveChisaCodeHome", () => {
  test("uses CHISACODE_HOME when set", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "chisacode-home-parent-"));
    const chisacodeHome = path.join(parent, "chisacode");
    try {
      expect(resolveChisaCodeHome({ CHISACODE_HOME: chisacodeHome })).toBe(
        path.resolve(chisacodeHome),
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("uses the ChisaCode default home when no override is set", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "chisacode-home-parent-"));
    const realHome = process.env.HOME;
    const realUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = parent;
      process.env.USERPROFILE = parent;

      expect(resolveChisaCodeHome({})).toBe(path.join(parent, ".chisacode"));
    } finally {
      if (realHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = realHome;
      }
      if (realUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = realUserProfile;
      }
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
