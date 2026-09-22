import { describe, expect, it, vi } from "vitest";
import {
  decodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@chisacode/protocol/binary-frames/index";
import type { SessionInboundMessage } from "@chisacode/protocol/messages";

import { TerminalClient } from "./daemon-client-terminal-client.js";

interface RequestParams {
  requestId?: string;
  message: { type: string } & Record<string, unknown>;
  responseType: string;
  timeout: number;
}

function createTerminalClientHarness() {
  let connected = false;
  const sentMessages: SessionInboundMessage[] = [];
  const sentBinaryFrames: Uint8Array[] = [];
  const request = vi.fn(async (params: RequestParams) => {
    if (params.responseType === "subscribe_terminal_response") {
      return {
        requestId: params.requestId ?? "generated-request",
        terminalId: params.message.terminalId,
        slot: 7,
        error: null,
      };
    }
    return {
      requestId: params.requestId ?? "generated-request",
      error: null,
    };
  });
  const client = new TerminalClient({
    request,
    isConnected: () => connected,
    sendMessage: (message) => sentMessages.push(message),
    sendBinaryFrame: (frame) => sentBinaryFrames.push(frame),
  } as unknown as ConstructorParameters<typeof TerminalClient>[0]);
  return {
    client,
    request,
    sentMessages,
    sentBinaryFrames,
    setConnected(value: boolean) {
      connected = value;
    },
  };
}

describe("TerminalClient", () => {
  it("retains directory subscriptions while disconnected and restores them after reconnect", () => {
    const harness = createTerminalClientHarness();

    harness.client.subscribeDirectories({ cwd: "/repo/one" });
    harness.client.subscribeDirectories({ cwd: "/repo/two" });
    expect(harness.sentMessages).toEqual([]);

    harness.setConnected(true);
    harness.client.resubscribeDirectories();
    expect(harness.sentMessages).toEqual([
      { type: "subscribe_terminals_request", cwd: "/repo/one" },
      { type: "subscribe_terminals_request", cwd: "/repo/two" },
    ]);

    harness.client.unsubscribeDirectories({ cwd: "/repo/one" });
    harness.sentMessages.length = 0;
    harness.client.resubscribeDirectories();
    expect(harness.sentMessages).toEqual([
      { type: "subscribe_terminals_request", cwd: "/repo/two" },
    ]);
  });

  it("maps terminal RPC commands through the correlated transport", async () => {
    const harness = createTerminalClientHarness();

    await harness.client.listTerminals("/repo", "list-1");
    await harness.client.createTerminal("/repo", "shell", "create-1", {
      agentId: "agent-1",
      command: "node",
      args: ["--version"],
    });
    await harness.client.renameTerminal({
      terminalId: "term-1",
      title: "Build",
      requestId: "rename-1",
    });
    await harness.client.killTerminal("term-1", "kill-1");
    await harness.client.captureTerminal(
      "term-1",
      { start: 2, end: 8, stripAnsi: true },
      "capture-1",
    );

    expect(harness.request.mock.calls.map(([params]) => params)).toEqual([
      {
        requestId: "list-1",
        message: { type: "list_terminals_request", cwd: "/repo" },
        responseType: "list_terminals_response",
        timeout: 10_000,
      },
      {
        requestId: "create-1",
        message: {
          type: "create_terminal_request",
          cwd: "/repo",
          name: "shell",
          agentId: "agent-1",
          command: "node",
          args: ["--version"],
        },
        responseType: "create_terminal_response",
        timeout: 10_000,
      },
      {
        requestId: "rename-1",
        message: { type: "terminal.rename.request", terminalId: "term-1", title: "Build" },
        responseType: "terminal.rename.response",
        timeout: 10_000,
      },
      {
        requestId: "kill-1",
        message: { type: "kill_terminal_request", terminalId: "term-1" },
        responseType: "kill_terminal_response",
        timeout: 10_000,
      },
      {
        requestId: "capture-1",
        message: {
          type: "capture_terminal_request",
          terminalId: "term-1",
          start: 2,
          end: 8,
          stripAnsi: true,
        },
        responseType: "capture_terminal_response",
        timeout: 10_000,
      },
    ]);
  });

  it("owns terminal stream slots and falls back to session input after exit", async () => {
    const harness = createTerminalClientHarness();
    harness.setConnected(true);
    const seen: string[] = [];
    harness.client.onStreamEvent((event) => {
      if (event.type === "output") {
        seen.push(new TextDecoder().decode(event.data));
      }
    });

    await harness.client.subscribeTerminal("term-1", "sub-1");
    expect(harness.request).toHaveBeenCalledWith({
      requestId: "sub-1",
      message: { type: "subscribe_terminal_request", terminalId: "term-1" },
      responseType: "subscribe_terminal_response",
      timeout: 10_000,
    });

    harness.client.handleFrame({
      opcode: TerminalStreamOpcode.Output,
      slot: 7,
      payload: new TextEncoder().encode("hello"),
    });
    harness.client.sendInput("term-1", { type: "input", data: "echo hello\r" });

    expect(seen).toEqual(["hello"]);
    expect(harness.sentBinaryFrames).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(harness.sentBinaryFrames[0]);
    expect(frame).toMatchObject({ opcode: TerminalStreamOpcode.Input, slot: 7 });

    harness.client.handleStreamExit("term-1");
    harness.client.sendInput("term-1", { type: "input", data: "fallback\r" });
    expect(harness.sentMessages.at(-1)).toEqual({
      type: "terminal_input",
      terminalId: "term-1",
      message: { type: "input", data: "fallback\r" },
    });
  });
});
