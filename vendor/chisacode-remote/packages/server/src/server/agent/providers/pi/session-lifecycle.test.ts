import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentCapabilityFlags,
  AgentSessionConfig,
  McpServerConfig,
} from "../../agent-sdk-types.js";
import type { PiRuntime, PiRuntimeSession, PiStartSessionInput } from "./runtime.js";
import { PiSessionLifecycle } from "./session-lifecycle.js";
import type { PiRpcSlashCommand, PiSessionState } from "./rpc-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

function createState(): PiSessionState {
  return {
    sessionId: "pi-session",
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    messageCount: 0,
    pendingMessageCount: 0,
  };
}

function createRuntime(
  options: {
    commands?: PiRpcSlashCommand[];
    startError?: Error;
    stateError?: Error;
  } = {},
): { runtime: PiRuntime; sessions: FakeRuntimeSession[] } {
  const sessions: FakeRuntimeSession[] = [];
  const runtime: PiRuntime = {
    async startSession(input: PiStartSessionInput) {
      if (options.startError) throw options.startError;
      const session = new FakeRuntimeSession(options.commands ?? [], options.stateError);
      session.input = input;
      sessions.push(session);
      return session;
    },
  };
  return { runtime, sessions };
}

class FakeRuntimeSession implements PiRuntimeSession {
  input!: PiStartSessionInput;
  close = vi.fn(async () => undefined);
  private readonly commands: PiRpcSlashCommand[];
  private readonly stateError?: Error;

  constructor(commands: PiRpcSlashCommand[], stateError?: Error) {
    this.commands = commands;
    this.stateError = stateError;
  }

  onEvent(): () => void {
    return () => undefined;
  }
  async prompt(): Promise<void> {}
  async abort(): Promise<void> {}
  async getState(): Promise<PiSessionState> {
    if (this.stateError) throw this.stateError;
    return createState();
  }
  async getMessages() {
    return [];
  }
  async getAvailableModels() {
    return [];
  }
  async setModel() {
    throw new Error("not implemented");
  }
  async setThinkingLevel(): Promise<void> {}
  async getSessionStats() {
    return {};
  }
  async getCommands() {
    return this.commands;
  }
  respondToExtensionUiRequest(): void {}
  cancelExtensionUiRequest(): void {}
}

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "pi",
    cwd: join(tmpdir(), "chisacode-pi-lifecycle-test"),
    ...overrides,
  };
}

describe("PiSessionLifecycle", () => {
  test("closes the MCP probe runtime and only enables MCP when the adapter command is present", async () => {
    const { runtime, sessions } = createRuntime({
      commands: [
        {
          name: "mcp",
          source: "extension",
          sourceInfo: { package: "pi-mcp-adapter" },
        },
      ],
    });
    const lifecycle = new PiSessionLifecycle({
      runtime,
      logger: createTestLogger(),
      modelPrefix: null,
      baseCapabilities: CAPABILITIES,
    });
    const mcpServers: Record<string, McpServerConfig> = {
      example: { type: "stdio", command: "example-mcp", args: ["--stdio"] },
    };

    const session = await lifecycle.createSession(createConfig({ mcpServers }));
    expect(session.capabilities.supportsMcpServers).toBe(true);
    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(session.runtimeSession).toBe(sessions[1]);
    expect(session.runtimeSession.input.mcpConfigPath).toBeTruthy();
    expect(existsSync(session.runtimeSession.input.mcpConfigPath!)).toBe(true);
    session.cleanup();
    session.cleanup();
    expect(existsSync(session.runtimeSession.input.mcpConfigPath!)).toBe(false);
  });

  test("cleans resources when runtime startup fails", async () => {
    const { runtime } = createRuntime({ startError: new Error("start failed") });
    const lifecycle = new PiSessionLifecycle({
      runtime,
      logger: createTestLogger(),
      modelPrefix: null,
      baseCapabilities: CAPABILITIES,
    });

    await expect(
      lifecycle.createSession(createConfig({ systemPrompt: "temporary prompt" })),
    ).rejects.toThrow("start failed");
  });

  test("closes a started runtime when getState fails", async () => {
    const { runtime, sessions } = createRuntime({ stateError: new Error("state failed") });
    const lifecycle = new PiSessionLifecycle({
      runtime,
      logger: createTestLogger(),
      modelPrefix: "gateway",
      baseCapabilities: CAPABILITIES,
    });

    await expect(lifecycle.createSession(createConfig({ model: "model" }))).rejects.toThrow(
      "state failed",
    );
    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
  });

  test("writes MCP config with private permissions and cleans it after initialization cleanup", async () => {
    const { runtime, sessions } = createRuntime({ commands: [] });
    const lifecycle = new PiSessionLifecycle({
      runtime,
      logger: createTestLogger(),
      modelPrefix: null,
      baseCapabilities: CAPABILITIES,
    });
    const session = await lifecycle.createSession(
      createConfig({
        mcpServers: { example: { type: "http", url: "https://example.test/mcp" } },
      }),
    );
    expect(session.capabilities.supportsMcpServers).toBe(false);
    expect(sessions).toHaveLength(2);
    expect(session.runtimeSession.input.mcpConfigPath).toBeUndefined();
    session.cleanup();
  });
});
