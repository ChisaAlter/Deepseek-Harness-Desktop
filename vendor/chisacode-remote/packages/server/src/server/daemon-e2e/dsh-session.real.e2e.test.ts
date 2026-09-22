/**
 * Daemon e2e against the real DeepSeek Harness ACP transport.
 *
 * Environment:
 * - Both blocks need `@deepseek-ai/dsh` + `@deepseek-ai/dsh-acp-demo`
 *   installed globally (pinned rc channel; see docs/dsh-upstream-contract.md).
 * - The round-trip block additionally needs DEEPSEEK_API_KEY; the transport
 *   block deliberately runs with the key scrubbed to lock in the clean
 *   missing-credential failure surface through ChisaCode.
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { buildProviderRegistry } from "../agent/provider-registry.js";
import type { AgentClient } from "../agent/agent-sdk-types.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import {
  createTestChisaCodeDaemon,
  type TestChisaCodeDaemon,
} from "../test-utils/chisacode-daemon.js";
import { isDshHarnessInstalled, isProviderAvailable } from "./agent-configs.js";
import { fetchTimelineItems } from "./test-utils/rewind-helpers.js";

const DSH_FLASH_MODELS = [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", isDefault: true }];

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-real-dsh-"));
}

interface DshHarness {
  client: DaemonClient;
  daemon: TestChisaCodeDaemon;
  chisacodeHome: string;
  restoreEnv: () => void;
}

async function launchDshDaemon(options: { scrubApiKey: boolean }): Promise<DshHarness> {
  // DshAgentClient materializes the managed composition under CHISACODE_HOME at
  // construction — isolate it per test daemon instead of the real user home.
  const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-dsh-home-"));
  const savedHome = process.env.CHISACODE_HOME;
  process.env.CHISACODE_HOME = chisacodeHome;

  const keyBackup = process.env.DEEPSEEK_API_KEY;
  if (options.scrubApiKey) {
    delete process.env.DEEPSEEK_API_KEY;
    // Scrub the file-backed credential path too: ~/.dsh/.credentials.yaml left
    // by `dsh web` would otherwise turn the missing-key gate into a pass.
    process.env.DSH_HOME = path.join(chisacodeHome, "dsh-home-empty");
  }

  const logger = pino({ level: "warn" });
  // Build the dsh client through the production registry so the provider-id
  // wrapper (acp transport vs `dsh` surface id) matches what ships.
  const registryLogger = logger.child({ module: "provider-registry" });
  const registry = buildProviderRegistry(registryLogger, {
    providerOverrides: {
      dsh: { models: DSH_FLASH_MODELS },
    },
  });
  const dshClient: AgentClient = registry.dsh.createClient(registryLogger);
  const daemon = await createTestChisaCodeDaemon({
    agentClients: { dsh: dshClient },
    logger,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: { subscriptionId: "dsh-real" } });

  return {
    client,
    daemon,
    chisacodeHome,
    restoreEnv: () => {
      if (savedHome === undefined) {
        delete process.env.CHISACODE_HOME;
      } else {
        process.env.CHISACODE_HOME = savedHome;
      }
      if (keyBackup === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = keyBackup;
      }
      delete process.env.DSH_HOME;
    },
  };
}

async function closeDshDaemon(harness: DshHarness): Promise<void> {
  await harness.client.close().catch(() => undefined);
  await harness.daemon.close().catch(() => undefined);
  harness.restoreEnv();
}

async function waitForManagedComposition(harness: DshHarness): Promise<void> {
  const managedRoot = path.join(harness.chisacodeHome, "provider-runtime", "dsh");
  await vi.waitFor(() => {
    expect(() => readdirSync(managedRoot)).not.toThrow();
  });
}

describe("daemon E2E (real dsh) — transport without credentials", () => {
  let canRun = false;

  beforeAll(async () => {
    canRun = await isDshHarnessInstalled();
  });

  beforeEach((context) => {
    if (!canRun) {
      context.skip();
    }
  });

  test("surfaces a clean missing-credential error at create time", async () => {
    const harness = await launchDshDaemon({ scrubApiKey: true });
    try {
      await expect(
        harness.client.createAgent({
          cwd: tmpCwd(),
          title: "dsh-real-no-key",
          provider: "dsh",
          model: "deepseek-v4-flash",
        }),
      ).rejects.toThrow(/尚未配置 API 密钥|DEEPSEEK_API_KEY/i);
    } finally {
      await closeDshDaemon(harness);
    }
  }, 240_000);
});

/**
 * Waits until the credential failure text lands in the agent stream.
 * After an upstream turn-failure the agent leaves the wait tracking map, so
 * waitForFinish cannot resolve here; the streamed text is the user-visible
 * failure surface.
 */

describe("daemon E2E (real dsh) — prompt round trip", () => {
  let canRun = false;

  beforeAll(async () => {
    canRun = await isProviderAvailable("dsh");
  });

  beforeEach((context) => {
    if (!canRun) {
      context.skip();
    }
  });

  test("streams a committed answer for a marker prompt", async () => {
    const harness = await launchDshDaemon({ scrubApiKey: false });
    try {
      const agent = await harness.client.createAgent({
        cwd: tmpCwd(),
        title: "dsh-real-round-trip",
        provider: "dsh",
        model: "deepseek-v4-flash",
      });

      await waitForManagedComposition(harness);
      await harness.client.sendMessage(
        agent.id,
        "Reply with exactly these tokens and nothing else: DSH_E2E_PONG",
      );
      const finish = await harness.client.waitForFinish(agent.id, 300_000);
      expect(finish.status).toBe("idle");
      expect(finish.final?.lastError).toBeUndefined();

      const timeline = await fetchTimelineItems(harness.client, agent.id);
      const assistantTexts = timeline
        .filter((item) => item.type === "assistant_message")
        .map((item) => item.text);
      expect(assistantTexts.join("\n")).toContain("DSH_E2E_PONG");
    } finally {
      await closeDshDaemon(harness);
    }
  }, 420_000);

  test("cancels a mid-turn prompt cleanly", async () => {
    const harness = await launchDshDaemon({ scrubApiKey: false });
    try {
      const agent = await harness.client.createAgent({
        cwd: tmpCwd(),
        title: "dsh-real-cancel",
        provider: "dsh",
        model: "deepseek-v4-flash",
      });

      await harness.client.sendMessage(
        agent.id,
        "Write a very long essay about the history of computing, at least 2000 words.",
      );
      await vi.waitFor(async () => {
        const snapshot = await harness.client.fetchAgent(agent.id);
        expect(snapshot?.agent.status).toBe("running");
      });
      await harness.client.cancelAgent(agent.id);
      await vi.waitFor(async () => {
        const snapshot = await harness.client.fetchAgent(agent.id);
        expect(snapshot?.agent.status).toBe("idle");
      });
    } finally {
      await closeDshDaemon(harness);
    }
  }, 300_000);
});
