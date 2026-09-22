import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import { PiCliRuntime } from "./cli-runtime.js";
import { resolveDefaultPiSpawnOptions } from "./cli-runtime.js";
import type { PiRuntimeLaunch } from "./runtime.js";

type PiChild = ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killedSignals: Array<NodeJS.Signals | number | undefined>;
};

function createPiChild(): PiChild {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    killedSignals: [],
  }) as PiChild;
  child.kill = ((signal?: NodeJS.Signals | number) => {
    child.killedSignals.push(signal);
    child.signalCode = typeof signal === "string" ? signal : null;
    queueMicrotask(() => child.emit("exit", null, signal ?? null));
    return true;
  }) as ChildProcessWithoutNullStreams["kill"];
  return child;
}

function createRuntime(child: PiChild, launches: PiRuntimeLaunch[] = []): PiCliRuntime {
  return new PiCliRuntime({
    logger: pino({ level: "silent" }),
    command: ["pi"],
    spawnProcess: (launch) => {
      launches.push(launch);
      return child;
    },
  });
}

function invokeAsyncWriteError(callback: unknown): void {
  if (typeof callback === "function") {
    queueMicrotask(() => (callback as (error: Error) => void)(new Error("stdin write failed")));
  }
}

function replyToCommands(
  child: PiChild,
  handler: (command: Record<string, unknown>) => unknown,
): void {
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const command = JSON.parse(line) as Record<string, unknown>;
      const result = handler(command);
      child.stdout.write(
        `${JSON.stringify({
          id: command.id,
          type: "response",
          command: command.type,
          success: true,
          data: result,
        })}\n`,
      );
    }
  });
}

describe("PiCliRuntime", () => {
  test("starts pi in rpc mode and resolves command responses", async () => {
    const child = createPiChild();
    replyToCommands(child, (command) =>
      command.type === "get_state"
        ? {
            sessionId: "pi-session-1",
            thinkingLevel: "medium",
            isStreaming: false,
            isCompacting: false,
            messageCount: 0,
            pendingMessageCount: 0,
          }
        : {},
    );
    const launches: PiRuntimeLaunch[] = [];
    const runtime = createRuntime(child, launches);

    const session = await runtime.startSession({ cwd: "/workspace/project" });

    await expect(session.getState()).resolves.toMatchObject({
      sessionId: "pi-session-1",
      thinkingLevel: "medium",
    });
    expect(launches).toEqual([
      expect.objectContaining({
        cwd: "/workspace/project",
        argv: ["pi", "--mode", "rpc"],
      }),
    ]);
  });

  test("passes an MCP config path to Pi", async () => {
    const child = createPiChild();
    replyToCommands(child, () => ({}));
    const launches: PiRuntimeLaunch[] = [];
    const runtime = createRuntime(child, launches);

    await runtime.startSession({
      cwd: "/workspace/project",
      mcpConfigPath: "/tmp/chisacode-pi-mcp/mcp.json",
    });

    expect(launches).toEqual([
      expect.objectContaining({
        cwd: "/workspace/project",
        mcpConfigPath: "/tmp/chisacode-pi-mcp/mcp.json",
        argv: ["pi", "--mode", "rpc", "--mcp-config", "/tmp/chisacode-pi-mcp/mcp.json"],
      }),
    ]);
  });

  test("passes an appended system prompt to Pi", async () => {
    const child = createPiChild();
    replyToCommands(child, () => ({}));
    const launches: PiRuntimeLaunch[] = [];
    const runtime = createRuntime(child, launches);

    await runtime.startSession({
      cwd: "/workspace/project",
      systemPrompt: "  Use the daemon prompt.  ",
    });

    // Direct runtime.startSession keeps inline text; session-lifecycle writes a
    // temp file. Order still places any --extension flags first when present.
    expect(launches).toEqual([
      expect.objectContaining({
        cwd: "/workspace/project",
        systemPrompt: "Use the daemon prompt.",
        argv: ["pi", "--mode", "rpc", "--append-system-prompt", "Use the daemon prompt."],
      }),
    ]);
  });

  test("includes streamingBehavior on prompt so mid-stream messages queue", async () => {
    const child = createPiChild();
    const received: Array<Record<string, unknown>> = [];
    replyToCommands(child, (command) => {
      received.push(command);
      return {};
    });
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });

    await session.prompt("hello");
    await session.prompt("steer me", { streamingBehavior: "steer" });

    expect(received.filter((command) => command.type === "prompt")).toEqual([
      expect.objectContaining({
        type: "prompt",
        message: "hello",
        streamingBehavior: "followUp",
      }),
      expect.objectContaining({
        type: "prompt",
        message: "steer me",
        streamingBehavior: "steer",
      }),
    ]);
  });

  test("delivers events separately from command responses", async () => {
    const child = createPiChild();
    replyToCommands(child, () => ({ models: [] }));
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });
    const events: unknown[] = [];
    session.onEvent((event) => events.push(event));

    child.stdout.write(`${JSON.stringify({ type: "turn_start" })}\n`);
    await session.getAvailableModels();

    expect(events).toEqual([{ type: "turn_start" }]);
  });

  test("keeps unicode line separators inside one JSONL record", async () => {
    const child = createPiChild();
    replyToCommands(child, () => ({}));
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });
    const events: unknown[] = [];
    session.onEvent((event) => events.push(event));

    child.stdout.write(`${JSON.stringify({ type: "message", text: "a\u2028b\u2029c" })}\n`);

    expect(events).toEqual([{ type: "message", text: "a\u2028b\u2029c" }]);
  });

  test("rejects pending commands when the Pi process exits", async () => {
    const child = createPiChild();
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });

    const state = session.getState();
    child.stderr.write("boom");
    child.emit("exit", 1, null);

    await expect(state).rejects.toThrow("boom");
  });

  test("disposes the Pi process", async () => {
    const child = createPiChild();
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });

    await session.close();

    expect(child.killedSignals).toContain("SIGTERM");
  });

  test("memoizes concurrent close and rejects pending requests before termination", async () => {
    const child = createPiChild();
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });
    const pending = session.getState();

    const firstClose = session.close();
    const secondClose = session.close();

    await expect(pending).rejects.toThrow("Pi RPC session is closed");
    await Promise.all([firstClose, secondClose]);
    expect(child.killedSignals).toContain("SIGTERM");
    expect(child.killedSignals).toHaveLength(1);
    await expect(session.getState()).rejects.toThrow("Pi RPC session is closed");
  });

  test("does not emit process_exit during intentional close", async () => {
    const child = createPiChild();
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });
    const events: unknown[] = [];
    session.onEvent((event) => events.push(event));

    await session.close();
    await Promise.resolve();

    expect(events).toEqual([]);
  });

  test("handles asynchronous stdin write callback failures", async () => {
    const child = createPiChild();
    const originalWrite = child.stdin.write.bind(child.stdin);
    vi.spyOn(child.stdin, "write").mockImplementation(((chunk: unknown, callback?: unknown) => {
      invokeAsyncWriteError(callback);
      return originalWrite(chunk as never);
    }) as typeof child.stdin.write);
    const session = await createRuntime(child).startSession({ cwd: "/workspace/project" });

    await expect(session.getState()).rejects.toThrow("stdin write failed");
  });
});

