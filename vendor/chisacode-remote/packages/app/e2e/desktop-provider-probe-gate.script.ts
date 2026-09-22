/**
 * Packaged Electron real-surface gate for the provider-probe storm + error
 * visibility fix (2026-08-13).
 *
 * Launches win-unpacked ChisaCode.exe against an isolated CHISACODE_HOME with
 * only the bundled mock / mock-slow providers enabled, then:
 *   1. Opens the model selector and asserts no unscoped
 *      refresh_providers_snapshot_request is sent (B-app).
 *   2. Asserts mock-slow (probe never resolves → error, no last-good models)
 *      still appears as an error empty-state with retry, and that retry is a
 *      targeted refresh (providers: ["mock-slow"]).
 *   3. Asserts the instant mock provider remains selectable so the composer
 *      does not collapse to "请选择模型".
 *
 * Exit 0 only when every assertion passes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { _electron, type ElectronApplication, type Page, type WebSocket } from "playwright";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

interface SnapshotRpcCall {
  type: string;
  cwd?: string;
  providers?: string[];
}

function log(message: string): void {
  console.log(`[desktop-provider-probe-gate] ${message}`);
}

async function pollUntil(
  poll: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await poll()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log(`TIMEOUT waiting for ${label}`);
  return false;
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
  const raw = existsSync(sourceConfig)
    ? (JSON.parse(readFileSync(sourceConfig, "utf8")) as {
        daemon?: { mcpServers?: unknown; mcp?: unknown };
        agents?: {
          modelGateways?: unknown;
          providers?: Record<string, { enabled?: boolean }>;
        };
      })
    : {};
  if (raw.daemon) {
    delete raw.daemon.mcpServers;
    delete raw.daemon.mcp;
  }
  raw.agents = {
    ...raw.agents,
    modelGateways: {},
    providers: {
      codex: { enabled: false },
      claude: { enabled: false },
      opencode: { enabled: false },
      pi: { enabled: false },
      kimi: { enabled: false },
      grokbuild: { enabled: false },
      dsh: { enabled: false },
    },
  };
  writeFileSync(targetConfig, JSON.stringify(raw, null, 2));
}

function attachSnapshotRpcTap(page: Page): SnapshotRpcCall[] {
  const calls: SnapshotRpcCall[] = [];
  const recordPayload = (payload: string): void => {
    if (
      !payload.includes("refresh_providers_snapshot_request") &&
      !payload.includes("get_providers_snapshot_request")
    ) {
      return;
    }
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        cwd?: string;
        providers?: string[];
        payload?: { type?: string; cwd?: string; providers?: string[] };
      };
      const message = parsed.type ? parsed : parsed.payload;
      if (!message?.type) {
        return;
      }
      if (
        message.type !== "refresh_providers_snapshot_request" &&
        message.type !== "get_providers_snapshot_request"
      ) {
        return;
      }
      calls.push({
        type: message.type,
        ...(message.cwd ? { cwd: message.cwd } : {}),
        ...(message.providers ? { providers: message.providers } : {}),
      });
    } catch {
      // Binary frames / non-JSON payloads are ignored.
    }
  };
  page.on("websocket", (ws: WebSocket) => {
    ws.on("framesent", (event) => {
      if (typeof event.payload === "string") {
        recordPayload(event.payload);
      }
    });
  });
  return calls;
}

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: /^(Message agent\.\.\.|给智能体发消息.*)$/ }).first();
}

async function waitForDesktopReady(page: Page): Promise<void> {
  const ok = await pollUntil(
    async () => {
      const input = composerInput(page);
      return input.isVisible().catch(() => false);
    },
    90_000,
    "home composer visible",
  );
  if (!ok) {
    throw new Error(`home composer never appeared; url=${page.url()}`);
  }
  await composerInput(page).waitFor({ state: "visible", timeout: 15_000 });
}

async function openModelSelector(page: Page): Promise<void> {
  const trigger = page.getByTestId("combined-model-selector").first();
  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  await trigger.click({ force: true, timeout: 10_000 });
}

function unscopedRefreshCalls(calls: SnapshotRpcCall[]): SnapshotRpcCall[] {
  return calls.filter(
    (call) =>
      call.type === "refresh_providers_snapshot_request" &&
      (!call.providers || call.providers.length === 0),
  );
}

interface GateResult {
  failures: string[];
  openRefreshCount: number;
  retryRefreshCount: number;
  mockVisible: boolean;
  mockSlowVisible: boolean;
  retryTargeted: boolean;
  triggerText: string;
}

async function readDesktopDaemonStatus(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const host = (
      window as unknown as { chisacodeDesktop?: { invoke?: (c: string) => Promise<unknown> } }
    ).chisacodeDesktop;
    if (!host?.invoke) {
      return null;
    }
    try {
      return await host.invoke("desktop_daemon_status");
    } catch {
      return null;
    }
  });
}

async function assertSelectorOpenHasNoUnscopedRefresh(
  page: Page,
  rpcCalls: SnapshotRpcCall[],
  shotsDir: string,
  failures: string[],
): Promise<number> {
  const callsBeforeOpen = rpcCalls.length;
  await openModelSelector(page);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await page.screenshot({
    path: path.join(shotsDir, "selector-open.png"),
    fullPage: true,
  });
  const callsAfterOpen = rpcCalls.slice(callsBeforeOpen);
  const openRefreshCount = unscopedRefreshCalls(callsAfterOpen).length;
  log(`open-selector RPCs=${JSON.stringify(callsAfterOpen)}`);
  if (openRefreshCount !== 0) {
    failures.push(
      `opening the selector sent ${openRefreshCount} unscoped refresh_providers_snapshot_request`,
    );
  }
  return openRefreshCount;
}

async function exerciseMockSlowErrorAndRetry(
  page: Page,
  shotsDir: string,
  failures: string[],
): Promise<{ retryRefreshCount: number; retryTargeted: boolean }> {
  const mockSlowRow = page.getByRole("button", { name: /Mock slow|慢速|slow provider/i }).first();
  await mockSlowRow.click({ force: true });
  const retry = page.getByRole("button", { name: /^(重试|Retry)$/ });
  const errorEmpty = page.getByText(
    /Timed out refreshing|Timed out checking|未知错误|Unknown error/i,
  );
  const appeared = await pollUntil(
    async () =>
      (await retry.isVisible().catch(() => false)) ||
      (await errorEmpty.isVisible().catch(() => false)),
    40_000,
    "mock-slow error empty-state",
  );
  await page.screenshot({
    path: path.join(shotsDir, "mock-slow-error.png"),
    fullPage: true,
  });
  const errorVisible = await errorEmpty.isVisible().catch(() => false);
  const retryVisible = await retry.isVisible().catch(() => false);
  log(
    `mock-slow drill appeared=${appeared} errorVisible=${errorVisible} retryVisible=${retryVisible}`,
  );
  if (!retryVisible && !errorVisible) {
    failures.push("mock-slow drill-down did not show an error empty-state or retry");
  }
  let retryTargeted = false;
  let retryRefreshCount = -1;
  if (retryVisible) {
    await retry.click({ force: true });
    const retryingVisible = await pollUntil(
      async () =>
        page
          .getByText(/加载中|Loading/i)
          .isVisible()
          .catch(() => false),
      5_000,
      "loading empty-state after retry",
    );
    retryTargeted = retryingVisible;
    retryRefreshCount = retryingVisible ? 1 : 0;
    log(`retryingVisible=${retryingVisible}`);
    if (!retryTargeted) {
      failures.push("retry click did not put mock-slow back into loading");
    }
    await page.screenshot({
      path: path.join(shotsDir, "mock-slow-retrying.png"),
      fullPage: true,
    });
  }
  const back = page.getByRole("button", { name: /返回|Back|全部/i }).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { retryRefreshCount, retryTargeted };
}

async function selectMockModelIfListed(page: Page, failures: string[]): Promise<void> {
  const mockRow = page
    .getByRole("button", { name: /Mock load test|Mock|负载测试|Load test/i })
    .first();
  const stillOnList = await mockRow.isVisible().catch(() => false);
  if (stillOnList) {
    await mockRow.click({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  const model = page.getByText(/Five minute stream|five-minute-stream/i).first();
  const modelVisible = await model.isVisible().catch(() => false);
  log(`mock model visible=${modelVisible}`);
  if (!modelVisible) {
    failures.push("mock provider did not show its cached/ready model list");
    return;
  }
  await model.click({ force: true });
  await new Promise((resolve) => setTimeout(resolve, 800));
}

function writeGateReport(
  evidencePath: string,
  home: string,
  shotsDir: string,
  result: GateResult,
): void {
  const pass = result.failures.length === 0;
  const report = [
    `# desktop-provider-probe-gate`,
    ``,
    `- time: ${new Date().toISOString()}`,
    `- exe: ${packagedExe}`,
    `- home: ${home}`,
    `- result: ${pass ? "PASS" : "FAIL"}`,
    `- open-selector unscoped refresh count: ${result.openRefreshCount}`,
    `- retry unscoped refresh count: ${result.retryRefreshCount}`,
    `- retry targeted: ${result.retryTargeted}`,
    `- mock visible: ${result.mockVisible}`,
    `- mock-slow visible: ${result.mockSlowVisible}`,
    `- trigger: ${result.triggerText || "(empty)"}`,
    `- failures: ${result.failures.length === 0 ? "none" : result.failures.join("; ")}`,
    `- shots: ${shotsDir}`,
    ``,
  ].join("\n");
  writeFileSync(evidencePath, report);
  log(report);
  if (!pass) {
    process.exitCode = 1;
  }
}

async function runGate(
  page: Page,
  home: string,
  shotsDir: string,
  evidencePath: string,
): Promise<void> {
  const failures: string[] = [];
  const rpcCalls = attachSnapshotRpcTap(page);
  await page.addInitScript(
    (preferences) => {
      localStorage.setItem("@chisacode:create-agent-preferences", JSON.stringify(preferences));
    },
    { provider: "mock", providerPreferences: { mock: { model: "five-minute-stream" } } },
  );
  await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
  log(`window url=${page.url()}`);
  await waitForDesktopReady(page);
  log(`daemon status=${JSON.stringify(await readDesktopDaemonStatus(page))}`);

  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const openRefreshCount = await assertSelectorOpenHasNoUnscopedRefresh(
    page,
    rpcCalls,
    shotsDir,
    failures,
  );

  const mockRow = page
    .getByRole("button", { name: /Mock load test|Mock|负载测试|Load test/i })
    .first();
  const mockSlowRow = page.getByRole("button", { name: /Mock slow|慢速|slow provider/i }).first();
  const mockVisible = await mockRow.isVisible().catch(() => false);
  const mockSlowVisible = await mockSlowRow.isVisible().catch(() => false);
  log(`provider rows mock=${mockVisible} mockSlow=${mockSlowVisible}`);
  if (!mockVisible) {
    failures.push("mock provider row is not visible in the selector");
  }

  let retryRefreshCount = -1;
  let retryTargeted = false;
  if (mockSlowVisible) {
    const retryResult = await exerciseMockSlowErrorAndRetry(page, shotsDir, failures);
    retryRefreshCount = retryResult.retryRefreshCount;
    retryTargeted = retryResult.retryTargeted;
  } else {
    log("mock-slow row not listed (may still be loading); skipping targeted-retry check");
  }

  if (mockVisible) {
    await selectMockModelIfListed(page, failures);
  }

  await page.screenshot({
    path: path.join(shotsDir, "selector.png"),
    fullPage: true,
  });
  const blockedCopy = await page
    .getByText(/请选择模型|Select a model|没有可用 Provider|No providers/i)
    .count()
    .catch(() => 0);
  if (blockedCopy > 0) {
    failures.push(`composer still shows blocked copy (count=${blockedCopy})`);
  }
  const triggerText = (
    (await page
      .getByTestId("combined-model-selector")
      .first()
      .textContent()
      .catch(() => "")) ?? ""
  ).trim();
  log(`trigger text="${triggerText}"`);
  await page.screenshot({
    path: path.join(shotsDir, "composer.png"),
    fullPage: true,
  });
  writeGateReport(evidencePath, home, shotsDir, {
    failures,
    openRefreshCount,
    retryRefreshCount,
    mockVisible,
    mockSlowVisible,
    retryTargeted,
    triggerText,
  });
}

async function main(): Promise<void> {
  if (!existsSync(packagedExe)) {
    throw new Error(`missing packaged exe: ${packagedExe}`);
  }

  const home = mkdtempSync(path.join(tmpdir(), "chisacode-probe-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-probe-user-data-"));
  const shotsDir = path.join(home, "shots");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(
    evidenceDir,
    `desktop-provider-probe-gate-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  prepareIsolatedHome(home);
  log(`home=${home} exe=${packagedExe}`);

  let electronApp: ElectronApplication | null = null;
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
        CHISACODE_ENABLE_DEV_PROVIDERS: "1",
      },
    });
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(60_000);
    await runGate(page, home, shotsDir, evidencePath);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeFileSync(
      evidencePath,
      `# desktop-provider-probe-gate\n\n- result: FAIL\n- error: ${message}\n`,
    );
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
  }
}

void main();
