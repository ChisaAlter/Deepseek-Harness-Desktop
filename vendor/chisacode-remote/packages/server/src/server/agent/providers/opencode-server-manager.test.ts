import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  OpenCodeServerManager,
  type OpenCodeLikeProviderConfig,
  type OpenCodeServerGeneration,
} from "./opencode/server-manager.js";

type FakeServerProcess = EventEmitter & {
  exitCode: number | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  signalCode: NodeJS.Signals | null;
};

type FakeGeneration = OpenCodeServerGeneration & { process: FakeServerProcess };

describe("OpenCodeServerManager generations", () => {
  test("keeps server manager instances isolated by provider id", () => {
    const logger = createTestLogger();
    const opencodeManager = OpenCodeServerManager.getInstance(logger, undefined, {
      providerId: "opencode",
      label: "OpenCode",
      binary: "opencode",
      serveArgs: (port) => ["serve", "--port", port],
      rotateServerOnForceRefresh: true,
      ignoreSystemEnvForDedicatedServer: false,
      installUrl: "https://github.com/opencode-ai/opencode",
    });
    const alternateManager = OpenCodeServerManager.getInstance(logger, undefined, {
      providerId: "opencode-alt",
      label: "OpenCode Alt",
      binary: "opencode-alt",
      serveArgs: (port) => ["serve", "--port", port],
      rotateServerOnForceRefresh: false,
      ignoreSystemEnvForDedicatedServer: true,
      installUrl: "https://opencode.ai",
    });

    expect(alternateManager).not.toBe(opencodeManager);
  });

  test("rotation creates a new current server without killing a referenced old server", async () => {
    const manager = createTestManager();
    const first = createGeneration(4101);
    const second = createGeneration(4102);
    stubGenerations(manager, [first, second]);

    const oldAcquisition = await manager.acquire({ force: false });
    const newAcquisition = await manager.acquire({ force: true });

    expect(oldAcquisition.server.url).toBe("http://127.0.0.1:4101");
    expect(newAcquisition.server.url).toBe("http://127.0.0.1:4102");
    expect(first.process.kill).not.toHaveBeenCalled();
    expect(second.process.kill).not.toHaveBeenCalled();

    newAcquisition.release();
    oldAcquisition.release();

    await vi.waitFor(() => expect(first.process.kill).toHaveBeenCalledWith("SIGTERM"));
  });

  test("new acquisitions after rotation use the new server", async () => {
    const manager = createTestManager();
    const first = createGeneration(4201);
    const second = createGeneration(4202);
    stubGenerations(manager, [first, second]);

    const oldAcquisition = await manager.acquire({ force: false });
    const rotatedAcquisition = await manager.acquire({ force: true });
    rotatedAcquisition.release();

    const nextAcquisition = await manager.acquire({ force: false });

    expect(nextAcquisition.server.url).toBe("http://127.0.0.1:4202");
    expect(first.process.kill).not.toHaveBeenCalled();

    nextAcquisition.release();
    oldAcquisition.release();
  });

  test("concurrent forced acquisitions share one fresh generation", async () => {
    const manager = createTestManager();
    const first = createGeneration(4251);
    const second = createGeneration(4252);
    const third = createGeneration(4253);
    const startServer = stubGenerations(manager, [first, second, third]);

    const initialAcquisition = await manager.acquire({ force: false });
    initialAcquisition.release();

    const [modelsAcquisition, modesAcquisition] = await Promise.all([
      manager.acquire({ force: true }),
      manager.acquire({ force: true }),
    ]);

    expect(modelsAcquisition.server.url).toBe("http://127.0.0.1:4252");
    expect(modesAcquisition.server.url).toBe("http://127.0.0.1:4252");
    expect(startServer).toHaveBeenCalledTimes(2);

    modesAcquisition.release();
    modelsAcquisition.release();
  });

  test("forced acquisitions reuse current server when rotation is disabled", async () => {
    const manager = createTestManager({
      providerId: "opencode-alt",
      label: "OpenCode Alt",
      binary: "opencode-alt",
      serveArgs: (port) => ["serve", "--port", port],
      rotateServerOnForceRefresh: false,
      ignoreSystemEnvForDedicatedServer: true,
      installUrl: "https://opencode.ai",
    });
    const first = createGeneration(4261);
    const second = createGeneration(4262);
    const startServer = stubGenerations(manager, [first, second]);

    const initialAcquisition = await manager.acquire({ force: false });
    initialAcquisition.release();

    const forcedAcquisition = await manager.acquire({ force: true });

    expect(forcedAcquisition.server.url).toBe("http://127.0.0.1:4261");
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(first.process.kill).not.toHaveBeenCalled();

    forcedAcquisition.release();
  });

  test("empty launch env reuses current server", async () => {
    const manager = createTestManager();
    const first = createGeneration(4271);
    const second = createGeneration(4272);
    const startServer = stubGenerations(manager, [first, second]);

    const initialAcquisition = await manager.acquire({ force: false });
    initialAcquisition.release();

    const emptyEnvAcquisition = await manager.acquire({ force: false, env: {} });

    expect(emptyEnvAcquisition.server.url).toBe("http://127.0.0.1:4271");
    expect(startServer).toHaveBeenCalledTimes(1);

    emptyEnvAcquisition.release();
  });

  test("non-empty launch env starts a dedicated server", async () => {
    const manager = createTestManager();
    const first = createGeneration(4281);
    const second = createGeneration(4282);
    const startServer = stubGenerations(manager, [first, second]);

    const initialAcquisition = await manager.acquire({ force: false });
    initialAcquisition.release();

    const envAcquisition = await manager.acquire({
      force: false,
      env: { OPENCODE_TEST_ENV: "1" },
    });

    expect(envAcquisition.server.url).toBe("http://127.0.0.1:4282");
    expect(startServer).toHaveBeenCalledTimes(2);

    envAcquisition.release();
  });

  test("system-only launch env reuses current server when configured", async () => {
    const manager = createTestManager({
      providerId: "opencode-alt",
      label: "OpenCode Alt",
      binary: "opencode-alt",
      serveArgs: (port) => ["serve", "--port", port],
      rotateServerOnForceRefresh: false,
      ignoreSystemEnvForDedicatedServer: true,
      installUrl: "https://opencode.ai",
    });
    const first = createGeneration(4291);
    const second = createGeneration(4292);
    const startServer = stubGenerations(manager, [first, second]);

    const initialAcquisition = await manager.acquire({ force: false });
    initialAcquisition.release();

    const systemEnvAcquisition = await manager.acquire({
      force: false,
      env: { CHISACODE_AGENT_ID: "agent_test" },
    });

    expect(systemEnvAcquisition.server.url).toBe("http://127.0.0.1:4291");
    expect(startServer).toHaveBeenCalledTimes(1);

    systemEnvAcquisition.release();
  });

  test("release is idempotent", async () => {
    const manager = createTestManager();
    const first = createGeneration(4301);
    const second = createGeneration(4302);
    stubGenerations(manager, [first, second]);

    const oldAcquisition = await manager.acquire({ force: false });
    const newAcquisition = await manager.acquire({ force: true });
    newAcquisition.release();

    oldAcquisition.release();
    oldAcquisition.release();

    expect(first.refCount).toBe(0);
    await vi.waitFor(() => expect(first.process.kill).toHaveBeenCalledTimes(1));
  });

  test("shutdown kills current and retired servers", async () => {
    const manager = createTestManager();
    const first = createGeneration(4401);
    const second = createGeneration(4402);
    stubGenerations(manager, [first, second]);

    await manager.acquire({ force: false });
    await manager.acquire({ force: true });

    await manager.shutdown();

    expect(first.process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(second.process.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("shutdown still signals a process after an earlier kill signal if it has not exited", async () => {
    const manager = createTestManager();
    const first = createGeneration(4451);
    stubGenerations(manager, [first]);

    await manager.acquire({ force: false });
    first.process.killed = true;

    await manager.shutdown();

    expect(first.process.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("repeated rotations leave zero unreferenced retired servers", async () => {
    const manager = createTestManager();
    const first = createGeneration(4501);
    const second = createGeneration(4502);
    const third = createGeneration(4503);
    stubGenerations(manager, [first, second, third]);

    const firstAcquisition = await manager.acquire({ force: false });
    const secondAcquisition = await manager.acquire({ force: true });
    secondAcquisition.release();
    const thirdAcquisition = await manager.acquire({ force: true });
    thirdAcquisition.release();
    firstAcquisition.release();

    const retiredServers = (manager as unknown as { retiredServers: Set<FakeGeneration> })
      .retiredServers;
    expect(Array.from(retiredServers).filter((server) => server.refCount === 0)).toHaveLength(0);
    await vi.waitFor(() => {
      expect(first.process.kill).toHaveBeenCalledTimes(1);
      expect(second.process.kill).toHaveBeenCalledTimes(1);
    });
  });
});

function createTestManager(providerConfig?: OpenCodeLikeProviderConfig): OpenCodeServerManager {
  const ManagerConstructor = OpenCodeServerManager as unknown as {
    new (
      logger: ReturnType<typeof createTestLogger>,
      runtimeSettings?: undefined,
      providerConfig?: OpenCodeLikeProviderConfig,
    ): OpenCodeServerManager;
  };
  return new ManagerConstructor(createTestLogger(), undefined, providerConfig);
}

function stubGenerations(
  manager: OpenCodeServerManager,
  generations: FakeGeneration[],
): ReturnType<typeof vi.fn> {
  const startServer = vi.fn(async () => {
    const generation = generations.shift();
    if (!generation) {
      throw new Error("No fake OpenCode server generation available");
    }
    return generation;
  });
  (manager as unknown as { startServer: typeof startServer }).startServer = startServer;
  return startServer;
}

function createGeneration(port: number): FakeGeneration {
  const process = new EventEmitter() as FakeServerProcess;
  process.exitCode = null;
  process.killed = false;
  process.signalCode = null;
  process.kill = vi.fn((signal?: NodeJS.Signals) => {
    process.killed = true;
    process.signalCode = signal ?? "SIGTERM";
    process.emit("exit", null, process.signalCode);
    return true;
  });
  return {
    process,
    port,
    url: `http://127.0.0.1:${port}`,
    refCount: 0,
    retired: false,
  };
}
