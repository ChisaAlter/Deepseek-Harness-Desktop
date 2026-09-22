import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { SessionOutboundMessage } from "../messages.js";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;
type AgentUpdatePayload = AgentUpdateMessage["payload"];
type AgentUpsertPayload = Extract<AgentUpdatePayload, { kind: "upsert" }>;

/**
 * Poll for a condition on the collected agent updates array, re-checking up
 * to `timeoutMs` every `intervalMs` milliseconds.  Replaces fixed-delay sleeps
 * that blindly waited for agent state changes to propagate.
 */
async function waitForAgentUpdate(
  updates: AgentUpdatePayload[],
  predicate: (updates: AgentUpdatePayload[]) => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(updates)) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for agent update condition`);
}

function collectAgentUpdates(client: DaemonClient): {
  updates: AgentUpdatePayload[];
  unsub: () => void;
} {
  const updates: AgentUpdatePayload[] = [];
  const unsub = client.on("agent_update", (message) => {
    if (message.type === "agent_update") {
      updates.push(message.payload);
    }
  });
  return { updates, unsub };
}

function lastUpsertFor(
  updates: AgentUpdatePayload[],
  agentId: string,
): AgentUpsertPayload | undefined {
  return updates.findLast(
    (u): u is AgentUpsertPayload => u.kind === "upsert" && u.agent.id === agentId,
  );
}

function hasAnyUpsert(updates: AgentUpdatePayload[], agentId: string): boolean {
  return updates.some((u) => u.kind === "upsert" && u.agent.id === agentId);
}

function hasModeUpsert(updates: AgentUpdatePayload[], agentId: string, modeId: string): boolean {
  return updates.some(
    (u) => u.kind === "upsert" && u.agent.id === agentId && u.agent.currentModeId === modeId,
  );
}

function sliceHasModeUpsert(
  updates: AgentUpdatePayload[],
  beforeIndex: number,
  agentId: string,
  modeId: string,
): boolean {
  return hasModeUpsert(updates.slice(beforeIndex), agentId, modeId);
}

function hasTimestampChange(
  updates: AgentUpdatePayload[],
  agentId: string,
  before: string | undefined,
): boolean {
  return updates.some(
    (u) => u.kind === "upsert" && u.agent.id === agentId && u.agent.updatedAt !== before,
  );
}

describe("mode-switch update propagation", () => {
  let ctx: DaemonTestContext;

  beforeAll(async () => {
    ctx = await createDaemonTestContext();
  }, 30000);

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  }, 30000);

  test("agent_update event arrives with updated currentModeId after setAgentMode", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);

    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      modeId: "default",
    });
    expect(agent.currentModeId).toBe("default");

    await waitForAgentUpdate(updates, (u) => hasAnyUpsert(u, agent.id));
    const beforeCount = updates.length;

    await ctx.client.setAgentMode(agent.id, "bypassPermissions");
    await waitForAgentUpdate(updates, (u) =>
      sliceHasModeUpsert(u, beforeCount, agent.id, "bypassPermissions"),
    );

    const modeUpdate = updates
      .slice(beforeCount)
      .find(
        (u): u is AgentUpsertPayload =>
          u.kind === "upsert" &&
          u.agent.id === agent.id &&
          u.agent.currentModeId === "bypassPermissions",
      );

    expect(modeUpdate).toBeDefined();
    unsub();
  });

  test("updatedAt is bumped when mode changes", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);

    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      modeId: "default",
    });

    await waitForAgentUpdate(updates, (u) => hasAnyUpsert(u, agent.id));

    const updatedAtBefore = lastUpsertFor(updates, agent.id)?.agent.updatedAt;

    await ctx.client.setAgentMode(agent.id, "bypassPermissions");
    await waitForAgentUpdate(updates, (u) => hasTimestampChange(u, agent.id, updatedAtBefore));

    const updatedAtAfter = lastUpsertFor(updates, agent.id)?.agent.updatedAt;

    expect(updatedAtBefore).toBeTruthy();
    expect(updatedAtAfter).toBeTruthy();
    expect(updatedAtAfter).not.toBe(updatedAtBefore);

    unsub();
  });

  test("mode switch is visible in second client bootstrap snapshot", async () => {
    const { updates, unsub: unsubscribePrimary } = collectAgentUpdates(ctx.client);

    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      modeId: "default",
    });
    await waitForAgentUpdate(updates, (u) => hasAnyUpsert(u, agent.id));

    await ctx.client.setAgentMode(agent.id, "plan");
    await waitForAgentUpdate(updates, (u) => hasModeUpsert(u, agent.id, "plan"));

    const client2 = new DaemonClient({
      url: `ws://127.0.0.1:${ctx.daemon.port}/ws`,
    });
    await client2.connect();

    const bootstrapResult = await client2.fetchAgents({
      subscribe: { subscriptionId: "bootstrap-test" },
    });

    const found = bootstrapResult.entries.find((e) => e.agent.id === agent.id);
    expect(found?.agent.currentModeId).toBe("plan");

    const { updates: client2Updates, unsub } = collectAgentUpdates(client2);

    await ctx.client.setAgentMode(agent.id, "acceptEdits");
    await waitForAgentUpdate(client2Updates, (u) => hasModeUpsert(u, agent.id, "acceptEdits"));

    const modeUpdate = client2Updates.find(
      (u): u is AgentUpsertPayload =>
        u.kind === "upsert" && u.agent.id === agent.id && u.agent.currentModeId === "acceptEdits",
    );
    expect(modeUpdate).toBeDefined();

    unsub();
    unsubscribePrimary();
    await client2.close();
  });

  test("rapid mode switches settle to the final value", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);

    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      modeId: "default",
    });

    await ctx.client.setAgentMode(agent.id, "bypassPermissions");
    await ctx.client.setAgentMode(agent.id, "plan");
    await ctx.client.setAgentMode(agent.id, "acceptEdits");

    await waitForAgentUpdate(updates, (u) => hasModeUpsert(u, agent.id, "acceptEdits"));

    expect(lastUpsertFor(updates, agent.id)?.agent.currentModeId).toBe("acceptEdits");

    unsub();
  });

  test("mode switch immediately after creation reflects correct mode", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);

    const agent = await ctx.client.createAgent({
      provider: "claude",
      cwd: "/tmp",
      modeId: "default",
    });
    await ctx.client.setAgentMode(agent.id, "bypassPermissions");

    await waitForAgentUpdate(updates, (u) => hasModeUpsert(u, agent.id, "bypassPermissions"));

    expect(lastUpsertFor(updates, agent.id)?.agent.currentModeId).toBe("bypassPermissions");

    unsub();
  });
});
