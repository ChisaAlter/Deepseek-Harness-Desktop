import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

interface SmokeRuntime {
  smokeHome: string;
  userData: string;
  desktopEnv: NodeJS.ProcessEnv;
  cliEnv: NodeJS.ProcessEnv;
  cleanupStopEnv: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

interface SmokeRuntimePorts {
  createTempDir(prefix: string): string;
}

interface SmokePackagedDesktopAppPorts {
  assertExecutable(filePath: string, label: string): void;
  createSmokeRuntime(): SmokeRuntime;
  spawnApp(command: string, args: readonly string[], options: SpawnOptions): ChildProcess;
  stopCliDaemon(options: { appPath: string; env: NodeJS.ProcessEnv }): Promise<void>;
}

interface SmokePackagedDesktopAppModule {
  createSmokeRuntime(ports?: Partial<SmokeRuntimePorts>): SmokeRuntime;
  smokePackagedDesktopApp(
    options: { appPath: string },
    ports?: Partial<SmokePackagedDesktopAppPorts>,
  ): Promise<void>;
}

const require = createRequire(import.meta.url);
const { createSmokeRuntime, smokePackagedDesktopApp } =
  require("./smoke-packaged-desktop-app.js") as SmokePackagedDesktopAppModule;

describe("packaged desktop smoke runtime", () => {
  test("uses one isolated CHISACODE_HOME for desktop, CLI, and cleanup commands", async () => {
    const runtime = createSmokeRuntime();

    try {
      expect(runtime.smokeHome).not.toBe(runtime.userData);
      expect({
        desktopHome: runtime.desktopEnv.CHISACODE_HOME,
        cliHome: runtime.cliEnv.CHISACODE_HOME,
        cleanupHome: runtime.cleanupStopEnv.CHISACODE_HOME,
        userData: runtime.desktopEnv.CHISACODE_ELECTRON_USER_DATA_DIR,
      }).toEqual({
        desktopHome: runtime.smokeHome,
        cliHome: runtime.smokeHome,
        cleanupHome: runtime.smokeHome,
        userData: runtime.userData,
      });
    } finally {
      await runtime.cleanup();
    }
  });

  test("cleanup removes both isolated runtime directories", async () => {
    const runtime = createSmokeRuntime();

    try {
      await expect(access(runtime.smokeHome)).resolves.toBeUndefined();
      await expect(access(runtime.userData)).resolves.toBeUndefined();
    } finally {
      await runtime.cleanup();
    }

    await expect(access(runtime.smokeHome)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(runtime.userData)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reclaims the first directory when the second directory creation fails", async () => {
    const firstDirectory = mkdtempSync(path.join(tmpdir(), "chisacode-smoke-first-dir-"));
    const creationError = new Error("second smoke directory creation failed");
    let createCalls = 0;
    let caughtError: unknown;
    let unexpectedRuntime: SmokeRuntime | undefined;

    try {
      try {
        unexpectedRuntime = createSmokeRuntime({
          createTempDir() {
            createCalls += 1;
            if (createCalls === 1) {
              return firstDirectory;
            }
            throw creationError;
          },
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBe(creationError);
      expect(createCalls).toBe(2);
      await expect(access(firstDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await unexpectedRuntime?.cleanup();
      rmSync(firstDirectory, { recursive: true, force: true });
    }
  });

  test("cleans isolated state when packaged app spawn throws synchronously", async () => {
    const runtime = createSmokeRuntime();
    const spawnError = new Error("packaged app spawn failed synchronously");
    const stopError = new Error("isolated daemon stop failed");
    let stopEnvironment: NodeJS.ProcessEnv | undefined;
    let stopCalls = 0;
    let spawnCalls = 0;

    try {
      await expect(
        smokePackagedDesktopApp(
          { appPath: "unused-packaged-app" },
          {
            assertExecutable() {},
            createSmokeRuntime() {
              return runtime;
            },
            spawnApp() {
              spawnCalls += 1;
              throw spawnError;
            },
            async stopCliDaemon({ env }) {
              stopCalls += 1;
              stopEnvironment = env;
              throw stopError;
            },
          },
        ),
      ).rejects.toBe(spawnError);

      expect(spawnCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(stopEnvironment).toBe(runtime.cleanupStopEnv);
      await expect(access(runtime.smokeHome)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(runtime.userData)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await runtime.cleanup();
    }
  });
});
