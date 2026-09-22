/**
 * Packaged Electron real-surface verification for:
 * 1) optimistic left-sidebar session row on first send
 * 2) Grok Build app-gateway face (`grok-4-5-grokbuild`) must not fall through to native xAI key errors
 *
 * Strategy:
 * - Launch win-unpacked ChisaCode.exe with isolated CHISACODE_HOME (user gateway config copied, keys not printed)
 * - Use daemon API for deterministic create path (runtimeProvider + model)
 * - Use Playwright `_electron` for Soft Home first-send UI path (sidebar optimistic)
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { expect } from "@playwright/test";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";
import { buildHostNewWorkspaceRoute, buildHostWorkspaceRoute } from "../src/utils/host-routes";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

interface GateResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  ms?: number;
}

function log(message: string): void {
  console.log(`[desktop-first-send-gateway] ${message}`);
}

async function pollUntil(
  poll: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await poll()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function ensurePortFree(port: number): Promise<void> {
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (!occupied) {
    return;
  }
  log(`port ${port} occupied; stopping ChisaCode + daemon workers only`);
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      [
        "Get-Process ChisaCode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*daemon-worker*' -or $_.CommandLine -like '*node-entrypoint-runner*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        "Start-Sleep -Seconds 2",
      ].join("; "),
    ],
    { stdio: "ignore" },
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

function prepareIsolatedHome(home: string): {
  gatewayId: string | null;
  modelId: string | null;
  chatBaseHost: string | null;
  keyLength: number;
} {
  mkdirSync(home, { recursive: true });
  const sourceHome = path.join(homedir(), ".chisacode");
  const sourceConfig = path.join(sourceHome, "config.json");
  const targetConfig = path.join(home, "config.json");
  if (!existsSync(sourceConfig)) {
    writeFileSync(targetConfig, "{}\n");
    return { gatewayId: null, modelId: null, chatBaseHost: null, keyLength: 0 };
  }
  const raw = JSON.parse(readFileSync(sourceConfig, "utf8")) as {
    agents?: {
      modelGateways?: Record<
        string,
        {
          enabled?: boolean;
          models?: Array<{ id?: string }>;
          upstreams?: {
            chatCompletions?: { baseUrl?: string; apiKey?: string };
          };
        }
      >;
    };
  };
  writeFileSync(targetConfig, JSON.stringify(raw, null, 2));
  const gateways = raw.agents?.modelGateways ?? {};
  const gatewayId =
    Object.keys(gateways).find((id) => id.includes("grok") && gateways[id]?.enabled !== false) ??
    null;
  if (!gatewayId) {
    return { gatewayId: null, modelId: null, chatBaseHost: null, keyLength: 0 };
  }
  const gateway = gateways[gatewayId];
  const modelId = gateway?.models?.[0]?.id ?? null;
  const chat = gateway?.upstreams?.chatCompletions;
  const keyLength = chat?.apiKey?.length ?? 0;
  let chatBaseHost: string | null = null;
  try {
    chatBaseHost = chat?.baseUrl ? new URL(chat.baseUrl).host : null;
  } catch {
    chatBaseHost = chat?.baseUrl ?? null;
  }
  return { gatewayId, modelId, chatBaseHost, keyLength };
}

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: /^(Message agent\.\.\.|给智能体发消息.*)$/ }).first();
}

function walkJsonFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(full, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      acc.push(full);
    }
  }
  return acc;
}

// eslint-disable-next-line complexity
function summarizeDaemon(home: string): {
  createProviders: string[];
  turnFailed: string[];
  persistedRuntimeProviders: string[];
  managedConfigs: Array<{ dir: string; hasEndpoints: boolean; path: string }>;
  gatewayManagedHasEndpoints: boolean | null;
  gatewayManagedPath: string | null;
} {
  const logPath = path.join(home, "daemon.log");
  const createProviders: string[] = [];
  const turnFailed: string[] = [];
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      if (line.includes("Creating agent") || line.includes("Created agent")) {
        try {
          const parsed = JSON.parse(line) as { provider?: string; msg?: string };
          // eslint-disable-next-line max-depth
          if (parsed.provider) {
            createProviders.push(`${parsed.msg ?? "agent"} :: ${parsed.provider}`);
          }
        } catch {
          // ignore
        }
      }
      if (line.includes("turn_failed") || /console\.x\.ai|Incorrect API key/i.test(line)) {
        try {
          const parsed = JSON.parse(line) as {
            provider?: string;
            diagnostic?: string;
            msg?: string;
          };
          turnFailed.push(
            `${parsed.provider ?? "?"} :: ${(parsed.diagnostic ?? parsed.msg ?? "").slice(0, 240)}`,
          );
        } catch {
          turnFailed.push(line.slice(0, 240));
        }
      }
    }
  }

  const persistedRuntimeProviders: string[] = [];
  for (const file of walkJsonFiles(path.join(home, "agents"))) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        provider?: string;
        config?: { runtimeProvider?: string; provider?: string; model?: string };
        model?: string;
      };
      const runtime =
        parsed.config?.runtimeProvider ?? parsed.config?.provider ?? parsed.provider ?? "unknown";
      const model = parsed.config?.model ?? parsed.model ?? "";
      persistedRuntimeProviders.push(`${path.basename(file)} :: ${runtime} model=${model}`);
    } catch {
      // ignore
    }
  }

  const runtimeRoot = path.join(home, "provider-runtime", "grokbuild");
  const managedConfigs: Array<{ dir: string; hasEndpoints: boolean; path: string }> = [];
  if (existsSync(runtimeRoot)) {
    for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(runtimeRoot, entry.name, "config.toml");
      if (!existsSync(configPath)) continue;
      const toml = readFileSync(configPath, "utf8");
      managedConfigs.push({
        dir: entry.name,
        path: configPath,
        hasEndpoints: toml.includes("[endpoints]") && toml.includes("models_base_url"),
      });
    }
  }
  const gatewayManaged =
    managedConfigs.find((entry) => entry.dir.includes("grok-4-5-grokbuild")) ??
    managedConfigs.find(
      (entry) => entry.dir.includes("grokbuild") && entry.dir.includes("grok-4"),
    ) ??
    null;

  return {
    createProviders,
    turnFailed,
    persistedRuntimeProviders,
    managedConfigs,
    gatewayManagedHasEndpoints: gatewayManaged ? gatewayManaged.hasEndpoints : null,
    gatewayManagedPath: gatewayManaged?.path ?? null,
  };
}

// eslint-disable-next-line complexity
async function main(): Promise<void> {
  if (!existsSync(packagedExe)) {
    throw new Error(`missing packaged exe: ${packagedExe}`);
  }

  const home = mkdtempSync(path.join(tmpdir(), "chisacode-verify-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-verify-user-data-"));
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(
    evidenceDir,
    `desktop-first-send-gateway-verify-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  const gatewayMeta = prepareIsolatedHome(home);
  const promptText = `侧栏即时验证 ${Date.now()}`;
  const gates: GateResult[] = [];

  log(
    `home=${home} gateway=${gatewayMeta.gatewayId} model=${gatewayMeta.modelId} host=${gatewayMeta.chatBaseHost} keyLen=${gatewayMeta.keyLength}`,
  );

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let seedClient: {
    close(): Promise<void>;
    openProject(cwd: string): Promise<{
      workspace: { id: string; workspaceDirectory: string } | null;
      error: string | null;
    }>;
    createAgent(options: Record<string, unknown>): Promise<{ id: string; provider: string }>;
  } | null = null;
  let repoCleanup: (() => Promise<void>) | null = null;
  let serverId = "local";

  try {
    await ensurePortFree(6767);
    electronApp = await _electron.launch({
      executablePath: packagedExe,
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_ELECTRON_USER_DATA_DIR: userData,
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_RELAY_ENABLED: "0",
      },
    });
    page = await electronApp.firstWindow();
    page.setDefaultTimeout(45_000);
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
    log(`window url=${page.url()}`);

    const statusHolder: {
      value: { status?: string; listen?: string; pid?: number; serverId?: string } | null;
    } = { value: null };
    await pollUntil(
      async () => {
        const status = await page!.evaluate(async () => {
          const host = (
            window as unknown as {
              chisacodeDesktop?: { invoke?: (c: string) => Promise<unknown> };
            }
          ).chisacodeDesktop;
          if (!host?.invoke) return null;
          try {
            return (await host.invoke("desktop_daemon_status")) as {
              status?: string;
              listen?: string;
              pid?: number;
              serverId?: string;
            };
          } catch {
            return null;
          }
        });
        statusHolder.value = status;
        return Boolean(status?.listen || status?.status === "running");
      },
      90_000,
      "desktop daemon online",
    );
    const daemonStatus = statusHolder.value;
    if (!daemonStatus?.listen) {
      throw new Error(`daemon status missing listen: ${JSON.stringify(daemonStatus)}`);
    }
    serverId = daemonStatus.serverId || "local";
    log(`daemon online listen=${daemonStatus.listen} serverId=${serverId}`);

    const repo = await createTempGitRepo("verify-first-send-");
    repoCleanup = repo.cleanup;

    const DaemonClient = (
      await import(pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href)
    ).DaemonClient as new (config: {
      url: string;
      clientId: string;
      clientType: string;
      appVersion: string;
      webSocketFactory: unknown;
    }) => {
      connect(): Promise<void>;
      close(): Promise<void>;
      openProject(cwd: string): Promise<{
        workspace: { id: string; workspaceDirectory: string } | null;
        error: string | null;
      }>;
      createAgent(options: Record<string, unknown>): Promise<{ id: string; provider: string }>;
    };

    const client = new DaemonClient({
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `verify-seed-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.2",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await client.connect();
    seedClient = client;

    const opened = await client.openProject(repo.path);
    if (!opened.workspace) {
      throw new Error(opened.error ?? "openProject failed");
    }
    log(`opened project workspace=${opened.workspace.id}`);

    // -------- Gate group 1: Soft Home first-send optimistic sidebar --------
    const softHomeRoute = buildHostNewWorkspaceRoute(serverId, repo.path);
    await page.goto(`chisacode://app${softHomeRoute}`, { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("workspace-main-panel")
      .or(composerInput(page))
      .first()
      .waitFor({ state: "visible", timeout: 120_000 })
      .catch(() => undefined);
    await expect(composerInput(page)).toBeEditable({ timeout: 120_000 });
    log("soft-home composer ready");

    // Prefer selecting the gateway model in UI if possible; continue even if selector UX differs.
    try {
      const modelId = gatewayMeta.modelId ?? "grok-4.5";
      const chip = page.locator("text=/grok-4\\.5|grok 4\\.5|Grok/i").first();
      if ((await chip.count()) > 0) {
        await chip.click({ timeout: 10_000 });
        const grokBuild = page.getByText(/Grok Build|GrokBuild/i).first();
        if ((await grokBuild.count()) > 0) {
          await grokBuild.click({ timeout: 5_000 }).catch(() => undefined);
        }
        const rows = page.locator(`text=${modelId}`);
        const count = await rows.count();
        if (count > 0) {
          await rows.nth(count - 1).click({ timeout: 10_000 });
        }
      }
      gates.push({
        name: "ui-model-select-attempt",
        status: "pass",
        detail: "attempted gateway model selection in Soft Home composer",
      });
    } catch (error) {
      gates.push({
        name: "ui-model-select-attempt",
        status: "skip",
        detail: `selector interaction inconclusive: ${String(error).slice(0, 180)}`,
      });
    }

    const sidebarBefore = await page.getByText(promptText).count();
    const sendStarted = Date.now();
    await composerInput(page).fill(promptText);
    await composerInput(page).press("Enter");

    try {
      let appearedMs = 0;
      await pollUntil(
        async () => {
          const byRole = page!.getByRole("button", {
            name: new RegExp(promptText.slice(0, Math.min(18, promptText.length))),
          });
          const byText = page!.getByText(promptText);
          const count = (await byRole.count()) + (await byText.count());
          if (count > sidebarBefore) {
            appearedMs = Date.now() - sendStarted;
            return true;
          }
          return false;
        },
        5_000,
        "sidebar optimistic row within 5s",
      );
      gates.push({
        name: "sidebar-optimistic-within-5s",
        status: "pass",
        detail: `sidebar reflected first-send title after ${appearedMs}ms`,
        ms: appearedMs,
      });
    } catch (error) {
      gates.push({
        name: "sidebar-optimistic-within-5s",
        status: "fail",
        detail: String(error),
        ms: Date.now() - sendStarted,
      });
    }

    // Let create progress for log evidence (do not treat full create speed as this gate).
    await new Promise((resolve) => setTimeout(resolve, 8_000));

    // -------- Gate group 2: deterministic gateway-face create via daemon API --------
    if (gatewayMeta.gatewayId && gatewayMeta.modelId) {
      const runtimeProvider = `${gatewayMeta.gatewayId}-grokbuild`;
      const apiPrompt = `gateway face verify ${Date.now()}`;
      const apiStarted = Date.now();
      try {
        const agent = await client.createAgent({
          provider: "grokbuild",
          runtimeProvider,
          cwd: repo.path,
          model: gatewayMeta.modelId,
          initialPrompt: apiPrompt,
          title: apiPrompt,
        });
        const apiMs = Date.now() - apiStarted;
        gates.push({
          name: "daemon-create-gateway-face",
          status: "pass",
          detail: `created agent ${agent.id} provider=${agent.provider} runtimeRequested=${runtimeProvider}`,
          ms: apiMs,
        });

        // Open the agent route so UI shows it and runtime turn can proceed.
        const route = `${buildHostWorkspaceRoute(serverId, repo.path)}?open=${encodeURIComponent(
          `agent:${agent.id}`,
        )}`;
        await page.goto(`chisacode://app${route}`, { waitUntil: "domcontentloaded" });
        await page
          .getByTestId("workspace-main-panel")
          .waitFor({ state: "visible", timeout: 120_000 })
          .catch(() => undefined);

        // Wait for either assistant progress, error, or timeout window.
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      } catch (error) {
        gates.push({
          name: "daemon-create-gateway-face",
          status: "fail",
          detail: String(error).slice(0, 400),
          ms: Date.now() - apiStarted,
        });
      }
    } else {
      gates.push({
        name: "daemon-create-gateway-face",
        status: "skip",
        detail: "no enabled grok gateway/model in config",
      });
    }

    const shotDir = path.join(home, "shots");
    mkdirSync(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, "after-verify.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);

    const summary = summarizeDaemon(home);
    log(`createProviders=${JSON.stringify(summary.createProviders)}`);
    log(`persistedRuntime=${JSON.stringify(summary.persistedRuntimeProviders)}`);
    log(`turnFailed=${JSON.stringify(summary.turnFailed)}`);
    log(
      `gateway managed endpoints=${summary.gatewayManagedHasEndpoints} path=${summary.gatewayManagedPath}`,
    );

    // Daemon create logs only print base agent provider (`grokbuild`), not runtimeProvider.
    // Source of truth is persisted agent config.runtimeProvider + managed GROK_HOME.
    const usedGatewayFace = summary.persistedRuntimeProviders.some(
      (entry) =>
        entry.includes("grok-4-5-grokbuild") ||
        (gatewayMeta.gatewayId ? entry.includes(`${gatewayMeta.gatewayId}-grokbuild`) : false),
    );
    const usedNativeOnly =
      summary.persistedRuntimeProviders.some((entry) => /:: grokbuild model=/.test(entry)) &&
      !usedGatewayFace;

    if (!gatewayMeta.gatewayId) {
      gates.push({
        name: "runtime-provider-gateway-face",
        status: "skip",
        detail: "no gateway configured",
      });
    } else if (usedGatewayFace) {
      gates.push({
        name: "runtime-provider-gateway-face",
        status: "pass",
        detail: summary.persistedRuntimeProviders.join(" | "),
      });
    } else {
      gates.push({
        name: "runtime-provider-gateway-face",
        status: "fail",
        detail:
          summary.persistedRuntimeProviders.length > 0
            ? summary.persistedRuntimeProviders.join(" | ")
            : "no persisted agent runtimeProvider found",
      });
    }

    if (summary.gatewayManagedHasEndpoints === true) {
      gates.push({
        name: "managed-grok-config-endpoints",
        status: "pass",
        detail: summary.gatewayManagedPath ?? "endpoints present",
      });
    } else if (summary.gatewayManagedHasEndpoints === false) {
      gates.push({
        name: "managed-grok-config-endpoints",
        status: "fail",
        detail: `missing endpoints: ${summary.gatewayManagedPath}`,
      });
    } else {
      gates.push({
        name: "managed-grok-config-endpoints",
        status: usedGatewayFace ? "fail" : "skip",
        detail: "no grok-4-5-grokbuild managed home written",
      });
    }

    const xaiKeyError = summary.turnFailed.some((line) =>
      /console\.x\.ai|Incorrect API key/i.test(line),
    );
    if (xaiKeyError) {
      gates.push({
        name: "no-xai-key-error-on-gateway-face",
        status: "fail",
        detail: `${usedNativeOnly ? "native path " : ""}${summary.turnFailed.join(" | ")}`,
      });
    } else {
      gates.push({
        name: "no-xai-key-error-on-gateway-face",
        status: "pass",
        detail:
          summary.turnFailed.length > 0
            ? `other failures (not xAI key): ${summary.turnFailed.join(" | ")}`
            : "no console.x.ai Incorrect API key observed",
      });
    }

    const uiErrorVisible =
      (await page
        .getByText(/Incorrect API key|console\.x\.ai|智能体运行失败|Internal error/i)
        .count()) > 0;
    gates.push({
      name: "ui-error-banner-observation",
      status: uiErrorVisible ? "fail" : "pass",
      detail: uiErrorVisible
        ? "error/failure text visible in UI"
        : "no xAI/internal error banner visible at capture time",
    });

    const passCount = gates.filter((gate) => gate.status === "pass").length;
    const failCount = gates.filter((gate) => gate.status === "fail").length;
    const skipCount = gates.filter((gate) => gate.status === "skip").length;
    const body = [
      "# Desktop first-send + gateway real-surface verification",
      "",
      `- time: ${new Date().toISOString()}`,
      `- exe: ${packagedExe}`,
      `- CHISACODE_HOME: ${home}`,
      `- serverId: ${serverId}`,
      `- gatewayId: ${gatewayMeta.gatewayId}`,
      `- modelId: ${gatewayMeta.modelId}`,
      `- chatBaseHost: ${gatewayMeta.chatBaseHost}`,
      `- keyLength: ${gatewayMeta.keyLength}`,
      `- prompt: ${promptText}`,
      `- screenshot: ${shotPath}`,
      "",
      "## Gates",
      ...gates.map(
        (gate) =>
          `- ${gate.status.toUpperCase()} ${gate.name}${gate.ms != null ? ` (${gate.ms}ms)` : ""}: ${gate.detail}`,
      ),
      "",
      `## Summary: pass=${passCount} fail=${failCount} skip=${skipCount}`,
      "",
      "## Daemon create providers (base provider log only)",
      ...(summary.createProviders.length
        ? summary.createProviders.map((line) => `- ${line}`)
        : ["- none"]),
      "",
      "## Persisted runtimeProvider",
      ...(summary.persistedRuntimeProviders.length
        ? summary.persistedRuntimeProviders.map((line) => `- ${line}`)
        : ["- none"]),
      "",
      "## Turn failures",
      ...(summary.turnFailed.length ? summary.turnFailed.map((line) => `- ${line}`) : ["- none"]),
      "",
      `## Gateway managed config endpoints: ${String(summary.gatewayManagedHasEndpoints)}`,
      summary.gatewayManagedPath ? `- path: ${summary.gatewayManagedPath}` : "- path: n/a",
      "",
      "## All managed grok configs",
      ...(summary.managedConfigs.length
        ? summary.managedConfigs.map((entry) => `- ${entry.dir}: endpoints=${entry.hasEndpoints}`)
        : ["- none"]),
      "",
    ].join("\n");
    writeFileSync(evidencePath, body, "utf8");
    copyFileSync(evidencePath, path.join(home, "evidence.md"));
    log(`evidence: ${evidencePath}`);

    if (failCount > 0) {
      throw new Error(`real-surface verification failed: ${failCount} gate(s)`);
    }
    log("ALL HARD GATES PASSED");
  } finally {
    try {
      await seedClient?.close();
    } catch {
      // ignore
    }
    try {
      await electronApp?.close();
    } catch {
      // ignore
    }
    try {
      await repoCleanup?.();
    } catch {
      // ignore
    }
    // Keep home for postmortem.
    log(`retained home: ${home}`);
  }
}

main().catch((error) => {
  console.error("[desktop-first-send-gateway] FAILED:", error);
  process.exitCode = 1;
});
