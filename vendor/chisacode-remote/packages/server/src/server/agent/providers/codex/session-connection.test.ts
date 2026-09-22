import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexSessionConnection } from "./session-connection.js";
import { createFakeCodexAppServer } from "./test-utils/fake-app-server.js";

function createConnection(
  spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>,
  onInitialized = vi.fn(async () => undefined),
): CodexSessionConnection {
  return new CodexSessionConnection({
    logger: createTestLogger(),
    spawnAppServer,
    getTraceContext: () => ({}),
    onNotification: vi.fn(),
    registerRequestHandlers: vi.fn(),
    onInitialized,
  });
}

describe("CodexSessionConnection", () => {
  test("deduplicates concurrent connection attempts", async () => {
    const initialize = vi.fn(() => ({}));
    const appServer = createFakeCodexAppServer({ initialize });
    const spawnAppServer = vi.fn(async () => appServer.child);
    const onInitialized = vi.fn(async () => undefined);
    const connection = createConnection(spawnAppServer, onInitialized);

    await Promise.all([connection.connect(), connection.connect(), connection.connect()]);

    expect(spawnAppServer).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(onInitialized).toHaveBeenCalledTimes(1);
    expect(connection.isConnected()).toBe(true);
    appServer.child.exitCode = 0;
    appServer.child.emit("exit", 0, null);
    await connection.close();
  });

  test("disposes a failed client and permits a later retry", async () => {
    const failedServer = createFakeCodexAppServer({
      initialize: async () => {
        throw new Error("initialize failed");
      },
    });
    const successfulServer = createFakeCodexAppServer();
    const spawnAppServer = vi
      .fn<() => Promise<ChildProcessWithoutNullStreams>>()
      .mockResolvedValueOnce(failedServer.child)
      .mockResolvedValueOnce(successfulServer.child);
    const connection = createConnection(spawnAppServer);

    await expect(connection.connect()).rejects.toThrow("initialize failed");
    expect(failedServer.killSignals).toEqual(["SIGTERM"]);
    expect(connection.getClient()).toBeNull();
    expect(connection.isConnected()).toBe(false);

    await connection.connect();
    expect(spawnAppServer).toHaveBeenCalledTimes(2);
    expect(connection.isConnected()).toBe(true);
    successfulServer.child.exitCode = 0;
    successfulServer.child.emit("exit", 0, null);
    await connection.close();
  });

  test("disposes a child that finishes spawning after close", async () => {
    const appServer = createFakeCodexAppServer();
    let resolveSpawn!: (child: ChildProcessWithoutNullStreams) => void;
    const spawnAppServer = () =>
      new Promise<ChildProcessWithoutNullStreams>((resolve) => {
        resolveSpawn = resolve;
      });
    const onInitialized = vi.fn(async () => undefined);
    const connection = createConnection(spawnAppServer, onInitialized);

    const connectPromise = connection.connect();
    await connection.close();
    resolveSpawn(appServer.child);

    await expect(connectPromise).rejects.toThrow(
      "Codex session connection was closed during initialization",
    );
    expect(appServer.killSignals).toEqual(["SIGTERM"]);
    expect(onInitialized).not.toHaveBeenCalled();
    expect(connection.getClient()).toBeNull();
  });
});
