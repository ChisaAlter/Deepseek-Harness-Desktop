import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";
import type { SessionOutboundMessage } from "../messages.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

function isPermissionResolvedMessage(
  message: SessionOutboundMessage,
  agentId: string,
  requestId: string,
  behavior: "allow" | "deny",
): boolean {
  if (message.type === "agent_permission_resolved") {
    return (
      message.payload.agentId === agentId &&
      message.payload.requestId === requestId &&
      message.payload.resolution.behavior === behavior
    );
  }

  if (message.type !== "agent_stream" || message.payload.agentId !== agentId) {
    return false;
  }
  return (
    message.payload.event.type === "permission_resolved" &&
    message.payload.event.requestId === requestId &&
    message.payload.event.resolution.behavior === behavior
  );
}

function waitForPermissionResolved(
  ctx: DaemonTestContext,
  collector: MessageCollector,
  agentId: string,
  requestId: string,
  behavior: "allow" | "deny",
  timeoutMs = 5_000,
): Promise<void> {
  if (
    collector.messages.some((message) =>
      isPermissionResolvedMessage(message, agentId, requestId, behavior),
    )
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error(`Timed out waiting for ${behavior} permission resolution ${requestId}`));
    }, timeoutMs);

    unsubscribe = ctx.client.subscribeRawMessages((message) => {
      if (!isPermissionResolvedMessage(message, agentId, requestId, behavior)) {
        return;
      }
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    });
  });
}

describe("daemon E2E - permission flow: Claude", () => {
  let ctx: DaemonTestContext;
  let collector: MessageCollector;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    collector = createMessageCollector(ctx.client);
  });

  afterEach(async () => {
    collector.unsubscribe();
    await ctx.cleanup();
  }, 60_000);

  test("approves permission and executes command", async () => {
    const cwd = tmpCwd();
    const filePath = path.join(cwd, "permission.txt");
    try {
      writeFileSync(filePath, "ok", "utf8");

      const agent = await ctx.client.createAgent({
        provider: "claude",
        cwd,
        title: "Claude Permission Test",
        modeId: "default",
      });

      collector.clear();
      await ctx.client.sendMessage(
        agent.id,
        "You must call the Bash command tool with the exact command `rm -f permission.txt`. After approval, run it and reply DONE.",
      );

      const permissionState = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(permissionState.status).toBe("permission");
      expect(permissionState.final?.pendingPermissions?.length).toBeGreaterThan(0);
      const permission = permissionState.final!.pendingPermissions[0];

      const permissionResolved = waitForPermissionResolved(
        ctx,
        collector,
        agent.id,
        permission.id,
        "allow",
      );
      await ctx.client.respondToPermission(agent.id, permission.id, { behavior: "allow" });

      const finalState = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(finalState.status).toBe("idle");
      expect(existsSync(filePath)).toBe(false);

      await permissionResolved;

      await ctx.client.deleteAgent(agent.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("denies permission and prevents execution", async () => {
    const cwd = tmpCwd();
    const filePath = path.join(cwd, "permission.txt");
    try {
      writeFileSync(filePath, "ok", "utf8");

      const agent = await ctx.client.createAgent({
        provider: "claude",
        cwd,
        title: "Claude Permission Deny Test",
        modeId: "default",
      });

      collector.clear();
      await ctx.client.sendMessage(
        agent.id,
        "You must call the Bash command tool with the exact command `rm -f permission.txt`. If approval is denied, reply DENIED and stop.",
      );

      const permissionState = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(permissionState.status).toBe("permission");
      expect(permissionState.final?.pendingPermissions?.length).toBeGreaterThan(0);
      const permission = permissionState.final!.pendingPermissions[0];

      const permissionResolved = waitForPermissionResolved(
        ctx,
        collector,
        agent.id,
        permission.id,
        "deny",
      );
      await ctx.client.respondToPermission(agent.id, permission.id, {
        behavior: "deny",
        message: "Not allowed.",
      });

      const finalState = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(finalState.status).toBe("idle");
      expect(existsSync(filePath)).toBe(true);

      await permissionResolved;

      await ctx.client.deleteAgent(agent.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
