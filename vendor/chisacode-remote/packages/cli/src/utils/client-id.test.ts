import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resolveCliClientIdDirectory } from "./client-id";

const DEFAULT_DIRECTORY = join(homedir(), ".chisacode");

const HOME_KEYS = ["HOME", "USERPROFILE"] as const;
const TRACKED_ENV_KEYS = [...HOME_KEYS, "CHISACODE_HOME"] as const;

type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];
type TrackedEnvSnapshot = Record<TrackedEnvKey, string | undefined>;

function snapshotTrackedEnv(): TrackedEnvSnapshot {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CHISACODE_HOME: process.env.CHISACODE_HOME,
  };
}

function restoreTrackedEnv(snapshot: TrackedEnvSnapshot): void {
  for (const key of TRACKED_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function expectTrackedEnv(snapshot: TrackedEnvSnapshot): void {
  for (const key of TRACKED_ENV_KEYS) {
    expect(process.env[key]).toBe(snapshot[key]);
  }
}

let testEnvSnapshot = snapshotTrackedEnv();
let expectedEnvAfterTest: TrackedEnvSnapshot | undefined;
const originalEnvSnapshot = snapshotTrackedEnv();

beforeEach(() => {
  expectTrackedEnv(originalEnvSnapshot);
  testEnvSnapshot = snapshotTrackedEnv();
  expectedEnvAfterTest = undefined;
});

afterEach(() => {
  try {
    if (expectedEnvAfterTest) {
      expectTrackedEnv(expectedEnvAfterTest);
    }
  } finally {
    restoreTrackedEnv(testEnvSnapshot);
    expectedEnvAfterTest = undefined;
    vi.resetModules();
  }
});

/**
 * Redirects `os.homedir()` and `CHISACODE_HOME` at a throwaway directory so the
 * persistence cases never read or write the real user profile.
 */
async function withTempHome<T>(run: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "chisacode-client-id-"));
  const redirectSnapshot = snapshotTrackedEnv();
  try {
    for (const key of HOME_KEYS) {
      process.env[key] = home;
    }
    delete process.env.CHISACODE_HOME;
    vi.resetModules();
    return await run(home);
  } finally {
    restoreTrackedEnv(redirectSnapshot);
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  }
}

describe("resolveCliClientIdDirectory", () => {
  test("falls back to the default home when CHISACODE_HOME is unset", () => {
    expect(resolveCliClientIdDirectory({})).toBe(DEFAULT_DIRECTORY);
  });

  test("falls back to the default home when CHISACODE_HOME is empty or whitespace", () => {
    expect(resolveCliClientIdDirectory({ CHISACODE_HOME: "" })).toBe(DEFAULT_DIRECTORY);
    expect(resolveCliClientIdDirectory({ CHISACODE_HOME: "   " })).toBe(DEFAULT_DIRECTORY);
  });

  test("falls back to the default home when CHISACODE_HOME is relative", () => {
    expect(resolveCliClientIdDirectory({ CHISACODE_HOME: "relative-home" })).toBe(
      DEFAULT_DIRECTORY,
    );
  });

  test("preserves an absolute CHISACODE_HOME without normalization", () => {
    const absoluteHome = join(homedir(), ".chisacode", "absolute-test");
    expect(resolveCliClientIdDirectory({ CHISACODE_HOME: absoluteHome })).toBe(absoluteHome);
  });

  test("does not trim a syntactically valid absolute CHISACODE_HOME", () => {
    const absoluteHome = join(homedir(), ".chisacode", `absolute-test-${process.pid} `);
    expect(resolveCliClientIdDirectory({ CHISACODE_HOME: absoluteHome })).toBe(absoluteHome);
  });
});

describe("getOrCreateCliClientId persistence", () => {
  test("persists identity under an absolute CHISACODE_HOME without touching the checkout", async () => {
    await withTempHome(async (home) => {
      const identityHome = join(home, "configured-home");
      process.env.CHISACODE_HOME = identityHome;

      const first = await import("./client-id");
      const firstId = await first.getOrCreateCliClientId();
      expect(firstId).toMatch(/^cid_[0-9a-f]{32}$/);
      await expect(readFile(join(identityHome, "cli-client-id"), "utf8")).resolves.toBe(firstId);

      // A fresh module instance must reuse the persisted value, not mint a new identity.
      vi.resetModules();
      const second = await import("./client-id");
      await expect(second.getOrCreateCliClientId()).resolves.toBe(firstId);
    });
  });

  test("blank and relative CHISACODE_HOME both write under the home fallback", async () => {
    await withTempHome(async (home) => {
      const fallback = join(home, ".chisacode");
      const fallbackFile = join(fallback, "cli-client-id");

      process.env.CHISACODE_HOME = "   ";
      const blankModule = await import("./client-id");
      const blankId = await blankModule.getOrCreateCliClientId();
      await expect(readFile(fallbackFile, "utf8")).resolves.toBe(blankId);

      vi.resetModules();
      process.env.CHISACODE_HOME = "relative-home";
      const relativeModule = await import("./client-id");
      const relativeId = await relativeModule.getOrCreateCliClientId();
      expect(relativeId).toBe(blankId);
      await expect(readFile(fallbackFile, "utf8")).resolves.toBe(blankId);
    });
  });
});

describe("process environment isolation", () => {
  test("restores pre-existing sentinel values after each test", async () => {
    const sentinel: TrackedEnvSnapshot = {
      HOME: "sentinel-home",
      USERPROFILE: "sentinel-userprofile",
      CHISACODE_HOME: "sentinel-chisacode-home",
    };
    Object.assign(process.env, sentinel);
    expectedEnvAfterTest = sentinel;

    await withTempHome(async () => {
      expect(process.env.CHISACODE_HOME).toBeUndefined();
    });

    expectTrackedEnv(sentinel);
  });

  test("keeps originally absent variables absent after each test", async () => {
    for (const key of TRACKED_ENV_KEYS) {
      delete process.env[key];
    }
    const absent: TrackedEnvSnapshot = {
      HOME: undefined,
      USERPROFILE: undefined,
      CHISACODE_HOME: undefined,
    };
    expectedEnvAfterTest = absent;

    await withTempHome(async (home) => {
      expect(process.env.HOME).toBe(home);
      expect(process.env.USERPROFILE).toBe(home);
    });

    expectTrackedEnv(absent);
  });
});
