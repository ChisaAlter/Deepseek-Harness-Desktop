import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createChisaCodeDaemon,
  type ChisaCodeDaemonConfig,
  type ChisaCodeOpenAIConfig,
  type ChisaCodeSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/notifications.js";

interface TestChisaCodeDaemonOptions {
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createChisaCodeDaemon>[1];
  mcpDebug?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  chisacodeHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: ChisaCodeOpenAIConfig;
  speech?: ChisaCodeSpeechConfig;
  voiceLlmProvider?: ChisaCodeDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: ChisaCodeDaemonConfig["auth"];
  modelGateways?: ChisaCodeDaemonConfig["modelGateways"];
  modelGatewayToken?: string;
  pushNotificationSender?: PushNotificationSender;
}

export interface TestChisaCodeDaemon {
  config: ChisaCodeDaemonConfig;
  daemon: Awaited<ReturnType<typeof createChisaCodeDaemon>>;
  port: number;
  chisacodeHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createChisaCodeDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestChisaCodeDaemon(
  options: TestChisaCodeDaemonOptions = {},
): Promise<TestChisaCodeDaemon> {
  // E2E/tests drive many requests in tight bursts that would exceed the
  // daemon's per-IP rate limit. Disable it for the test daemon process unless
  // the operator explicitly opts in (e.g. to test the limiter itself).
  if (process.env.CHISACODE_TEST_RATE_LIMIT !== "1") {
    process.env.CHISACODE_DISABLE_RATE_LIMIT = "1";
  }
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, chisacodeHomeRoot, chisacodeHome, staticDir } =
      await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createChisaCodeDaemon(config, logger);
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await Promise.all([
            rm(chisacodeHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        chisacodeHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(chisacodeHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: ChisaCodeDaemonConfig;
  chisacodeHomeRoot: string;
  chisacodeHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestChisaCodeDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const chisacodeHomeRoot =
    options.chisacodeHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "chisacode-home-")));
  const chisacodeHome = path.join(chisacodeHomeRoot, ".chisacode");
  await mkdir(chisacodeHome, { recursive: true });
  const staticDir =
    options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "chisacode-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const config: ChisaCodeDaemonConfig = {
    listen: `${listenHost}:0`,
    chisacodeHome,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: true,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    agentClients: options.agentClients ?? createTestAgentClients(),
    agentStoragePath: path.join(chisacodeHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.chisacode.sh:443",
    appBaseUrl: "https://app.chisacode.sh",
    auth: options.auth,
    modelGateways: options.modelGateways,
    modelGatewayToken: options.modelGatewayToken,
    pushNotificationSender: options.pushNotificationSender,
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
  };
  return { config, chisacodeHomeRoot, chisacodeHome, staticDir };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