describe("resolveDefaultPiSpawnOptions", () => {
  const originalExecPath = process.execPath;
  const originalEnv = { ...process.env };

  function makeLaunch(argv: string[], env?: Record<string, string>): PiRuntimeLaunch {
    return {
      cwd: "/workspace/project",
      argv,
      env,
    };
  }

  test("re-adds ELECTRON_RUN_AS_NODE and uses envMode internal when command is process.execPath", () => {
    const fakeElectronPath = "C:\\fake\\ChisaCode.exe";
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    try {
      Object.defineProperty(process, "execPath", { value: fakeElectronPath, configurable: true });
      const launch = makeLaunch([fakeElectronPath, "C:\\pi\\cli.js", "--mode", "rpc"]);
      const result = resolveDefaultPiSpawnOptions(launch);
      expect(result.command).toBe(fakeElectronPath);
      expect(result.args).toEqual(["C:\\pi\\cli.js", "--mode", "rpc"]);
      expect(result.options.envMode).toBe("internal");
      // buildSelfNodeCommand re-adds ELECTRON_RUN_AS_NODE after the external-env strip
      expect(result.options.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      restoreEnv(originalEnv);
    }
  });

  test("preserves user env overlay in self-node path", () => {
    const fakeElectronPath = "C:\\fake\\ChisaCode.exe";
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    try {
      Object.defineProperty(process, "execPath", { value: fakeElectronPath, configurable: true });
      const launch = makeLaunch([fakeElectronPath, "cli.js"], {
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: "http://gw/v1",
      });
      const result = resolveDefaultPiSpawnOptions(launch);
      expect(result.options.env?.ELECTRON_RUN_AS_NODE).toBe("1");
      expect(result.options.env?.OPENAI_API_KEY).toBe("sk-test");
      expect(result.options.env?.OPENAI_BASE_URL).toBe("http://gw/v1");
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      restoreEnv(originalEnv);
    }
  });

  test("uses envOverlay (not envMode internal) for custom node command", () => {
    const launch = makeLaunch(["node", "cli.js", "--mode", "rpc"], {
      OPENAI_API_KEY: "sk-custom",
    });
    const result = resolveDefaultPiSpawnOptions(launch);
    expect(result.command).toBe("node");
    expect(result.args).toEqual(["cli.js", "--mode", "rpc"]);
    expect(result.options.envMode).toBeUndefined();
    expect(result.options.envOverlay).toEqual({ OPENAI_API_KEY: "sk-custom" });
  });
});

function restoreEnv(original: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, original);
}
