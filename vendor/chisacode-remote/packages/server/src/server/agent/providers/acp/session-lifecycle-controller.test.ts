import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentPersistenceHandle, AgentStreamEvent } from "../../agent-sdk-types.js";
import type { SpawnedACPProcess } from "./process-runtime.js";
import { ACPSessionLifecycleController } from "./session-lifecycle-controller.js";

function createChild(): ChildProcessWithoutNullStreams {
  return {
    exitCode: null,
    signalCode: null,
  } as unknown as ChildProcessWithoutNullStreams;
}

function createSpawnedProcess(
  child: ChildProcessWithoutNullStreams,
  connection: ClientSideConnection,
  agentCapabilities: unknown = null,
): SpawnedACPProcess {
  return {
    child,
    connection,
    initialize: { agentCapabilities },
  } as SpawnedACPProcess;
}

function persistenceHandle(): AgentPersistenceHandle {
  return {
    provider: "claude-acp",
    sessionId: "saved-session",
    nativeHandle: "saved-session",
  };
}

describe("ACPSessionLifecycleController", () => {
  test("initializes a new session and normalizes configured MCP servers", async () => {
    const child = createChild();
    const newSession = vi.fn(async () => ({
      sessionId: "session-1",
      modes: null,
      models: null,
      configOptions: [],
    }));
    const connection = { newSession } as unknown as ClientSideConnection;
    const onThreadBootstrap = vi.fn();
    const onSessionState = vi.fn();
    const applyConfiguredOverrides = vi.fn(async () => undefined);
    const controller = new ACPSessionLifecycleController({
      provider: "claude-acp",
      logger: createTestLogger(),
      cwd: "/workspace",
      mcpServers: {
        local: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "secret" },
        },
      },
      defaultCommand: ["claude", "--acp"],
      clientFactory: () => ({}) as never,
      onProcessExit: vi.fn(),
      onThreadBootstrap,
      onSessionState,
      applyConfiguredOverrides,
      spawnProcess: async () => createSpawnedProcess(child, connection),
      terminateProcess: vi.fn(async () => undefined),
    });

    await controller.initializeNewSession();

    expect(newSession).toHaveBeenCalledWith({
      cwd: "/workspace",
      mcpServers: [
        {
          name: "local",
          command: "node",
          args: ["server.js"],
          env: [{ name: "TOKEN", value: "secret" }],
        },
      ],
    });
    expect(controller.sessionId).toBe("session-1");
    expect(controller.activeSession).toEqual({ connection, sessionId: "session-1" });
    expect(onThreadBootstrap).toHaveBeenCalledOnce();
    expect(onSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
    );
    expect(applyConfiguredOverrides).toHaveBeenCalledOnce();
  });

  test("terminates and clears the process when new-session initialization fails", async () => {
    const child = createChild();
    const connection = {
      newSession: vi.fn(async () => {
        throw new Error("new session failed");
      }),
    } as unknown as ClientSideConnection;
    const terminateProcess = vi.fn(async () => undefined);
    const controller = new ACPSessionLifecycleController({
      provider: "claude-acp",
      logger: createTestLogger(),
      cwd: "/workspace",
      defaultCommand: ["claude", "--acp"],
      clientFactory: () => ({}) as never,
      onProcessExit: vi.fn(),
      onThreadBootstrap: vi.fn(),
      onSessionState: vi.fn(),
      applyConfiguredOverrides: vi.fn(async () => undefined),
      spawnProcess: async () => createSpawnedProcess(child, connection),
      terminateProcess,
    });

    await expect(controller.initializeNewSession()).rejects.toThrow("new session failed");

    expect(terminateProcess).toHaveBeenCalledWith(child, 2_000);
    expect(controller.activeSession).toBeNull();
    expect(controller.sessionId).toBeNull();
  });

  test("captures load-session replay history and drains it once", async () => {
    const child = createChild();
    const historyEvent = {
      type: "timeline",
      provider: "claude-acp",
      item: { id: "message-1", type: "assistant_message", text: "hello" },
    } as AgentStreamEvent;
    let controller!: ACPSessionLifecycleController;
    const loadSession = vi.fn(async () => {
      expect(controller.captureReplayEvents([historyEvent])).toBe(true);
      return {
        sessionId: "saved-session",
        modes: null,
        models: null,
        configOptions: [],
      };
    });
    const connection = { loadSession } as unknown as ClientSideConnection;
    controller = new ACPSessionLifecycleController({
      provider: "claude-acp",
      logger: createTestLogger(),
      cwd: "/workspace",
      defaultCommand: ["claude", "--acp"],
      initialHandle: persistenceHandle(),
      clientFactory: () => ({}) as never,
      onProcessExit: vi.fn(),
      onThreadBootstrap: vi.fn(),
      onSessionState: vi.fn(),
      applyConfiguredOverrides: vi.fn(async () => undefined),
      spawnProcess: async () =>
        createSpawnedProcess(child, connection, {
          loadSession: true,
          sessionCapabilities: {},
        }),
      terminateProcess: vi.fn(async () => undefined),
    });

    await controller.initializeResumedSession();

    expect(loadSession).toHaveBeenCalledWith({
      sessionId: "saved-session",
      cwd: "/workspace",
      mcpServers: [],
    });
    expect(controller.captureReplayEvents([historyEvent])).toBe(false);
    expect(controller.drainHistory()).toEqual([historyEvent.item]);
    expect(controller.drainHistory()).toEqual([]);
  });

  test("closes an active session once and clears process resources", async () => {
    const child = createChild();
    const cancel = vi.fn(async () => undefined);
    const unstableCloseSession = vi.fn(async () => undefined);
    const connection = {
      newSession: vi.fn(async () => ({
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      })),
      cancel,
      unstable_closeSession: unstableCloseSession,
    } as unknown as ClientSideConnection;
    const terminateProcess = vi.fn(async () => undefined);
    const beforeTerminate = vi.fn();
    const controller = new ACPSessionLifecycleController({
      provider: "claude-acp",
      logger: createTestLogger(),
      cwd: "/workspace",
      defaultCommand: ["claude", "--acp"],
      clientFactory: () => ({}) as never,
      onProcessExit: vi.fn(),
      onThreadBootstrap: vi.fn(),
      onSessionState: vi.fn(),
      applyConfiguredOverrides: vi.fn(async () => undefined),
      spawnProcess: async () =>
        createSpawnedProcess(child, connection, {
          sessionCapabilities: { close: true },
        }),
      terminateProcess,
    });
    await controller.initializeNewSession();

    await expect(controller.close({ activeTurn: true, beforeTerminate })).resolves.toBe(true);
    await expect(controller.close({ activeTurn: true, beforeTerminate })).resolves.toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(unstableCloseSession).toHaveBeenCalledOnce();
    expect(unstableCloseSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(beforeTerminate).toHaveBeenCalledOnce();
    expect(terminateProcess).toHaveBeenCalledOnce();
    expect(terminateProcess).toHaveBeenCalledWith(child, 2_000);
    expect(controller.activeSession).toBeNull();
    expect(controller.isClosed).toBe(true);
  });
});
