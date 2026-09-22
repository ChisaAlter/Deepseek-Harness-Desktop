import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";

import { buildSelfNodeCommand } from "../server/chisacode-env.js";
import { execCommand, platformShell, spawnProcess } from "./spawn.js";

const printEnvScript = `
const keys = [
  "CUSTOM",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ELECTRON_RUN_AS_NODE",
  "CHISACODE_DESKTOP_MANAGED",
  "CHISACODE_NODE_ENV",
  "CHISACODE_SUPERVISED",
];
const values = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));
console.log(JSON.stringify(values));
`;

function parsePrintedEnv(stdout: string): Record<string, string | null> {
  return JSON.parse(stdout.trim()) as Record<string, string | null>;
}

describe("execCommand", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const tempDir of tempDirs) {
      await removeTempDir(tempDir);
    }
    tempDirs.length = 0;
  });

  test("returns stdout and stderr for a successful command", async () => {
    const result = await execCommand("echo", ["hello"]);

    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
  });

  test("decodes stdout and stderr with the requested encoding", async () => {
    const result = await execCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(Buffer.from([0xe9])); process.stderr.write(Buffer.from([0xf1]));",
      ],
      { encoding: "latin1" },
    );

    expect(result).toEqual({ stdout: "é", stderr: "ñ" });
  });

  test.each([
    { encoding: "hex" as const, expected: "6" },
    { encoding: "base64" as const, expected: "Y" },
    { encoding: "base64url" as const, expected: "Y" },
  ])("matches the native $encoding overflow prefix", async ({ encoding, expected }) => {
    const error = await execCommand(
      process.execPath,
      ["-e", "process.stdout.write(Buffer.from([0x61, 0x62]));"],
      { encoding, maxBuffer: 1 },
    ).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { code?: string; stderr?: string; stdout?: string },
    );

    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: "stdout maxBuffer length exceeded",
      stderr: "",
      stdout: expected,
    });
  });

  test.each([
    { encoding: "hex" as const, expected: "61" },
    { encoding: "base64" as const, expected: "YQ==" },
    { encoding: "base64url" as const, expected: "YQ" },
  ])("returns full $encoding output at the raw byte cap", async ({ encoding, expected }) => {
    await expect(
      execCommand(process.execPath, ["-e", "process.stdout.write(Buffer.from([0x61]));"], {
        encoding,
        maxBuffer: 1,
      }),
    ).resolves.toEqual({ stdout: expected, stderr: "" });
  });

  test("retains a complete UTF-8 character at the maxBuffer boundary", async () => {
    const error = await execCommand(
      process.execPath,
      ["-e", "process.stdout.write(Buffer.from([0xc3, 0xa9, 0xc3, 0xa9, 0x78, 0x78, 0x78]));"],
      { encoding: "utf8", maxBuffer: 3 },
    ).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) =>
        reason as Error & { cmd?: string; code?: string; stderr?: string; stdout?: string },
    );

    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: "stdout maxBuffer length exceeded",
      stderr: "",
      stdout: "éé",
    });
    expect(error.cmd).toContain(process.execPath);
    expect(error.cmd).toContain("process.stdout.write");
    expect(Buffer.byteLength(error.stdout ?? "", "utf8")).toBe(4);
    expect(error.stdout).not.toContain("\uFFFD");
  });

  test("retains a complete UTF-16LE surrogate pair at the maxBuffer boundary", async () => {
    const error = await execCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(Buffer.from([0x3d, 0xd8, 0x00, 0xde, 0x58, 0x00, 0x59, 0x00]));",
      ],
      { encoding: "utf16le", maxBuffer: 3 },
    ).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) =>
        reason as Error & { cmd?: string; code?: string; stderr?: string; stdout?: string },
    );

    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: "stdout maxBuffer length exceeded",
      stderr: "",
      stdout: "😀",
    });
    expect(error.cmd).toContain(process.execPath);
    expect(error.cmd).toContain("process.stdout.write");
    expect(Buffer.byteLength(error.stdout ?? "", "utf16le")).toBe(4);
    expect(Array.from(error.stdout ?? "")).toEqual(["😀"]);
    expect(error.stdout).not.toContain("\uFFFD");
  });

  test("completes a fragmented UTF-8 character after maxBuffer cleanup starts", async () => {
    const { child, getTerminationCount, runtime } = createManualExecRuntime();
    const execOptions = {
      encoding: "utf8" as const,
      maxBuffer: 2,
      runtime,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };
    const commandPromise = execCommand("fragmented-utf8", [], execOptions);
    const errorPromise = commandPromise.then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { code?: string; stdout?: string },
    );

    child.stdout?.write(Buffer.from([0x61, 0xe2]));
    child.stdout?.write(Buffer.from([0x82]));
    expect(getTerminationCount()).toBe(1);
    child.stdout?.write(Buffer.from([0xac]));
    child.stdout?.write(Buffer.from([0x78, 0x79]));
    child.emit("close", 0, null);

    const error = await errorPromise;
    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stdout: "a€",
    });
    expect(getTerminationCount()).toBe(1);
  });

  test("completes a fragmented UTF-16LE surrogate pair after maxBuffer cleanup starts", async () => {
    const { child, getTerminationCount, runtime } = createManualExecRuntime();
    const execOptions = {
      encoding: "utf16le" as const,
      maxBuffer: 2,
      runtime,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };
    const commandPromise = execCommand("fragmented-utf16le", [], execOptions);
    const errorPromise = commandPromise.then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { code?: string; stdout?: string },
    );

    child.stdout?.write(Buffer.from([0x3d, 0xd8]));
    child.stdout?.write(Buffer.from([0x00]));
    expect(getTerminationCount()).toBe(1);
    child.stdout?.write(Buffer.from([0xde]));
    child.stdout?.write(Buffer.from([0x58, 0x00]));
    child.emit("close", 0, null);

    const error = await errorPromise;
    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stdout: "😀",
    });
    expect(Array.from(error.stdout ?? "")).toEqual(["😀"]);
    expect(getTerminationCount()).toBe(1);
  });

  test("copies a bounded output prefix away from a large source chunk", async () => {
    const { child, runtime } = createManualExecRuntime();
    const execOptions = {
      encoding: "latin1" as const,
      maxBuffer: 1,
      runtime,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };
    const commandPromise = execCommand("large-output", [], execOptions);
    const errorPromise = commandPromise.then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { code?: string; stdout?: string },
    );
    const sourceChunk = Buffer.alloc(1_000_000, 0x62);
    sourceChunk[0] = 0x61;

    child.stdout?.write(sourceChunk);
    sourceChunk[0] = 0x7a;
    child.emit("close", 0, null);

    await expect(errorPromise).resolves.toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stdout: "a",
    });
  });

  test("closes readiness watcher when the command exits before the marker", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-readiness-test-")));
    tempDirs.push(cwd);
    const commandError = new Error("command exited before readiness");

    await expect(
      waitForPathCreation(path.join(cwd, "missing.pid"), Promise.reject(commandError)),
    ).rejects.toBe(commandError);
  });

  test("preserves ENOENT details when spawning fails before a PID exists", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-enoent-test-")));
    tempDirs.push(cwd);
    const missingCommand = path.join(cwd, "missing-command");
    const error = await execCommand(missingCommand, []).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) =>
        reason as Error & {
          cmd?: string;
          code?: string;
          stderr?: string;
          stdout?: string;
        },
    );

    expect(error).toMatchObject({
      cmd: missingCommand,
      code: "ENOENT",
      stderr: "",
      stdout: "",
    });
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid timeout %s before spawning",
    async (timeout) => {
      await expect(execCommand(process.execPath, ["-e", ""], { timeout })).rejects.toMatchObject({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
      });
    },
  );

  test.each([-1, Number.NaN])("rejects invalid maxBuffer %s before spawning", async (maxBuffer) => {
    await expect(execCommand(process.execPath, ["-e", ""], { maxBuffer })).rejects.toMatchObject({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
    });
  });

  test("rejects an unknown encoding before spawning", async () => {
    let spawnCount = 0;
    const runtime = {
      spawn(): ChildProcess {
        spawnCount += 1;
        throw new Error("spawn must not be called for an invalid encoding");
      },
      async terminate() {
        throw new Error("terminate must not be called for an invalid encoding");
      },
    };
    const execOptions = {
      encoding: "bogus" as BufferEncoding,
      runtime,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };

    await expect(execCommand("must-not-spawn", [], execOptions)).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_UNKNOWN_ENCODING",
      message: "Unknown encoding: bogus",
    });
    expect(spawnCount).toBe(0);
  });

  test("rejects an invalid killSignal before spawning", async () => {
    await expect(
      execCommand(process.execPath, ["-e", ""], {
        killSignal: "NOPE" as NodeJS.Signals,
      }),
    ).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_UNKNOWN_SIGNAL",
    });
  });

  test("allows zero timeout and zero maxBuffer when the command has no output", async () => {
    await expect(
      execCommand(process.execPath, ["-e", ""], { maxBuffer: 0, timeout: 0 }),
    ).resolves.toEqual({ stdout: "", stderr: "" });
  });

  test("allows a fractional maxBuffer", async () => {
    await expect(
      execCommand(process.execPath, ["-e", 'process.stdout.write("x");'], {
        maxBuffer: 1.5,
      }),
    ).resolves.toEqual({ stdout: "x", stderr: "" });
  });

  test("times out a command tree launched through the platform shell", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-timeout-test-")));
    tempDirs.push(cwd);
    const fixture = createShellTreeFixture(cwd, { ignoreGrandchildSigterm: true });
    const shell = platformShell();
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      timeout: 2_000,
    });
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      expect(isProcessRunning(ownerPid)).toBe(true);
      expect(isProcessRunning(grandchildPid)).toBe(true);

      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & { code?: string; stderr?: string; stdout?: string; timeoutMs?: number },
      );

      await vi.waitFor(
        () => {
          expect(isProcessRunning(ownerPid)).toBe(false);
          expect(isProcessRunning(grandchildPid)).toBe(false);
        },
        { timeout: 5_000 },
      );
      expect(error).toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
        timeoutMs: 2_000,
      });
    } finally {
      await commandPromise.catch(() => {});
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      await waitForProcessesStopped([ownerPid, grandchildPid]);
    }
  }, 15_000);

  test("reports configured SIGKILL timeout details after the command tree is gone", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-kill-signal-test-")));
    tempDirs.push(cwd);
    const fixture = createShellTreeFixture(cwd, { ignoreGrandchildSigterm: true });
    const shell = platformShell();
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      killSignal: "SIGKILL",
      timeout: 1_000,
    });
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);

      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & {
            cmd?: string;
            code?: string;
            killed?: boolean;
            signal?: NodeJS.Signals | null;
            timeoutMs?: number;
          },
      );

      expect(isProcessRunning(ownerPid)).toBe(false);
      expect(isProcessRunning(grandchildPid)).toBe(false);
      expect(error).toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
        killed: true,
        signal: "SIGKILL",
        timeoutMs: 1_000,
      });
      expect(error.cmd).toContain(fixture.command);
    } finally {
      await commandPromise.catch(() => {});
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      await waitForProcessesStopped([ownerPid, grandchildPid]);
    }
  }, 15_000);

  test("times out descendants after the direct platform shell has exited", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-exited-shell-timeout-")));
    tempDirs.push(cwd);
    const fixture = createExitedShellTreeFixture(cwd);
    const shell = platformShell();
    let settled = false;
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      timeout: 2_000,
    });
    void commandPromise.then(
      () => {
        settled = true;
        return undefined;
      },
      () => {
        settled = true;
        return undefined;
      },
    );
    let shellPid: number | null = null;
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      shellPid = readPid(fixture.shellPidPath);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      await vi.waitFor(() => expect(isProcessRunning(shellPid)).toBe(false), { timeout: 5_000 });
      expect(isProcessRunning(ownerPid)).toBe(true);
      expect(isProcessRunning(grandchildPid)).toBe(true);
      expect(settled).toBe(false);

      await vi.waitFor(
        () => {
          expect(isProcessRunning(ownerPid)).toBe(false);
          expect(isProcessRunning(grandchildPid)).toBe(false);
        },
        { timeout: 8_000 },
      );
      await expect(commandPromise).rejects.toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
        killed: true,
      });
    } finally {
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      killIfRunning(shellPid);
      await waitForProcessesStopped([shellPid, ownerPid, grandchildPid]);
      await commandPromise.catch(() => {});
    }
  }, 20_000);

  test("settles timeout when detached descendant cleanup races inherited pipe closure", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-orphaned-pipe-timeout-")));
    tempDirs.push(cwd);
    const fixture = createExitedShellTreeFixture(cwd, { ownerExits: true });
    const shell = platformShell();
    let settled = false;
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cleanupTimeoutMs: 1_500,
      cwd,
      timeout: 100,
    });
    void commandPromise.then(
      () => {
        settled = true;
        return undefined;
      },
      () => {
        settled = true;
        return undefined;
      },
    );
    let shellPid: number | null = null;
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      shellPid = readPid(fixture.shellPidPath);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      await vi.waitFor(
        () => {
          expect([isProcessRunning(shellPid), isProcessRunning(ownerPid)]).toEqual([false, false]);
        },
        { timeout: 5_000 },
      );
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 3_000 });
      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & {
            code?: string;
            killed?: boolean;
            terminationResult?: string;
            timeoutMs?: number;
          },
      );
      expect(error).toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
        timeoutMs: 100,
      });
      expect(
        (error.killed === false && error.terminationResult === "kill-timeout") ||
          (error.killed === true && error.terminationResult === undefined),
      ).toBe(true);
    } finally {
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      killIfRunning(shellPid);
      await waitForProcessesStopped([shellPid, ownerPid, grandchildPid]);
      await commandPromise.catch(() => {});
    }
  }, 15_000);

  test("preserves nonzero exit details", async () => {
    const error = await execCommand(process.execPath, [
      "-e",
      'console.error("failure"); process.exit(7);',
    ]).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) =>
        reason as Error & {
          cmd?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
          stderr?: string;
          stdout?: string;
        },
    );

    expect(error.code).toBe(7);
    expect(error.killed).toBe(false);
    expect(error.signal).toBeNull();
    expect(error.cmd).toContain("process.exit(7)");
    expect(error.stdout).toBe("");
    expect(error.stderr?.trim()).toBe("failure");
  });

  test("cleans a command tree when stdout exceeds maxBuffer", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-max-buffer-test-")));
    tempDirs.push(cwd);
    const fixture = createShellTreeFixture(cwd, {
      ignoreGrandchildSigterm: true,
      outputBytes: 4_096,
    });
    const shell = platformShell();
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      maxBuffer: 1_024,
    });
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      expect(isProcessRunning(ownerPid)).toBe(true);
      expect(isProcessRunning(grandchildPid)).toBe(true);

      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) => reason as Error & { code?: string; stderr?: string; stdout?: string },
      );

      await vi.waitFor(
        () => {
          expect(isProcessRunning(ownerPid)).toBe(false);
          expect(isProcessRunning(grandchildPid)).toBe(false);
        },
        { timeout: 5_000 },
      );
      expect(error).toMatchObject({
        name: "RangeError",
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        message: "stdout maxBuffer length exceeded",
      });
      expect(error.stdout?.length).toBeLessThanOrEqual(1_024);
      expect(error.stderr).toBe("");
    } finally {
      await commandPromise.catch(() => {});
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      await waitForProcessesStopped([ownerPid, grandchildPid]);
    }
  }, 15_000);

  test("cleans maxBuffer descendants after the direct platform shell has exited", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-exited-shell-buffer-")));
    tempDirs.push(cwd);
    const fixture = createExitedShellTreeFixture(cwd, { outputBytes: 4_096 });
    const shell = platformShell();
    let settled = false;
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      maxBuffer: 1_024,
      timeout: 10_000,
    });
    void commandPromise.then(
      () => {
        settled = true;
        return undefined;
      },
      () => {
        settled = true;
        return undefined;
      },
    );
    let shellPid: number | null = null;
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      shellPid = readPid(fixture.shellPidPath);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      await vi.waitFor(() => expect(isProcessRunning(shellPid)).toBe(false), { timeout: 5_000 });
      expect(isProcessRunning(ownerPid)).toBe(true);
      expect(isProcessRunning(grandchildPid)).toBe(true);
      expect(settled).toBe(false);

      await triggerExitedFixtureOutput(fixture.outputTriggerPath, commandPromise);

      await vi.waitFor(
        () => {
          expect(isProcessRunning(ownerPid)).toBe(false);
          expect(isProcessRunning(grandchildPid)).toBe(false);
        },
        { timeout: 8_000 },
      );
      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) => reason as Error & { cmd?: string; code?: string },
      );
      expect(error).toMatchObject({
        name: "RangeError",
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      });
      expect(error.cmd).toContain(fixture.command);
    } finally {
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      killIfRunning(shellPid);
      await waitForProcessesStopped([shellPid, ownerPid, grandchildPid]);
      await commandPromise.catch(() => {});
    }
  }, 20_000);

  test("settles maxBuffer when the shell and owner exit before inherited pipes close", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-orphaned-pipe-buffer-")));
    tempDirs.push(cwd);
    const fixture = createExitedShellTreeFixture(cwd, {
      outputBytes: 4_096,
      ownerExits: true,
    });
    const shell = platformShell();
    let settled = false;
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cleanupTimeoutMs: 1_500,
      cwd,
      maxBuffer: 1_024,
      timeout: 10_000,
    });
    void commandPromise.then(
      () => {
        settled = true;
        return undefined;
      },
      () => {
        settled = true;
        return undefined;
      },
    );
    let shellPid: number | null = null;
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      shellPid = readPid(fixture.shellPidPath);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      await vi.waitFor(
        () => {
          expect([isProcessRunning(shellPid), isProcessRunning(ownerPid)]).toEqual([false, false]);
        },
        { timeout: 5_000 },
      );
      expect(isProcessRunning(grandchildPid)).toBe(true);

      await triggerExitedFixtureOutput(fixture.outputTriggerPath, commandPromise);

      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 3_000 });
      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & {
            code?: string;
            terminationReason?: string;
          },
      );
      expect(error).toMatchObject({
        name: "ExecCommandKillTimeoutError",
        code: "EXEC_COMMAND_KILL_TIMEOUT",
        terminationReason: "maxBuffer",
      });
    } finally {
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      killIfRunning(shellPid);
      await waitForProcessesStopped([shellPid, ownerPid, grandchildPid]);
      await commandPromise.catch(() => {});
    }
  }, 15_000);

  test("allows output above the default cap when maxBuffer is Infinity", async () => {
    const outputBytes = 1_100_000;

    const result = await execCommand(
      process.execPath,
      ["-e", `process.stdout.write("x".repeat(${outputBytes}));`],
      { maxBuffer: Number.POSITIVE_INFINITY },
    );

    expect(result.stdout).toHaveLength(outputBytes);
    expect(result.stderr).toBe("");
  });

  test("enforces the stderr maxBuffer independently from stdout", async () => {
    const error = await execCommand(
      process.execPath,
      ["-e", 'process.stdout.write("ok"); process.stderr.write("e".repeat(2048));'],
      { maxBuffer: 1_024 },
    ).then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { code?: string; stderr?: string; stdout?: string },
    );

    expect(error).toMatchObject({
      name: "RangeError",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: "stderr maxBuffer length exceeded",
      stdout: "ok",
    });
    expect(error.stderr).toHaveLength(1_024);
  });

  test("aborts a command tree launched through the platform shell", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-signal-test-")));
    tempDirs.push(cwd);
    const fixture = createShellTreeFixture(cwd, { ignoreGrandchildSigterm: true });
    const shell = platformShell();
    const controller = new AbortController();
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cwd,
      signal: controller.signal,
      timeout: 10_000,
    });
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      expect(isProcessRunning(ownerPid)).toBe(true);
      expect(isProcessRunning(grandchildPid)).toBe(true);

      controller.abort(new Error("stop requested"));

      await expect(commandPromise).rejects.toMatchObject({
        name: "AbortError",
        code: "ABORT_ERR",
      });
      await vi.waitFor(
        () => {
          expect(isProcessRunning(ownerPid)).toBe(false);
          expect(isProcessRunning(grandchildPid)).toBe(false);
        },
        { timeout: 5_000 },
      );
    } finally {
      controller.abort(new Error("test cleanup"));
      await commandPromise.catch(() => {});
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      await waitForProcessesStopped([ownerPid, grandchildPid]);
    }
  }, 15_000);

  test("settles abort when the shell and owner exit before inherited pipes close", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-orphaned-pipe-abort-")));
    tempDirs.push(cwd);
    const fixture = createExitedShellTreeFixture(cwd, { ownerExits: true });
    const shell = platformShell();
    const controller = new AbortController();
    let settled = false;
    const commandPromise = execCommand(shell.command, [...shell.flag, fixture.command], {
      cleanupTimeoutMs: 1_500,
      cwd,
      signal: controller.signal,
      timeout: 10_000,
    });
    void commandPromise.then(
      () => {
        settled = true;
        return undefined;
      },
      () => {
        settled = true;
        return undefined;
      },
    );
    let shellPid: number | null = null;
    let ownerPid: number | null = null;
    let grandchildPid: number | null = null;

    try {
      await waitForPathCreation(fixture.grandchildPidPath, commandPromise);
      shellPid = readPid(fixture.shellPidPath);
      ownerPid = readPid(fixture.ownerPidPath);
      grandchildPid = readPid(fixture.grandchildPidPath);
      await vi.waitFor(
        () => {
          expect([isProcessRunning(shellPid), isProcessRunning(ownerPid)]).toEqual([false, false]);
        },
        { timeout: 5_000 },
      );
      expect(isProcessRunning(grandchildPid)).toBe(true);

      controller.abort(new Error("stop requested"));

      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 3_000 });
      const error = await commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & {
            code?: string;
            terminationReason?: string;
          },
      );
      expect(error).toMatchObject({
        name: "ExecCommandKillTimeoutError",
        code: "EXEC_COMMAND_KILL_TIMEOUT",
        terminationReason: "abort",
      });
    } finally {
      controller.abort(new Error("test cleanup"));
      killIfRunning(grandchildPid);
      killIfRunning(ownerPid);
      killIfRunning(shellPid);
      await waitForProcessesStopped([shellPid, ownerPid, grandchildPid]);
      await commandPromise.catch(() => {});
    }
  }, 15_000);

  test("settles once when abort, timeout, and maxBuffer compete", async () => {
    const controller = new AbortController();
    let settlementCount = 0;
    const commandPromise = execCommand(
      process.execPath,
      ["-e", 'process.stdout.write("x".repeat(2048)); setInterval(() => {}, 1000);'],
      {
        maxBuffer: 1,
        signal: controller.signal,
        timeout: 1,
      },
    );
    const observedPromise = commandPromise.then(
      (result) => {
        settlementCount += 1;
        return result;
      },
      (error: unknown) => {
        settlementCount += 1;
        throw error;
      },
    );

    controller.abort(new Error("abort wins"));

    await expect(observedPromise).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
    });
    expect(settlementCount).toBe(1);
  });

  test("rejects a kill-timeout without waiting for child close", async () => {
    let unrefCalled = false;
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: new PassThrough(),
      kill() {
        return true;
      },
      pid: 424_242,
      signalCode: null,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref() {
        unrefCalled = true;
      },
    }) as unknown as ChildProcess;
    let attemptedSignal: NodeJS.Signals | undefined;
    const runtime = {
      spawn() {
        return child;
      },
      async terminate(_child: ChildProcess, options: { gracefulSignal?: NodeJS.Signals }) {
        attemptedSignal = options.gracefulSignal;
        return "kill-timeout" as const;
      },
    };
    const controller = new AbortController();
    const execOptions = {
      killSignal: "SIGKILL" as const,
      runtime,
      signal: controller.signal,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };
    const commandPromise = execCommand(process.execPath, ["--version"], execOptions);

    controller.abort(new Error("stop requested"));

    const error = await commandPromise.then(
      () => new Error("Expected command to reject"),
      (reason: unknown) =>
        reason as Error & {
          cause?: Error & { code?: string };
          cmd?: string;
          code?: string;
          killed?: boolean;
          signal?: NodeJS.Signals;
          terminationReason?: string;
        },
    );
    expect(error).toMatchObject({
      code: "EXEC_COMMAND_KILL_TIMEOUT",
      killed: false,
      signal: "SIGKILL",
      terminationReason: "abort",
    });
    expect(error.cmd).toContain(process.execPath);
    expect(error.cause).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
    expect(attemptedSignal).toBe("SIGKILL");
    expect(child.listenerCount("close")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.stdout?.listenerCount("data")).toBe(0);
    expect(child.stderr?.listenerCount("data")).toBe(0);
    expect(child.stdin?.destroyed).toBe(true);
    expect(child.stdout?.destroyed).toBe(true);
    expect(child.stderr?.destroyed).toBe(true);
    expect(unrefCalled).toBe(true);
  });

  test("bounds a runtime that ignores cleanup cancellation and releases resources once", async () => {
    vi.useFakeTimers();
    let unrefCount = 0;
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: new PassThrough(),
      kill() {
        return true;
      },
      pid: 424_246,
      signalCode: null,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref() {
        unrefCount += 1;
      },
    }) as unknown as ChildProcess;
    let cleanupSignal: AbortSignal | undefined;
    const runtime = {
      spawn() {
        return child;
      },
      terminate(_child: ChildProcess, options: { signal?: AbortSignal }): Promise<"kill-timeout"> {
        cleanupSignal = options.signal;
        return new Promise(() => undefined);
      },
    };
    const controller = new AbortController();
    const execOptions = {
      cleanupTimeoutMs: 50,
      runtime,
      signal: controller.signal,
    } as NonNullable<Parameters<typeof execCommand>[2]> & {
      cleanupTimeoutMs: number;
      runtime: typeof runtime;
    };
    let settlementCount = 0;

    try {
      const commandPromise = execCommand(process.execPath, ["--version"], execOptions);
      const errorPromise = commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) => {
          settlementCount += 1;
          return reason as Error & {
            cleanupCause?: Error & { code?: string };
            code?: string;
          };
        },
      );

      controller.abort(new Error("stop requested"));
      await vi.advanceTimersByTimeAsync(49);
      expect(settlementCount).toBe(0);
      expect(child.stdout?.destroyed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(settlementCount).toBe(1);
      expect(cleanupSignal?.aborted).toBe(true);
      const error = await errorPromise;
      expect(error).toMatchObject({
        name: "ExecCommandKillTimeoutError",
        code: "EXEC_COMMAND_KILL_TIMEOUT",
      });
      expect(error.cleanupCause).toMatchObject({
        name: "ExecCommandCleanupTimeoutError",
        code: "EXEC_COMMAND_KILL_TIMEOUT",
      });
      expect(child.listenerCount("close")).toBe(0);
      expect(child.listenerCount("error")).toBe(0);
      expect(child.stdin?.destroyed).toBe(true);
      expect(child.stdout?.destroyed).toBe(true);
      expect(child.stderr?.destroyed).toBe(true);
      expect(unrefCount).toBe(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(settlementCount).toBe(1);
      expect(unrefCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("preserves timeout identity when cleanup times out without child close", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: new PassThrough(),
      kill() {
        return true;
      },
      pid: 424_243,
      signalCode: null,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref() {},
    }) as unknown as ChildProcess;
    const runtime = {
      spawn() {
        return child;
      },
      async terminate() {
        return "kill-timeout" as const;
      },
    };
    const execOptions = {
      runtime,
      timeout: 25,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };

    try {
      const commandPromise = execCommand(process.execPath, ["--version"], execOptions);
      const errorPromise = commandPromise.then(
        () => new Error("Expected command to reject"),
        (reason: unknown) =>
          reason as Error & {
            cause?: Error & { code?: string };
            cleanupCause?: Error & { code?: string };
            code?: string;
            killed?: boolean;
            terminationResult?: string;
            timeoutMs?: number;
          },
      );

      await vi.advanceTimersByTimeAsync(25);

      const error = await errorPromise;
      expect(error).toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
        killed: false,
        terminationResult: "kill-timeout",
        timeoutMs: 25,
      });
      expect(error.cause).toMatchObject({
        name: "ExecCommandTimeoutError",
        code: "EXEC_COMMAND_TIMEOUT",
      });
      expect(error.cleanupCause).toMatchObject({
        name: "ExecCommandCleanupTimeoutError",
        code: "EXEC_COMMAND_KILL_TIMEOUT",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not mark a naturally signaled child as killed by the wrapper", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: new PassThrough(),
      kill() {
        return true;
      },
      pid: 424_244,
      signalCode: null,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref() {},
    }) as unknown as ChildProcess;
    const runtime = {
      spawn() {
        return child;
      },
      async terminate() {
        throw new Error("terminate must not be called");
      },
    };
    const execOptions = { runtime } as NonNullable<Parameters<typeof execCommand>[2]> & {
      runtime: typeof runtime;
    };
    const commandPromise = execCommand(process.execPath, ["--version"], execOptions);

    queueMicrotask(() => child.emit("close", null, "SIGTERM"));

    await expect(commandPromise).rejects.toMatchObject({
      code: null,
      killed: false,
      signal: "SIGTERM",
    });
  });

  test("uses a custom killSignal while preserving the AbortError contract", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: new PassThrough(),
      kill() {
        return true;
      },
      pid: 424_245,
      signalCode: null,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref() {},
    }) as unknown as ChildProcess;
    let attemptedSignal: NodeJS.Signals | undefined;
    const runtime = {
      spawn() {
        return child;
      },
      async terminate(_child: ChildProcess, options: { gracefulSignal?: NodeJS.Signals }) {
        attemptedSignal = options.gracefulSignal;
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
        return "killed" as const;
      },
    };
    const controller = new AbortController();
    const execOptions = {
      killSignal: "SIGKILL" as const,
      runtime,
      signal: controller.signal,
    } as NonNullable<Parameters<typeof execCommand>[2]> & { runtime: typeof runtime };
    const commandPromise = execCommand(process.execPath, ["--version"], execOptions);

    controller.abort(new Error("stop requested"));

    const error = await commandPromise.then(
      () => new Error("Expected command to reject"),
      (reason: unknown) => reason as Error & { cmd?: string; code?: string },
    );
    expect(error).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
    expect(error.cmd).toContain(process.execPath);
    expect("killed" in error).toBe(false);
    expect("signal" in error).toBe(false);
    expect(attemptedSignal).toBe("SIGKILL");
  });

  test("runs the command in the provided cwd", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "spawn-test-")));
    tempDirs.push(cwd);

    const command =
      process.platform === "win32"
        ? {
            command: process.execPath,
            args: ["-e", "console.log(process.cwd())"],
          }
        : { command: "pwd", args: [] };

    const result = await execCommand(command.command, command.args, { cwd });

    expect(realpathSync(result.stdout.trim())).toBe(cwd);
    expect(result.stderr).toBe("");
  });

  test("treats env as the replacement base and finalizes external command env", async () => {
    const result = await execCommand(process.execPath, ["-e", printEnvScript], {
      baseEnv: {
        ELECTRON_RUN_AS_NODE: "0",
        CUSTOM: "from-base",
        PATH: process.env.PATH,
        CHISACODE_NODE_ENV: "production",
        CHISACODE_SUPERVISED: "1",
      },
      env: {
        CUSTOM: "from-env",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        CHISACODE_DESKTOP_MANAGED: "1",
        CHISACODE_NODE_ENV: "test",
      },
      envOverlay: {
        CUSTOM: "from-overlay",
        ELECTRON_RUN_AS_NODE: undefined,
      },
    });

    expect(parsePrintedEnv(result.stdout)).toEqual({
      CUSTOM: "from-overlay",
      ELECTRON_NO_ATTACH_CONSOLE: null,
      ELECTRON_RUN_AS_NODE: null,
      CHISACODE_DESKTOP_MANAGED: null,
      CHISACODE_NODE_ENV: null,
      CHISACODE_SUPERVISED: null,
    });
  });

  test("does not inherit process.env when env replacement is supplied", async () => {
    process.env.CHISACODE_TEST_SHOULD_NOT_LEAK = "leaked";
    try {
      const result = await execCommand(
        process.execPath,
        [
          "-e",
          "console.log(JSON.stringify({ leaked: process.env.CHISACODE_TEST_SHOULD_NOT_LEAK ?? null }))",
        ],
        {
          env: {
            PATH: process.env.PATH,
          },
        },
      );

      expect(JSON.parse(result.stdout.trim())).toEqual({ leaked: null });
    } finally {
      delete process.env.CHISACODE_TEST_SHOULD_NOT_LEAK;
    }
  });

  test("spawnProcess finalizes external command env", async () => {
    const child = spawnProcess(process.execPath, ["-e", printEnvScript], {
      baseEnv: {
        ELECTRON_RUN_AS_NODE: "0",
        PATH: process.env.PATH,
        CHISACODE_NODE_ENV: "production",
      },
      envOverlay: {
        CUSTOM: "spawn-overlay",
        CHISACODE_SUPERVISED: "1",
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    expect(Buffer.concat(stderrChunks).toString()).toBe("");
    expect(exitCode).toBe(0);
    expect(parsePrintedEnv(Buffer.concat(stdoutChunks).toString())).toEqual({
      CUSTOM: "spawn-overlay",
      ELECTRON_NO_ATTACH_CONSOLE: null,
      ELECTRON_RUN_AS_NODE: null,
      CHISACODE_DESKTOP_MANAGED: null,
      CHISACODE_NODE_ENV: null,
      CHISACODE_SUPERVISED: null,
    });
  });

  test("internal env mode preserves ChisaCode-owned launcher env", async () => {
    const result = await execCommand(process.execPath, ["-e", printEnvScript], {
      envMode: "internal",
      baseEnv: {
        ELECTRON_RUN_AS_NODE: "1",
        PATH: process.env.PATH,
        CHISACODE_NODE_ENV: "production",
      },
      envOverlay: {
        CUSTOM: "internal",
        CHISACODE_SUPERVISED: "1",
      },
    });

    expect(parsePrintedEnv(result.stdout)).toEqual({
      CUSTOM: "internal",
      ELECTRON_NO_ATTACH_CONSOLE: null,
      ELECTRON_RUN_AS_NODE: "1",
      CHISACODE_DESKTOP_MANAGED: null,
      CHISACODE_NODE_ENV: "production",
      CHISACODE_SUPERVISED: "1",
    });
  });

  test("does not realpath commands while finalizing external command env", async () => {
    const realpathSpy = vi.spyOn(fs.realpathSync, "native");

    await execCommand("/some/random/binary", ["--version"], {
      env: {
        PATH: process.env.PATH,
      },
      timeout: 100,
    }).catch(() => {});

    expect(realpathSpy).not.toHaveBeenCalled();
  });

  test("self node command explicitly enables Electron node mode", async () => {
    const command = buildSelfNodeCommand(["-e", printEnvScript], {
      CUSTOM: "from-helper",
    });

    const result = await execCommand(command.command, command.args, {
      env: command.env,
      envMode: "internal",
    });

    expect(parsePrintedEnv(result.stdout)).toEqual({
      CUSTOM: "from-helper",
      ELECTRON_NO_ATTACH_CONSOLE: null,
      ELECTRON_RUN_AS_NODE: "1",
      CHISACODE_DESKTOP_MANAGED: null,
      CHISACODE_NODE_ENV: null,
      CHISACODE_SUPERVISED: null,
    });
  });
});

function createManualExecRuntime() {
  let terminationCount = 0;
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    pid: 424_246,
    signalCode: null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    unref() {},
  }) as unknown as ChildProcess;
  const runtime = {
    spawn() {
      return child;
    },
    async terminate() {
      terminationCount += 1;
      return "terminated" as const;
    },
  };
  return {
    child,
    getTerminationCount: () => terminationCount,
    runtime,
  };
}

