/**
 * Real-daemon verification for first-send startup latency optimizations.
 *
 * Checks:
 * 1) send_agent_message_response is accepted before provider.codex.spawn
 * 2) no throwaway listModels spawn on first send (normalizeConfig uses snapshot cache)
 *
 * Usage (from repo root):
 *   npx tsx packages/server/scripts/verify-first-send-startup.ts
 */
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pino from "pino";

import { createChisaCodeDaemon } from "../src/server/bootstrap.js";
import { DaemonClient } from "../src/server/test-utils/daemon-client.js";

interface TimedLog {
  t: number;
  level: string;
  msg: string;
  raw: Record<string, unknown>;
}

function nowMs(): number {
  return performance.now();
}

function isCodexSpawn(entry: TimedLog): boolean {
  return entry.msg === "provider.codex.spawn";
}

function isListModelsSpawnCandidate(entry: TimedLog): boolean {
  // listModels uses a throwaway app-server; it logs provider.codex.spawn without agentId.
  if (!isCodexSpawn(entry)) {
    return false;
  }
  return entry.raw.agentId == null;
}

async function waitForCodexReady(
  client: DaemonClient,
  cwd: string,
  logger: pino.Logger,
): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const snapshot = await client.getProvidersSnapshot({ cwd });
    const entry = snapshot.entries.find((candidate) => candidate.provider === "codex");
    logger.info(
      {
        attempt: i + 1,
        status: entry?.status ?? null,
        modelCount: entry?.models?.length ?? 0,
      },
      "verify.provider.snapshot",
    );
    if (entry && entry.status === "ready" && (entry.models?.length ?? 0) > 0) {
      return;
    }
    if (entry && (entry.status === "error" || entry.status === "unavailable")) {
      throw new Error(
        `Codex provider not ready: status=${entry.status} error=${entry.error ?? "none"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for codex provider snapshot to become ready");
}

async function main(): Promise<void> {
  const startedAt = nowMs();
  const logs: TimedLog[] = [];
  const logPath = path.join(os.tmpdir(), `chisacode-first-send-verify-${Date.now()}.log`);

  const destination = pino.destination({ dest: logPath, sync: true });
  const logger = pino(
    {
      level: "trace",
      hooks: {
        logMethod(args, method) {
          // Capture structured logs for ordering assertions.
          const first = args[0];
          const second = args[1];
          let msg = "";
          let raw: Record<string, unknown> = {};
          if (typeof first === "string") {
            msg = first;
          } else if (first && typeof first === "object") {
            raw = first as Record<string, unknown>;
            msg = typeof second === "string" ? second : String(raw.msg ?? "");
          }
          logs.push({ t: nowMs() - startedAt, level: "trace", msg, raw });
          return method.apply(this, args as never);
        },
      },
    },
    destination,
  );

  const chisacodeHomeRoot = await mkdtemp(path.join(os.tmpdir(), "chisacode-first-send-home-"));
  const chisacodeHome = path.join(chisacodeHomeRoot, ".chisacode");
  await mkdir(chisacodeHome, { recursive: true });
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-first-send-static-"));
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-first-send-cwd-"));
  await writeFile(path.join(workspaceDir, "README.md"), "# first-send verify\n", "utf8");

  let client: DaemonClient | null = null;
  let daemon: Awaited<ReturnType<typeof createChisaCodeDaemon>> | null = null;

  try {
    daemon = await createChisaCodeDaemon(
      {
        listen: "127.0.0.1:0",
        chisacodeHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: false,
        staticDir,
        mcpDebug: false,
        // Use real provider clients so codex spawn is exercised.
        agentClients: {},
        agentStoragePath: path.join(chisacodeHome, "agents"),
        relayEnabled: false,
        relayEndpoint: "relay.chisacode.sh:443",
        appBaseUrl: "https://app.chisacode.sh",
      },
      logger,
    );
    await daemon.start();
    const target = daemon.getListenTarget();
    if (!target || target.type !== "tcp") {
      throw new Error("Daemon did not bind a TCP port");
    }

    client = new DaemonClient({
      url: `ws://127.0.0.1:${target.port}/ws`,
      appVersion: "0.1.70",
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "first-send-verify" } });

    // Warm provider snapshot so normalizeConfig can reuse cached models.
    await waitForCodexReady(client, workspaceDir, logger);

    // Create agent without initial prompt so first send is the critical path.
    const agent = await client.createAgent({
      provider: "codex",
      cwd: workspaceDir,
      // omit model intentionally to force normalizeConfig default resolution
    });
    logger.info({ agentId: agent.id, status: agent.status }, "verify.agent.created");

    // Clear spawn markers that may have happened during create/preload/warm-up.
    const spawnBeforeSend = logs.filter(isCodexSpawn).length;
    logger.info({ spawnBeforeSend }, "verify.spawn.count.before_send");

    const sendStartedAt = nowMs() - startedAt;
    const sendResult = await client.sendAgentMessage(agent.id, "ping from first-send verify");
    const sendAcceptedAt = nowMs() - startedAt;
    logger.info(
      {
        agentId: agent.id,
        pendingRun: sendResult?.pendingRun,
        sendStartedAt,
        sendAcceptedAt,
      },
      "verify.send.accepted",
    );

    // Allow deferred connect/spawn to happen after acceptance.
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const spawnEntries = logs.filter(isCodexSpawn);
    const firstAccepted = logs.find((entry) => entry.msg === "verify.send.accepted");
    const firstSpawnAfterSend = spawnEntries.find((entry) => entry.t >= sendStartedAt);
    const listModelsSpawnAfterSend = spawnEntries.filter(
      (entry) => entry.t >= sendStartedAt && isListModelsSpawnCandidate(entry),
    );

    const report = {
      logPath,
      agentId: agent.id,
      pendingRun: sendResult?.pendingRun ?? null,
      sendStartedAt,
      sendAcceptedAt,
      firstAcceptedAt: firstAccepted?.t ?? null,
      firstSpawnAfterSendAt: firstSpawnAfterSend?.t ?? null,
      acceptedBeforeSpawn:
        firstAccepted != null &&
        (firstSpawnAfterSend == null || firstAccepted.t <= firstSpawnAfterSend.t),
      listModelsSpawnAfterSendCount: listModelsSpawnAfterSend.length,
      spawnAfterSendCount: spawnEntries.filter((entry) => entry.t >= sendStartedAt).length,
      spawnMessagesAfterSend: spawnEntries
        .filter((entry) => entry.t >= sendStartedAt)
        .map((entry) => ({
          t: Math.round(entry.t),
          agentId: entry.raw.agentId ?? null,
          goalsEnabled: entry.raw.goalsEnabled ?? null,
        })),
    };

    console.log(JSON.stringify(report, null, 2));
    await writeFile(
      path.join(chisacodeHomeRoot, "first-send-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    if (!report.acceptedBeforeSpawn) {
      throw new Error(
        `FAIL: accepted was not before codex spawn (accepted=${report.firstAcceptedAt}, spawn=${report.firstSpawnAfterSendAt})`,
      );
    }
    if (report.listModelsSpawnAfterSendCount > 0) {
      throw new Error(
        `FAIL: observed ${report.listModelsSpawnAfterSendCount} listModels-style codex spawn(s) after send`,
      );
    }
    if (report.pendingRun !== true) {
      throw new Error(`FAIL: expected pendingRun=true, got ${String(report.pendingRun)}`);
    }

    console.log(
      "PASS: accepted before codex spawn; no post-send listModels spawn; pendingRun=true",
    );
  } finally {
    await client?.close().catch(() => undefined);
    await daemon?.stop().catch(() => undefined);
    await rm(chisacodeHomeRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(staticDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
