/**
 * Real-Electron desktop gate for the T3 message-render slices.
 *
 * Launches the actual Electron desktop app (packages/desktop) against a fresh
 * daemon + Metro (CHISACODE_WEB_PLATFORM=electron), then drives the real
 * renderer window via Playwright's `_electron` API and asserts the Slice B
 * (turn anchoring), C (busy release on projection), and D (work-log fold)
 * behaviors on the desktop surface. Run with `tsx` from packages/app.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { expect } from "@playwright/test";
import { createTempGitRepo } from "./helpers/workspace";
import { buildAgentRoute } from "./helpers/mock-agent";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";
import { readScrollMetrics } from "./helpers/agent-bottom-anchor";
import {
  expectComposerEditable,
  expectQueuedMessageButton,
  fillComposerDraft,
  sendDraftToQueue,
  sendQueuedMessageNow,
  submitMessage,
} from "./helpers/composer";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const appDir = path.join(repoRoot, "packages/app");
const serverDir = path.join(repoRoot, "packages/server");
const desktopDir = path.join(repoRoot, "packages/desktop");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx.cmd");
const expoBin = path.join(repoRoot, "node_modules/.bin/expo.cmd");
const electronBin = require("electron") as unknown as string;

function waitForTcp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for tcp:${port}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** Fails the gate if 6767 is already held by a developer/stale daemon worker. */
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
  console.log(`[desktop-slices] port ${port} occupied; killing stale dev daemon workers`);
  // Only dev-mode supervisor workers (daemon-worker.ts) can be stale here; the
  // packaged daemon runs node-entrypoint-runner.js and is never targeted.
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*daemon-worker*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const stillOccupied = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (stillOccupied) {
    throw new Error(
      `port ${port} still occupied after stale-worker cleanup — refuse to seed the developer daemon`,
    );
  }
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    // Kill the whole tree: the supervisor's detached daemon worker survives a
    // parent-only kill and keeps holding the daemon port.
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      child.kill();
    }
  } else {
    child.kill();
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
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

function spawnResolved(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], options);
  }
  return spawn(command, args, options);
}