interface ShellTreeFixture {
  command: string;
  ownerPidPath: string;
  grandchildPidPath: string;
}

interface ShellTreeFixtureOptions {
  ignoreGrandchildSigterm?: boolean;
  outputBytes?: number;
}

interface ExitedShellTreeFixture {
  command: string;
  grandchildPidPath: string;
  outputTriggerPath: string;
  ownerPidPath: string;
  shellPidPath: string;
}

interface ExitedShellTreeFixtureOptions {
  outputBytes?: number;
  ownerExits?: boolean;
}

function createShellTreeFixture(
  cwd: string,
  options: ShellTreeFixtureOptions = {},
): ShellTreeFixture {
  const ownerScriptPath = path.join(cwd, "owner.cjs");
  const grandchildScriptPath = path.join(cwd, "grandchild.cjs");
  const ownerPidPath = path.join(cwd, "owner.pid");
  const grandchildPidPath = path.join(cwd, "grandchild.pid");
  writeFileSync(
    grandchildScriptPath,
    [
      'const fs = require("node:fs");',
      'const net = require("node:net");',
      ...(options.ignoreGrandchildSigterm ? ['process.on("SIGTERM", () => {});'] : []),
      "const server = net.createServer();",
      'server.listen(0, "127.0.0.1", () => {',
      `  fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));`,
      ...(options.outputBytes
        ? [`  setImmediate(() => process.stdout.write("x".repeat(${options.outputBytes})));`]
        : []),
      "});",
    ].join("\n"),
  );
  const grandchildStdio = options.outputBytes ? '["ignore", "inherit", "inherit"]' : '"ignore"';
  writeFileSync(
    ownerScriptPath,
    [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(ownerPidPath)}, String(process.pid));`,
      `const grandchild = spawn(process.execPath, [${JSON.stringify(grandchildScriptPath)}], { stdio: ${grandchildStdio} });`,
      'grandchild.once("error", (error) => { console.error(error); process.exit(1); });',
      "process.stdin.resume();",
    ].join("\n"),
  );
  return {
    command: `${path.basename(process.execPath)} ${path.basename(ownerScriptPath)}`,
    ownerPidPath,
    grandchildPidPath,
  };
}

function createExitedShellTreeFixture(
  cwd: string,
  options: ExitedShellTreeFixtureOptions = {},
): ExitedShellTreeFixture {
  const ownerScriptPath = path.join(cwd, "background-owner.cjs");
  const grandchildScriptPath = path.join(cwd, "background-grandchild.cjs");
  const launchScriptPath = path.join(cwd, "launch-background.cmd");
  const shellPidPath = path.join(cwd, "shell.pid");
  const ownerPidPath = path.join(cwd, "background-owner.pid");
  const grandchildPidPath = path.join(cwd, "background-grandchild.pid");
  const outputTriggerPath = path.join(cwd, "emit-output");
  writeFileSync(
    grandchildScriptPath,
    [
      'const fs = require("node:fs");',
      'const net = require("node:net");',
      'process.on("SIGTERM", () => {});',
      ...(options.outputBytes
        ? [
            `const outputTriggerPath = ${JSON.stringify(outputTriggerPath)};`,
            "let outputEmitted = false;",
            "const server = net.createServer((socket) => {",
            '  socket.once("data", () => {',
            "    if (!outputEmitted) {",
            "      outputEmitted = true;",
            `      process.stdout.write("x".repeat(${options.outputBytes}));`,
            "    }",
            "    socket.end();",
            "  });",
            "});",
          ]
        : ["const server = net.createServer();"]),
      'server.listen(0, "127.0.0.1", () => {',
      `  fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));`,
      ...(options.outputBytes
        ? [
            "  const address = server.address();",
            '  if (!address || typeof address === "string") throw new Error("missing control port");',
            "  fs.writeFileSync(outputTriggerPath, String(address.port));",
          ]
        : []),
      "});",
    ].join("\n"),
  );
  writeFileSync(
    ownerScriptPath,
    [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      'process.on("SIGTERM", () => {});',
      `fs.writeFileSync(${JSON.stringify(shellPidPath)}, String(process.ppid));`,
      `fs.writeFileSync(${JSON.stringify(ownerPidPath)}, String(process.pid));`,
      `const grandchild = spawn(process.execPath, [${JSON.stringify(grandchildScriptPath)}], {${options.ownerExits ? " detached: true," : ""} stdio: ["ignore", "inherit", "inherit"] });`,
      'grandchild.once("error", (error) => { console.error(error); process.exit(1); });',
      ...(options.ownerExits
        ? [
            `const grandchildPidPath = ${JSON.stringify(grandchildPidPath)};`,
            "const finishLaunch = () => {",
            "  if (!fs.existsSync(grandchildPidPath)) return false;",
            "  watcher.close();",
            "  grandchild.unref();",
            "  return true;",
            "};",
            "const watcher = fs.watch(process.cwd(), finishLaunch);",
            "finishLaunch();",
          ]
        : ["process.stdin.resume();"]),
    ].join("\n"),
  );

  if (process.platform === "win32") {
    writeFileSync(
      launchScriptPath,
      [
        "@echo off",
        `start "" /b ${path.basename(process.execPath)} ${path.basename(ownerScriptPath)}`,
        ":wait_for_grandchild",
        `if not exist ${path.basename(grandchildPidPath)} goto wait_for_grandchild`,
        "exit /b 0",
      ].join("\r\n"),
    );
    return {
      command: path.basename(launchScriptPath),
      grandchildPidPath,
      outputTriggerPath,
      ownerPidPath,
      shellPidPath,
    };
  }

  return {
    command: `${path.basename(process.execPath)} ${path.basename(ownerScriptPath)} & while [ ! -f ${path.basename(grandchildPidPath)} ]; do :; done; exit 0`,
    grandchildPidPath,
    outputTriggerPath,
    ownerPidPath,
    shellPidPath,
  };
}

function readPid(target: string): number {
  return Number.parseInt(readFileSync(target, "utf8").trim(), 10);
}

async function triggerExitedFixtureOutput(
  controlPortPath: string,
  commandPromise: Promise<unknown>,
): Promise<void> {
  await waitForPathCreation(controlPortPath, commandPromise);
  const port = readPid(controlPortPath);
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("error", reject);
    socket.once("connect", () => socket.end("emit", resolve));
  });
}

function isProcessRunning(pid: number | null): boolean {
  if (pid === null || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfRunning(pid: number | null): void {
  if (!isProcessRunning(pid)) {
    return;
  }
  try {
    process.kill(pid!, "SIGKILL");
  } catch {
    // Ignore cleanup races.
  }
}

async function waitForProcessesStopped(pids: Array<number | null>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(pids.map(isProcessRunning)).toEqual(pids.map(() => false));
    },
    { timeout: 5_000 },
  );
}

async function removeTempDir(tempDir: string): Promise<void> {
  await vi.waitFor(
    () => {
      rmSync(tempDir, { recursive: true, force: true });
      expect(fs.existsSync(tempDir)).toBe(false);
    },
    { timeout: 5_000 },
  );
}

function waitForPathCreation(target: string, commandPromise: Promise<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const watcher = fs.watch(path.dirname(target));
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      watcher.close();
      settle();
    };
    const finishIfReady = () => {
      if (!fs.existsSync(target)) {
        return;
      }
      finish(resolve);
    };
    watcher.on("change", finishIfReady);
    watcher.on("error", (error) => {
      finish(() => reject(error));
    });
    void commandPromise.then(
      () => {
        return finish(() =>
          reject(new Error(`Command exited before ${path.basename(target)} was ready`)),
        );
      },
      (error: unknown) => {
        return finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      },
    );
    finishIfReady();
  });
}
