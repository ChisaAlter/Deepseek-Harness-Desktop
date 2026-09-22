import { describe, expect, it } from "vitest";
import {
  GenerativeUiActionQueue,
  GenerativeUiActionPayloadTooLargeError,
  GenerativeUiActionQueueFullError,
  MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES,
  MAX_GENERATIVE_UI_QUEUE_ACTIONS,
  MAX_GENERATIVE_UI_QUEUE_BATCHES,
  MAX_GENERATIVE_UI_QUEUE_RETAINED_BYTES,
  type GenerativeUiQueuedAction,
} from "./generative-ui-action-queue.js";

function action(
  actionName: string,
  payload: unknown,
  instanceId = "form-1",
): GenerativeUiQueuedAction {
  return { instanceId, action: actionName, payload, timestamp: 1_750_000_000_000 };
}

function actionsAtRetainedByteBudget(): GenerativeUiQueuedAction[] {
  const actions: GenerativeUiQueuedAction[] = [];
  const payloadOverhead = Buffer.byteLength(JSON.stringify({ value: "" }), "utf8");
  let retained = 0;
  for (let index = 0; index < 7; index += 1) {
    const next = action(`custom-${index}`, {
      value: "x".repeat(MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES - payloadOverhead),
    });
    actions.push(next);
    retained += Buffer.byteLength(JSON.stringify(next), "utf8");
  }
  const finalBase = action("custom-7", { value: "" });
  const finalOverhead = Buffer.byteLength(JSON.stringify(finalBase), "utf8");
  actions.push(
    action("custom-7", {
      value: "x".repeat(MAX_GENERATIVE_UI_QUEUE_RETAINED_BYTES - retained - finalOverhead),
    }),
  );
  return actions;
}
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GenerativeUiActionQueue", () => {
  it("coalesces same-tick idle changes and dispatches on the next microtask", async () => {
    const prompts: string[] = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "idle",
      dispatchPrompt: async (_agentId, prompt) => prompts.push(prompt),
      log: () => undefined,
    });
    queue.enqueue("agent-1", action("change", { field: "name", value: "first" }));
    queue.enqueue("agent-1", action("change", { field: "email", value: "a@example.com" }));
    queue.enqueue("agent-1", action("change", { field: "name", value: "latest" }));
    expect(prompts).toEqual([]);
    await flushMicrotasks();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('"field":"name","value":"latest"');
    expect(prompts[0]).not.toContain('"value":"first"');
    expect(prompts[0]?.indexOf('"field":"name"')).toBeLessThan(
      prompts[0]?.indexOf('"field":"email"') ?? -1,
    );
  });

  it("waits for a running agent terminal event and ignores duplicate terminal notifications", async () => {
    let status = "running";
    const prompts: string[] = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => status,
      dispatchPrompt: async (_agentId, prompt) => prompts.push(prompt),
      log: () => undefined,
    });
    queue.enqueue("agent-1", action("change", { field: "name", value: "Ada" }));
    await flushMicrotasks();
    expect(prompts).toEqual([]);
    status = "idle";
    queue.onAgentTerminal("agent-1");
    queue.onAgentTerminal("agent-1");
    await flushMicrotasks();
    expect(prompts).toHaveLength(1);
  });

  it("keeps submit after preceding changes and moves later actions into the next batch", async () => {
    let status = "idle";
    const prompts: string[] = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => status,
      dispatchPrompt: async (_agentId, prompt) => {
        prompts.push(prompt);
        status = "running";
      },
      log: () => undefined,
    });
    queue.enqueue("agent-1", action("change", { field: "name", value: "Ada" }));
    queue.enqueue("agent-1", action("submit", { values: { name: "Ada" } }));
    queue.enqueue("agent-1", action("change", { field: "name", value: "Grace" }));
    await flushMicrotasks();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.indexOf('"action":"change"')).toBeLessThan(
      prompts[0]?.indexOf('"action":"submit"') ?? -1,
    );
    expect(prompts[0]).not.toContain("Grace");
    status = "idle";
    queue.onAgentTerminal("agent-1");
    await flushMicrotasks();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Grace");
  });

  it("drops failed batches once and reports bounded metadata", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "idle",
      dispatchPrompt: async () => {
        throw new Error("provider included secret payload");
      },
      log: (metadata) => logs.push(metadata),
    });
    queue.enqueue("agent-1", action("submit", { secret: "do-not-log" }));
    await flushMicrotasks();
    expect(logs).toEqual([
      expect.objectContaining({ agentId: "agent-1", actionCount: 1, reason: "dispatch_failed" }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("do-not-log");
    expect(queue.hasPending("agent-1")).toBe(false);
  });

  it("does not retry a failed batch and continues a later idle batch", async () => {
    let attempts = 0;
    const prompts: string[] = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "idle",
      dispatchPrompt: async (_agentId, prompt) => {
        attempts += 1;
        if (attempts === 1) throw new Error("first batch failed");
        prompts.push(prompt);
      },
      log: () => undefined,
    });
    queue.enqueue("agent-1", action("submit", { values: { name: "Ada" } }));
    queue.enqueue("agent-1", action("change", { field: "name", value: "Grace" }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(attempts).toBe(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Grace");
  });
  it("clears queued state once when a terminal event leaves the agent in error", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "error",
      dispatchPrompt: async () => {
        throw new Error("must not dispatch");
      },
      log: (metadata) => logs.push(metadata),
    });

    queue.enqueue("agent-1", action("submit", { secret: "do-not-log" }));
    queue.onAgentTerminal("agent-1");
    queue.onAgentTerminal("agent-1");
    await flushMicrotasks();

    expect(queue.hasPending("agent-1")).toBe(false);
    expect(logs).toEqual([
      expect.objectContaining({ agentId: "agent-1", actionCount: 1, reason: "agent_unavailable" }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("do-not-log");
  });
  it("clears queued state when the agent is removed before dispatch", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => undefined,
      dispatchPrompt: async () => {
        throw new Error("must not dispatch");
      },
      log: (metadata) => logs.push(metadata),
    });
    queue.enqueue("agent-1", action("change", { field: "name", value: "Ada" }));
    await flushMicrotasks();
    expect(queue.hasPending("agent-1")).toBe(false);
    expect(logs).toEqual([
      expect.objectContaining({ agentId: "agent-1", actionCount: 1, reason: "agent_unavailable" }),
    ]);
  });

  it("accepts exact batch and action budgets and rejects one-over without mutation", () => {
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    for (let index = 0; index < MAX_GENERATIVE_UI_QUEUE_BATCHES; index += 1) {
      queue.enqueue("batch-agent", action("submit", { index }));
    }
    expect(() => queue.enqueue("batch-agent", action("submit", { overflow: true }))).toThrowError(
      GenerativeUiActionQueueFullError,
    );

    const actionQueue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    for (let index = 0; index < MAX_GENERATIVE_UI_QUEUE_ACTIONS; index += 1) {
      actionQueue.enqueue("action-agent", action(`custom-${index}`, null));
    }
    expect(() => actionQueue.enqueue("action-agent", action("overflow", null))).toThrowError(
      GenerativeUiActionQueueFullError,
    );
    expect(actionQueue.hasPending("action-agent")).toBe(true);
  });

  it("enforces the individual payload byte boundary before mutation", () => {
    const exactQueue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    const payloadOverhead = Buffer.byteLength(JSON.stringify({ value: "" }), "utf8");
    const exactPayload = {
      value: "x".repeat(MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES - payloadOverhead),
    };
    expect(() => exactQueue.enqueue("agent-1", action("custom", exactPayload))).not.toThrow();

    const overflowQueue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    const oversizedPayload = {
      value: "x".repeat(MAX_GENERATIVE_UI_ACTION_PAYLOAD_BYTES - payloadOverhead + 1),
    };
    expect(() => overflowQueue.enqueue("agent-1", action("custom", oversizedPayload))).toThrowError(
      GenerativeUiActionPayloadTooLargeError,
    );
    expect(overflowQueue.hasPending("agent-1")).toBe(false);
  });
  it("enforces retained byte budget at the exact boundary", () => {
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    for (const retainedAction of actionsAtRetainedByteBudget()) {
      queue.enqueue("agent-1", retainedAction);
    }
    expect(() => queue.enqueue("agent-1", action("overflow", null))).toThrowError(
      GenerativeUiActionQueueFullError,
    );
  });

  it("bounds repeated near-limit submit batches while running", () => {
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    const largePayload = { value: "x".repeat(65_000) };
    let accepted = 0;
    while (accepted < MAX_GENERATIVE_UI_QUEUE_BATCHES) {
      try {
        queue.enqueue("agent-1", action("submit", largePayload));
        accepted += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(GenerativeUiActionQueueFullError);
        break;
      }
    }
    expect(accepted).toBeGreaterThan(1);
    expect(accepted).toBeLessThan(MAX_GENERATIVE_UI_QUEUE_BATCHES);
    expect(() => queue.enqueue("agent-1", action("submit", largePayload))).toThrowError(
      GenerativeUiActionQueueFullError,
    );
  });

  it("updates byte accounting for coalesced replacements", () => {
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "running",
      dispatchPrompt: async () => undefined,
      log: () => undefined,
    });
    for (const retainedAction of actionsAtRetainedByteBudget().slice(0, 7)) {
      queue.enqueue("agent-1", retainedAction);
    }
    queue.enqueue("agent-1", action("change", { field: "name", value: "x".repeat(60_000) }));
    queue.enqueue("agent-1", action("change", { field: "name", value: "small" }));
    expect(() =>
      queue.enqueue("agent-1", action("custom-extra", { value: "x".repeat(60_000) })),
    ).not.toThrow();
  });
  it("keeps an in-flight batch counted until dispatch settles and recovers afterward", async () => {
    let resolveDispatch!: () => void;
    const dispatch = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const queue = new GenerativeUiActionQueue({
      getAgentStatus: () => "idle",
      dispatchPrompt: () => dispatch,
      log: () => undefined,
    });
    for (const retainedAction of actionsAtRetainedByteBudget()) {
      queue.enqueue("agent-1", retainedAction);
    }
    await flushMicrotasks();
    expect(queue.hasPending("agent-1")).toBe(true);
    expect(() => queue.enqueue("agent-1", action("later", null))).toThrowError(
      GenerativeUiActionQueueFullError,
    );
    resolveDispatch();
    await flushMicrotasks();
    expect(queue.hasPending("agent-1")).toBe(false);
    expect(() => queue.enqueue("agent-1", action("later", null))).not.toThrow();
  });
});
