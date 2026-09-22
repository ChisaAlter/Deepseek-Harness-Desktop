/**
 * Packaged Electron real-surface check for Chinese model-gateway error text.
 *
 *   npx tsx e2e/desktop-user-facing-error-text.script.ts
 *
 * Expects packages/desktop/release/win-unpacked/ChisaCode.exe to include the
 * rebuilt server that maps API Error 503 into:
 *   模型暂时不可用（HTTP 503）
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";
import { buildHostNewWorkspaceRoute } from "../src/utils/host-routes";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

function log(message: string): void {
  console.log(`[desktop-user-facing-error] ${message}`);
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
    await new Promise((resolve) => setTimeout(resolve, 300));
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

function prepareIsolatedHome(home: string): void {
  mkdirSync(home, { recursive: true });
  const sourceConfig = path.join(homedir(), ".chisacode", "config.json");
  const targetConfig = path.join(home, "config.json");
  if (existsSync(sourceConfig)) {
    copyFileSync(sourceConfig, targetConfig);
  } else {
    writeFileSync(targetConfig, "{}\n");
  }
}

function composerInput(page: Page) {
  return page
    .getByTestId("composer-input")
    .or(page.getByPlaceholder(/给智能体发消息|Message|消息/i))
    .first();
}

async function main(): Promise<void> {
  if (!existsSync(packagedExe)) {
    throw new Error(`missing packaged exe: ${packagedExe}`);
  }

  const home = mkdtempSync(path.join(tmpdir(), "chisacode-error-text-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-error-text-user-data-"));
  mkdirSync(evidenceDir, { recursive: true });
  prepareIsolatedHome(home);

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let seedClient: {
    close(): Promise<void>;
    openProject(cwd: string): Promise<{
      workspace: { id: string; workspaceDirectory: string } | null;
      error: string | null;
    }>;
    createAgent(options: Record<string, unknown>): Promise<{ id: string; provider: string }>;
    sendMessage(agentId: string, text: string): Promise<unknown>;
  } | null = null;
  let repoCleanup: (() => Promise<void>) | null = null;
  let observedText = "";
  let pass = false;

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
    page.setDefaultTimeout(60_000);
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
    const serverId = daemonStatus.serverId || "local";
    log(`daemon online listen=${daemonStatus.listen} serverId=${serverId}`);

    const repo = await createTempGitRepo("error-text-qa-");
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
      sendMessage(agentId: string, text: string): Promise<unknown>;
    };

    const client = new DaemonClient({
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `error-text-seed-${randomUUID()}`,
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

    const agent = await client.createAgent({
      provider: "grok-4-5-claude",
      cwd: repo.path,
      title: "desktop-error-text-qa",
      model: "grok-4.5",
      thinkingOptionId: "high",
    });
    log(`created agent ${agent.id} provider=${agent.provider}`);

    // Navigate UI to the agent route so the chat surface is real desktop renderer.
    const softHomeRoute = buildHostNewWorkspaceRoute(serverId, repo.path);
    await page.goto(`chisacode://app${softHomeRoute}`, { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("workspace-main-panel")
      .or(composerInput(page))
      .first()
      .waitFor({ state: "visible", timeout: 120_000 })
      .catch(() => undefined);

    // Deterministic send through daemon API (same surface text is rendered by desktop UI).
    await client.sendMessage(agent.id, "你好？");

    // Open the agent conversation if the soft-home route doesn't auto-select it.
    try {
      const row = page.getByText("desktop-error-text-qa").first();
      if ((await row.count()) > 0) {
        await row.click({ timeout: 10_000 }).catch(() => undefined);
      }
    } catch {
      // continue; body text may still appear via active stream subscription
    }

    await pollUntil(
      async () => {
        const bodyText = await page!.evaluate(() => document.body.innerText || "");
        observedText = bodyText;
        return (
          bodyText.includes("模型暂时不可用（HTTP 503）") ||
          bodyText.includes("API Error: 503") ||
          bodyText.includes("account protection scheduler")
        );
      },
      240_000,
      "error message visible in desktop UI",
    );

    const shotPath = path.join(
      evidenceDir,
      `desktop-user-facing-error-text-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
    );
    await page.screenshot({ path: shotPath, fullPage: true });
    log(`screenshot=${shotPath}`);

    const hasChinese = observedText.includes("模型暂时不可用（HTTP 503）");
    const hasOldEnglish =
      observedText.includes("API Error: 503") ||
      observedText.includes("account protection scheduler is temporarily unavailable");
    pass = hasChinese && !hasOldEnglish;

    const evidencePath = path.join(
      evidenceDir,
      `desktop-user-facing-error-text-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    writeFileSync(
      evidencePath,
      [
        "# Desktop user-facing error text verification",
        "",
        `- agentId: ${agent.id}`,
        `- provider: ${agent.provider}`,
        `- model: grok-4.5`,
        `- pass: ${pass}`,
        `- hasChinese: ${hasChinese}`,
        `- hasOldEnglish: ${hasOldEnglish}`,
        `- screenshot: ${shotPath}`,
        "",
        "## Observed snippet",
        "```",
        observedText
          .split(/\r?\n/)
          .filter((line) =>
            /模型暂时不可用|API Error|account protection|本地转发入口|建议|原因|你好/.test(line),
          )
          .join("\n")
          .slice(0, 2000),
        "```",
        "",
      ].join("\n"),
      "utf8",
    );
    log(`evidence=${evidencePath}`);

    if (!pass) {
      throw new Error(
        `desktop error text not rewritten: hasChinese=${hasChinese} hasOldEnglish=${hasOldEnglish}`,
      );
    }
    log("PASS desktop Chinese 503 error text verified");
  } finally {
    if (seedClient) {
      await seedClient.close().catch(() => undefined);
    }
    if (repoCleanup) {
      await repoCleanup().catch(() => undefined);
    }
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error("[desktop-user-facing-error] FAILED:", error);
  process.exit(1);
});
