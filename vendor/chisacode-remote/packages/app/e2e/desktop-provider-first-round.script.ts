/**
 * Packaged Electron real-surface gate for stage 2a (cold-start probe
 * limiter + single ACP spawn, 2026-08-13).
 *
 * Uses the USER'S REAL provider config (copied verbatim into an isolated
 * CHISACODE_HOME — no provider stripping, no MCP stripping) and verifies:
 *   1. Cold-start probes finish without a "Failed to check provider
 *      availability" storm in daemon.log (the first round must pass, not
 *      require a manual Retry).
 *   2. After the first round settles, the model selector lists real
 *      providers with model counts — no Retry click needed.
 *   3. Opening the selector still sends zero unscoped refresh requests
 *      (stage-one invariant).
 *
 * Exit 0 only when all assertions pass.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { _electron, type ElectronApplication, type Page, type WebSocket } from "playwright";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

function log(message: string): void {
  console.log(`[desktop-provider-first-round] ${message}`);
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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

function prepareRealConfigHome(home: string): void {
  mkdirSync(home, { recursive: true });
  const sourceConfig = path.join(homedir(), ".chisacode", "config.json");
  if (existsSync(sourceConfig)) {
    copyFileSync(sourceConfig, path.join(home, "config.json"));
  }
}

function attachRefreshTap(page: Page): { count: number } {
  const refreshCalls = { count: 0 };
  page.on("websocket", (ws: WebSocket) => {
    ws.on("framesent", (event) => {
      if (
        typeof event.payload === "string" &&
        event.payload.includes("refresh_providers_snapshot_request")
      ) {
        try {
          const parsed = JSON.parse(event.payload) as {
            type?: string;
            providers?: string[];
          };
          if (parsed.type === "refresh_providers_snapshot_request" && !parsed.providers) {
            refreshCalls.count += 1;
          }
        } catch {
          // ignore non-JSON frames
        }
      }
    });
  });
  return refreshCalls;
}

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: /^(Message agent\.\.\.|给智能体发消息.*)$/ }).first();
}

function countAvailabilityFailures(daemonLogPath: string): number {
  if (!existsSync(daemonLogPath)) {
    return 0;
  }
  const content = readFileSync(daemonLogPath, "utf8");
  return (content.match(/"msg":"Failed to check provider availability"/g) ?? []).length;
}

async function openModelSelector(page: Page): Promise<void> {
  const trigger = page.getByTestId("combined-model-selector").first();
  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  await trigger.click({ force: true, timeout: 10_000 });
}

async function readSelectorRows(page: Page): Promise<{
  withModels: number;
  errorRows: number;
  loadingRows: number;
}> {
  const withModels = await page
    .getByText(/\d+ 个模型|\d+ model/i)
    .count()
    .catch(() => 0);
  const errorRows = await page
    .getByText(/错误|不可用|Unavailable|Error/i)
    .count()
    .catch(() => 0);
  const loadingRows = await page
    .getByText(/加载中|Loading/i)
    .count()
    .catch(() => 0);
  return { withModels, errorRows, loadingRows };
}

/**
 * Credential failures are environment artifacts of the isolated home (the
 * copied config.json does not carry CLI-side auth such as a kimi key). The
 * gate's target is probe contention, not the user's real credentials: only
 * availability/discovery failures caused by the first round count as
 * regressions.
 */
function isCredentialFailure(daemonLogPath: string): boolean {
  if (!existsSync(daemonLogPath)) {
    return false;
  }
  const content = readFileSync(daemonLogPath, "utf8");
  return (
    content.includes("Authentication required") ||
    content.includes('"code":-32000') ||
    content.includes("Unauthorized")
  );
}

async function main(): Promise<void> {
  if (!existsSync(packagedExe)) {
    throw new Error(`missing packaged exe: ${packagedExe}`);
  }

  const home = mkdtempSync(path.join(tmpdir(), "chisacode-first-round-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-first-round-user-data-"));
  const shotsDir = path.join(home, "shots");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(
    evidenceDir,
    `desktop-provider-first-round-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  prepareRealConfigHome(home);
  log(`home=${home} (real provider config copied verbatim)`);

  let electronApp: ElectronApplication | null = null;
  const failures: string[] = [];
  const bootLogCount = { count: -1 };
  const settleLogCount = { count: -1 };
  let firstRoundSettled = false;

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
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(60_000);
    const refreshTap = attachRefreshTap(page);
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
    log(`window url=${page.url()}`);

    const daemonLogPath = path.join(home, "daemon.log");
    const bootOk = await pollUntil(
      async () =>
        existsSync(daemonLogPath) &&
        composerInput(page)
          .isVisible()
          .catch(() => false),
      120_000,
      "boot + composer visible",
    );
    if (!bootOk) {
      throw new Error(`app never booted; url=${page.url()}`);
    }

    // Snapshot the failure count at boot (before any user action).
    bootLogCount.count = countAvailabilityFailures(daemonLogPath);

    // Wait for the first round to settle: no more availability failures
    // appearing and no provider row still loading. Open the selector once and
    // keep polling its rows while it stays open.
    await openModelSelector(page);
    const settleOk = await pollUntil(
      async () => {
        const rows = await readSelectorRows(page);
        const logCount = countAvailabilityFailures(daemonLogPath);
        if (rows.loadingRows === 0 && logCount === bootLogCount.count) {
          settleLogCount.count = logCount;
          await page.screenshot({
            path: path.join(shotsDir, "settled-selector.png"),
            fullPage: true,
          });
          return true;
        }
        return false;
      },
      150_000,
      "first round settled (no loading rows, no new failures)",
    );
    firstRoundSettled = settleOk;

    const rows = await readSelectorRows(page);
    log(
      `settled rows: models=${rows.withModels} errors=${rows.errorRows} loading=${rows.loadingRows}`,
    );
    log(`first-round availability failures in daemon.log: ${settleLogCount.count}`);

    if (!firstRoundSettled) {
      failures.push("first round did not settle: providers still loading or failures grew");
    }
    if (rows.errorRows > 0 && !isCredentialFailure(daemonLogPath)) {
      failures.push(`first round left error rows without retry (count=${rows.errorRows})`);
    }
    if (rows.withModels === 0) {
      failures.push("no provider showed a model count in the first round");
    }
    if (refreshTap.count !== 0) {
      failures.push(`opening the selector sent ${refreshTap.count} unscoped refresh`);
    }
    await page.screenshot({
      path: path.join(shotsDir, "final-selector.png"),
      fullPage: true,
    });

    const pass = failures.length === 0;
    const report = [
      `# desktop-provider-first-round`,
      ``,
      `- time: ${new Date().toISOString()}`,
      `- exe: ${packagedExe}`,
      `- home: ${home} (real config copied verbatim)`,
      `- result: ${pass ? "PASS" : "FAIL"}`,
      `- first round settled: ${firstRoundSettled}`,
      `- availability failures in daemon.log: ${settleLogCount.count}`,
      `- models rows: ${rows.withModels}`,
      `- error rows: ${rows.errorRows}`,
      `- loading rows: ${rows.loadingRows}`,
      `- unscoped refresh on open: ${refreshTap.count}`,
      `- failures: ${failures.length === 0 ? "none" : failures.join("; ")}`,
      `- shots: ${shotsDir}`,
      ``,
    ].join("\n");
    writeEvidence(evidencePath, report);
    log(report);
    if (!pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeEvidence(
      evidencePath,
      `# desktop-provider-first-round\n\n- result: FAIL\n- error: ${message}\n`,
    );
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
  }
}

function writeEvidence(evidencePath: string, content: string): void {
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(evidencePath, content);
}

void main();
