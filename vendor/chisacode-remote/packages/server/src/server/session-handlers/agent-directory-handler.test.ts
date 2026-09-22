import pino from "pino";
import { describe, expect, it } from "vitest";

import type { SessionOutboundMessage } from "../messages.js";
import {
  AgentDirectoryHandler,
  type AgentDirectoryHandlerContext,
} from "./agent-directory-handler.js";

function createContext(emitted: SessionOutboundMessage[]): AgentDirectoryHandlerContext {
  return {
    appVersion: null,
    sessionLogger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message),
    supports: () => true,
    resolveAgentIdentifier: async () => ({ ok: false, error: "Agent not found: missing" }),
  } as AgentDirectoryHandlerContext;
}

describe("AgentDirectoryHandler", () => {
  it("owns agent read-model routing and preserves fetch detail errors", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const handler = new AgentDirectoryHandler(createContext(emitted));

    const handled = handler.dispatch({
      type: "fetch_agent_request",
      agentId: "missing",
      requestId: "fetch-1",
    });
    const unrelated = handler.dispatch({
      type: "ping",
      payload: { requestId: "ping-1" },
    });

    expect(handled).toBeInstanceOf(Promise);
    await expect(handled).resolves.toBeUndefined();
    expect(unrelated).toBeUndefined();
    expect(emitted).toEqual([
      {
        type: "fetch_agent_response",
        payload: {
          requestId: "fetch-1",
          agent: null,
          project: null,
          error: "Agent not found: missing",
        },
      },
    ]);
  });
});
