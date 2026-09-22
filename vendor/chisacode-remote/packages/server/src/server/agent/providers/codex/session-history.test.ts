import { describe, expect, test } from "vitest";

import { CodexSessionHistory } from "./session-history.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

function createHistory(response: unknown) {
  const userMessageTurns = new CodexUserMessageTurnState();
  const requests: Array<{ method: string; params?: unknown }> = [];
  const history = new CodexSessionHistory({
    getClient: () => ({
      request: async (method, params) => {
        requests.push({ method, params });
        return response;
      },
    }),
    getThreadId: () => "thread-1",
    getCwd: () => "/workspace/project",
    userMessageTurns,
  });
  return { history, requests, userMessageTurns };
}

describe("Codex session history", () => {
  test("loads, indexes, and drains persisted timeline entries", async () => {
    const { history, requests, userMessageTurns } = createHistory({
      thread: {
        turns: [
          {
            items: [
              {
                type: "userMessage",
                id: "user-1",
                content: [{ type: "text", text: "Hello" }],
              },
              {
                type: "agentMessage",
                id: "assistant-1",
                text: "Hi",
              },
            ],
          },
        ],
      },
    });

    await history.load();
    const entries = history.drain();

    expect(requests).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-1", includeTurns: true },
      },
    ]);
    expect(entries.map((entry) => entry.item.type)).toEqual(["user_message", "assistant_message"]);
    expect(userMessageTurns.count()).toBe(1);
    expect(userMessageTurns.resolve("user-1")).toBe(0);
    expect(history.drain()).toEqual([]);
  });

  test("reset discards pending history", async () => {
    const { history } = createHistory({
      thread: {
        turns: [{ items: [{ type: "agentMessage", id: "assistant-1", text: "Hi" }] }],
      },
    });

    await history.load();
    history.reset();

    expect(history.drain()).toEqual([]);
  });
});