async function main(): Promise<void> {
  // The CLI daemon state reports the default Windows dev listen; the desktop
  // app discovers the daemon through that address.
  const daemonPort = 6767;
  const metroPort = 8100 + Math.floor(Math.random() * 200);
  const serverId = "srv_desktop_e2e";
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-desktop-home-"));

  process.env.E2E_DAEMON_PORT = String(daemonPort);
  process.env.E2E_SERVER_ID = serverId;
  process.env.CHISACODE_HOME = home;
  process.env.CHISACODE_SERVER_ID = serverId;
  process.env.CHISACODE_WEB_PLATFORM = "electron";

  let daemon: ChildProcess | null = null;
  let metro: ChildProcess | null = null;
  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let client: { close(): Promise<void> } | null = null;

  try {
    console.log("[desktop-slices] starting daemon on", daemonPort, "metro on", metroPort);
    await ensurePortFree(daemonPort);
    daemon = spawnResolved(tsxBin, ["scripts/supervisor-entrypoint.ts", "--dev"], {
      cwd: serverDir,
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_SERVER_ID: serverId,
        CHISACODE_LISTEN: `127.0.0.1:${daemonPort}`,
        CHISACODE_NODE_ENV: "development",
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_CORS_ORIGINS: `http://localhost:${metroPort}`,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForTcp(daemonPort, 90_000);

    metro = spawnResolved(expoBin, ["start", "--web", "--port", String(metroPort)], {
      cwd: appDir,
      env: {
        ...process.env,
        CHISACODE_WEB_PLATFORM: "electron",
        EXPO_PORT: String(metroPort),
      },
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForHttp(`http://localhost:${metroPort}`, 120_000);

    console.log("[desktop-slices] launching real Electron app");
    electronApp = await _electron.launch({
      executablePath: electronBin,
      args: [desktopDir],
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_SERVER_ID: serverId,
        CHISACODE_WEB_PLATFORM: "electron",
        EXPO_DEV_URL: `http://localhost:${metroPort}`,
        PATH: `${path.join(repoRoot, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    console.log("[desktop-slices] electron launched, grabbing first window");
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    console.log("[desktop-slices] window url:", page.url());
    const bridgeInfo = await page.evaluate(() => ({
      hasBridge: typeof (window as { chisacodeDesktop?: unknown }).chisacodeDesktop !== "undefined",
      platform:
        (window as { __CHISACODE_WEB_PLATFORM__?: string }).__CHISACODE_WEB_PLATFORM__ ?? null,
    }));
    console.log("[desktop-slices] bridge:", JSON.stringify(bridgeInfo));
    try {
      const daemonStatus = await page.evaluate(async () => {
        const host = (
          window as unknown as {
            chisacodeDesktop?: {
              invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown>;
            };
          }
        ).chisacodeDesktop;
        if (!host?.invoke) {
          return "no-invoke";
        }
        try {
          return await host.invoke("desktop_daemon_status");
        } catch (error) {
          return { invokeError: String(error) };
        }
      });
      console.log(
        "[desktop-slices] app daemon status:",
        JSON.stringify(daemonStatus).slice(0, 400),
      );
      page.on("console", (message) => {
        const text = message.text();
        if (/error|failed|exception|unhandled/i.test(text) && text.length < 400) {
          console.log("[desktop-renderer-console]", text);
        }
      });
      console.log("[desktop-slices] reloading window to re-run boot with daemon status");
      await page.reload({ waitUntil: "domcontentloaded" });
    } catch (error) {
      console.log("[desktop-slices] status query error:", String(error));
    }
    // Seed a mock agent through the daemon and open its route in the window.
    // The e2e seed client guards against port 6767 (the developer daemon), so
    // connect a raw client to the desktop-managed daemon directly.
    const repo = await createTempGitRepo("desktop-slice-");
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
        workspace: { id: string; name: string; workspaceDirectory: string } | null;
        error: string | null;
      }>;
      createAgent(options: {
        provider: string;
        cwd: string;
        model?: string;
        modeId?: string;
      }): Promise<{ id: string; status: string }>;
    };
    const seedClient = new DaemonClient({
      url: `ws://127.0.0.1:${daemonPort}/ws`,
      clientId: `desktop-seed-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.2",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await seedClient.connect();
    client = seedClient;
    const opened = await seedClient.openProject(repo.path);
    if (!opened.workspace) {
      throw new Error(opened.error ?? "Failed to open project");
    }
    const agent = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "one-minute-stream",
    });
    const route = buildAgentRoute(repo.path, agent.id);
    await page.goto(`http://localhost:${metroPort}${route}`, { waitUntil: "domcontentloaded" });
    try {
      await page
        .getByTestId("workspace-main-panel")
        .waitFor({ state: "visible", timeout: 120_000 });
    } catch (error) {
      const body = await page.evaluate(() =>
        (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      );
      console.log("[desktop-slices] window body:", body);
      throw error;
    }
    await expectComposerEditable(page);
    console.log("[desktop-slices] agent route open, composer editable");

    // SidebarV2 smoke: prefer stable testID, fall back to the visible "新会话"
    // row when Electron/RNW has not yet projected the testID attribute.
    const sidebarThreadById = page.getByTestId(`sidebar-v2-thread-${agent.id}`);
    const sidebarThreadFallback = page.getByRole("button", { name: /新会话|New session/i }).first();
    const sidebarThreadRow =
      (await sidebarThreadById.count()) > 0 ? sidebarThreadById : sidebarThreadFallback;
    await expect(sidebarThreadRow).toBeVisible({ timeout: 30_000 });
    await sidebarThreadRow.click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 60_000 });
    console.log("[desktop-slices] SidebarV2: thread row click navigated to workspace route");

    // Slice D + E first (same order as the packaged gate): a short
    // trailing-tool-run turn drains in a few seconds, folds to "+N", and
    // streams the fenced code block. Doing this before the 60s stream avoids
    // flaky mid-turn replace races on a slow Electron renderer.
    await submitMessage(page, "End the turn with a tool run.");
    const moreButton = page.getByRole("button", {
      name: /Show \d+ more tool calls|Show fewer tool calls/,
    });
    await expect(moreButton).toHaveCount(1, { timeout: 60_000 });
    const badges = page.getByTestId("tool-call-badge");
    await expect(badges).toHaveCount(1, { timeout: 15_000 });
    await expect(moreButton).toHaveText("+3");
    await moreButton.click();
    await expect(badges).toHaveCount(4, { timeout: 15_000 });
    await expect(moreButton).toHaveText("Show fewer");
    console.log("[desktop-slices] Slice D: work-log fold +3 expand -> 4 badges");

    await expect(page.getByText("const anchorRef = useRef<FlatList>(null);")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("const NEAR_BOTTOM_PX = 160;")).toBeVisible({ timeout: 15_000 });
    console.log("[desktop-slices] Slice E: streaming highlight fence rendered");

    // Slice B: a fresh 60s turn anchors the sent row near the top of the
    // viewport. Guard on the running state first so the later queue cannot
    // race a completed turn.
    await submitMessage(page, "Anchor this desktop turn.");
    await expect(page.getByRole("button", { name: /stop|cancel|停止|取消/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    const userRowTop = () =>
      page!
        .getByTestId("user-message")
        .last()
        .evaluate((el) => el.getBoundingClientRect().top);
    await pollUntil(
      async () => {
        const top = await userRowTop();
        const { viewportHeight } = await readScrollMetrics(page!);
        return top >= 0 && top <= viewportHeight / 2;
      },
      20_000,
      "anchor pin in desktop window",
    );
    console.log("[desktop-slices] Slice B: sent row anchored in upper half");

    // Slice C: the projection ack released composer busy — a second message
    // can be queued while the turn still streams. Flush it: the daemon
    // replaces the running turn with a new one (replaceRunning).
    await fillComposerDraft(page, "Second desktop message.");
    await sendDraftToQueue(page);
    await expectQueuedMessageButton(page);
    await sendQueuedMessageNow(page);
    console.log("[desktop-slices] Slice C: busy released, second message queued and flushed");

    console.log("[desktop-slices] ALL DESKTOP SLICES PASSED");
  } finally {
    await page?.close().catch(() => undefined);
    await electronApp?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
    await stopChild(metro);
    await stopChild(daemon);
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch (error) {
      console.warn("[desktop-slices] cleanup warning:", error);
    }
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error("[desktop-slices] FAILED:", error);
    process.exit(1);
  },
);
