import pino from "pino";
import { describe, expect, it } from "vitest";
import { GenerativeUiHandler } from "./generative-ui-handler.js";
import type { GenerativeUiHandlerContext } from "./session-context.js";
import {
  GenerativeUiActionQueue,
  GenerativeUiActionQueueFullError,
  type GenerativeUiQueuedAction,
} from "../agent/generative-ui-action-queue.js";

interface Enqueued {
  agentId: string;
  action: GenerativeUiQueuedAction;
}

function createContext(
  enqueued: Enqueued[],
  emitted: Record<string, unknown>[],
): GenerativeUiHandlerContext {
  return {
    clientId: "client-1",
    sessionId: "session-1",
    sessionLogger: pino({ level: "silent" }),
    chisacodeHome: "/tmp/chisacode",
    appVersion: null,
    getOperationAbortSignal: () => new AbortController().signal,
    emit: (message) => emitted.push(message as Record<string, unknown>),
    emitBinary: () => undefined,
    hasBinaryChannel: () => false,
    supports: () => true,
    agentManager: {
      getAgent: () => ({ lifecycle: "running" }),
      enqueueGenerativeUiAction: (agentId: string, action: GenerativeUiQueuedAction) => {
        enqueued.push({ agentId, action });
        return { queued: true } as const;
      },
    },
  } as GenerativeUiHandlerContext;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    type: "generative_ui.action.request" as const,
    requestId: "req-1",
    agentId: "agent-1",
    instanceId: "form-1",
    action: "submit",
    payload: { values: { name: "Ada" } },
    timestamp: 1_750_000_000_000,
    ...overrides,
  };
}

describe("GenerativeUiHandler", () => {
  it("returns a bounded overload response without mutating the full queue", async () => {
    const emitted: Record<string, unknown>[] = [];
    const context = createContext([], emitted);
    context.agentManager = {
      getAgent: () => ({ lifecycle: "running" }),
      enqueueGenerativeUiAction: () => {
        throw new GenerativeUiActionQueueFullError();
      },
    } as GenerativeUiHandlerContext["agentManager"];
    const handler = new GenerativeUiHandler(context);

    await handler.dispatch(request({ payload: { secret: "do-not-log" } }));

    expect(emitted).toEqual([
      {
        type: "generative_ui.action.response",
        payload: {
          requestId: "req-1",
          received: false,
          error: "generative UI action queue is full",
        },
      },
    ]);
    expect(JSON.stringify(emitted)).not.toContain("do-not-log");
  });
  it.each(["generative_ui.action.request", "generative_ui.action"] as const)(
    "enqueues %s through the shared AgentManager and responds immediately",
    async (type) => {
      const enqueued: Enqueued[] = [];
      const emitted: Record<string, unknown>[] = [];
      const handler = new GenerativeUiHandler(createContext(enqueued, emitted));
      await handler.dispatch(request({ type }));
      expect(enqueued).toHaveLength(1);
      expect(emitted).toEqual([
        {
          type: "generative_ui.action.response",
          payload: { requestId: "req-1", received: true, error: null },
        },
      ]);
    },
  );

  it("uses one manager-owned queue across separate handler contexts", async () => {
    const prompts: string[] = [];
    let status = "running";
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => status,
      dispatchPrompt: async (_agentId, prompt) => prompts.push(prompt),
      log: () => undefined,
    });
    const sharedManager = {
      getAgent: () => ({ lifecycle: "idle" }),
      enqueueGenerativeUiAction: (agentId: string, action: GenerativeUiQueuedAction) => {
        queue.enqueue(agentId, action);
        return { queued: true } as const;
      },
    };
    const firstContext = createContext([], []);
    const secondContext = createContext([], []);
    firstContext.agentManager = sharedManager as GenerativeUiHandlerContext["agentManager"];
    secondContext.agentManager = sharedManager as GenerativeUiHandlerContext["agentManager"];
    const first = new GenerativeUiHandler(firstContext);
    const second = new GenerativeUiHandler(secondContext);
    await first.dispatch(request({ requestId: "req-1", action: "change" }));
    await second.dispatch(request({ requestId: "req-2", action: "submit" }));
    status = "idle";
    queue.onAgentTerminal("agent-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('"action":"change"');
    expect(prompts[0]).toContain('"action":"submit"');
  });

  it.each([
    ["long instance", { instanceId: "x".repeat(257) }],
    ["long action", { action: "x".repeat(129) }],
    ["oversized payload", { payload: { value: "x".repeat(65_537) } }],
    ["unsupported payload", { payload: { value: BigInt(1) } }],
  ])("rejects %s before enqueue without exposing payload", async (_name, overrides) => {
    const enqueued: Enqueued[] = [];
    const emitted: Record<string, unknown>[] = [];
    const handler = new GenerativeUiHandler(createContext(enqueued, emitted));
    await handler.dispatch(request(overrides));
    expect(enqueued).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "generative_ui.action.response",
        payload: { requestId: "req-1", received: false, error: "invalid generative UI action" },
      },
    ]);
    expect(JSON.stringify(emitted)).not.toContain("65537");
  });

  it("rejects cyclic payloads before enqueue", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const enqueued: Enqueued[] = [];
    const emitted: Record<string, unknown>[] = [];
    const handler = new GenerativeUiHandler(createContext(enqueued, emitted));
    await handler.dispatch(request({ payload: cyclic }));
    expect(enqueued).toEqual([]);
    expect(emitted[0]).toEqual({
      type: "generative_ui.action.response",
      payload: { requestId: "req-1", received: false, error: "invalid generative UI action" },
    });
  });
});
