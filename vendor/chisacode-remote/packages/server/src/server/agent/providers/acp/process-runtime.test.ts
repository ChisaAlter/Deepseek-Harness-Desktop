import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Client as ACPClient } from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { spawnInitializedACPProcess } from "./process-runtime.js";

function createSilentACPChild(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
      child.signalCode = signal;
      child.emit("exit", null, signal);
      return true;
    }),
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

function createProbeClient(): ACPClient {
  return {
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate() {},
    async readTextFile() {
      return { content: "" };
    },
    async writeTextFile() {
      return {};
    },
    async createTerminal() {
      throw new Error("not supported");
    },
  };
}

describe("ACP process runtime", () => {
  test("terminates the child when ACP initialize times out", async () => {
    const child = createSilentACPChild();

    await expect(
      spawnInitializedACPProcess({
        launch: { command: "fake-acp", args: [] },
        cwd: process.cwd(),
        logger: createTestLogger(),
        provider: "test-acp",
        clientFactory: createProbeClient,
        initializeTimeoutMs: 1,
        spawn: () => child,
      }),
    ).rejects.toThrow("ACP initialize timed out after 1ms");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.stdin.destroyed).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });
});
