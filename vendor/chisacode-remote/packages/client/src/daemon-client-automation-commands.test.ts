import { describe, expect, test } from "vitest";

import type { DaemonCommandTransport } from "./daemon-client-command-transport.js";
import { AutomationCommandClient } from "./daemon-client-automation-commands.js";

function createHarness(): {
  client: AutomationCommandClient;
  requests: Array<Parameters<DaemonCommandTransport["request"]>[0]>;
} {
  const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
  const client = new AutomationCommandClient({
    request: async (params) => {
      requests.push(params);
      return {} as never;
    },
  });
  return { client, requests };
}

describe("AutomationCommandClient", () => {
  test("maps chat wait options and extends the transport timeout", async () => {
    const { client, requests } = createHarness();

    await client.waitForChatMessages({
      room: "architecture",
      afterMessageId: null,
      timeoutMs: 2500,
      requestId: "chat-wait-1",
    });

    expect(requests).toEqual([
      {
        requestId: "chat-wait-1",
        message: { type: "chat/wait", room: "architecture", timeoutMs: 2500 },
        responseType: "chat/wait/response",
        timeout: 12500,
      },
    ]);
  });

  test("maps schedule update ids while preserving explicit nullable fields", async () => {
    const { client, requests } = createHarness();

    await client.scheduleUpdate({
      id: "schedule-1",
      name: null,
      maxRuns: null,
      expiresAt: null,
      requestId: "schedule-update-1",
    });

    expect(requests[0]).toEqual({
      requestId: "schedule-update-1",
      message: {
        type: "schedule/update",
        scheduleId: "schedule-1",
        name: null,
        maxRuns: null,
        expiresAt: null,
      },
      responseType: "schedule/update/response",
      timeout: 10000,
    });
  });

  test("supports loop string overloads without manufacturing request ids", async () => {
    const { client, requests } = createHarness();

    await client.loopInspect("loop-1");
    await client.loopLogs("loop-1", 7);
    await client.loopStop("loop-1");

    expect(requests).toMatchObject([
      { message: { type: "loop/inspect", id: "loop-1" } },
      { message: { type: "loop/logs", id: "loop-1", afterSeq: 7 } },
      { message: { type: "loop/stop", id: "loop-1" } },
    ]);
    expect(requests.every((request) => request.requestId === undefined)).toBe(true);
  });
});
