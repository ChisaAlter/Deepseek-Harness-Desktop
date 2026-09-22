/**
 * Real packaged-desktop gate for the T3 message-render slices.
 *
 * Launches the electron-builder packaged win build (ChisaCode.exe from
 * packages/desktop/release/*-x64.zip) — NOT the dev-mode electron — against an
 * isolated CHISACODE_HOME, then drives the real renderer window via
 * Playwright's `_electron` API and asserts the Slice B (turn anchoring), C
 * (busy release on projection), D (work-log fold), and E (streaming highlight
 * cache — a fenced code block renders during the stream) behaviors on the
 * packaged desktop surface. Run with `tsx` from packages/app.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
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
const desktopDir = path.join(repoRoot, "packages/desktop");
const releaseDir = path.join(desktopDir, "release");
const unpackedDir = path.join(releaseDir, ".unpacked-x64");
const packagedExe = path.join(unpackedDir, "ChisaCode.exe");

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
  console.log(`[desktop-packaged] port ${port} occupied; killing stale dev daemon workers`);
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
    throw new Error(`port ${port} still occupied after stale-worker cleanup`);
  }
}

/** Extracts the packaged win build once and returns the ChisaCode.exe path. */
async function ensurePackagedBuild(): Promise<string> {
  const zips = ["ChisaCode-Setup-1.0.2-x64.zip", "ChisaCode-Setup-1.0.2.zip"]
    .map((name) => path.join(releaseDir, name))
    .filter((p) => existsSync(p));
  if (zips.length === 0) {
    if (existsSync(packagedExe)) {
      return packagedExe;
    }
    throw new Error("no packaged build zip in packages/desktop/release");
  }

  const zip = zips[0];
  const extractedBuildIsCurrent = (() => {
    try {
      return existsSync(packagedExe) && statSync(packagedExe).mtimeMs >= statSync(zip).mtimeMs;
    } catch {
      return false;
    }
  })();
  if (extractedBuildIsCurrent) {
    return packagedExe;
  }

  if (existsSync(unpackedDir)) {
    console.log("[desktop-packaged] removing stale extracted build:", unpackedDir);
    rmSync(unpackedDir, { recursive: true, force: true });
  }

  console.log("[desktop-packaged] extracting", path.basename(zip), "->", unpackedDir);
  mkdirSync(unpackedDir, { recursive: true });
  // `unzip` handles the zip; fall back to PowerShell Expand-Archive if absent.
  let result = spawnSync("unzip", ["-q", zip, "-d", unpackedDir], {
    stdio: "ignore",
    timeout: 600_000,
  });
  if (result.status !== 0) {
    result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${unpackedDir}' -Force`,
      ],
      { stdio: "ignore", timeout: 600_000 },
    );
  }
  if (result.status !== 0 || !existsSync(packagedExe)) {
    rmSync(unpackedDir, { recursive: true, force: true });
    throw new Error(`failed to extract packaged build (status ${result.status})`);
  }
  return packagedExe;
}

async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-packaged-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-packaged-user-data-"));
  const serverId = "srv_desktop_packaged_e2e";

  process.env.CHISACODE_HOME = home;
  process.env.CHISACODE_SERVER_ID = serverId;
  // buildAgentRoute resolves the route host from this (Playwright globalSetup
  // sets it for web specs; the packaged daemon adopts CHISACODE_SERVER_ID).
  process.env.E2E_SERVER_ID = serverId;

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let client: { close(): Promise<void> } | null = null;
  let daemonPid: number | null = null;

  try {
    await ensurePortFree(6767);
    const executablePath = await ensurePackagedBuild();
    console.log("[desktop-packaged] launching packaged app:", executablePath);
    electronApp = await _electron.launch({
      executablePath,
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_ELECTRON_USER_DATA_DIR: userData,
        // The packaged daemon forces CHISACODE_NODE_ENV=production, which hides
        // the dev-only mock provider; opt dev providers in for the deterministic
        // streaming gate (server config CHISACODE_ENABLE_DEV_PROVIDERS=1).
        CHISACODE_ENABLE_DEV_PROVIDERS: "1",
        // Keep the packaged daemon quiet: no speech-model downloads, no
        // dictation, no relay reconnect churn against an unreachable relay.
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_RELAY_ENABLED: "0",
      },
    });
    console.log("[desktop-packaged] packaged app launched, grabbing first window");
    page = await electronApp.firstWindow();
    // Library-mode Playwright has no default action timeout — bound every
    // action so a laggy packaged renderer fails loudly instead of hanging.
    page.setDefaultTimeout(30_000);
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    console.log("[desktop-packaged] window url:", page.url());

    page.on("console", (message) => {
      const text = message.text();
      if (/error|failed|exception|unhandled/i.test(text) && text.length < 400) {
        console.log("[packaged-renderer-console]", text);
      }
    });

    // The desktop-managed daemon starts asynchronously on boot; poll the
    // bridge until it reports running. The poll result is written through a
    // holder object — TS does not model closure writes to a captured `let`,
    // which would keep it narrowed to its initial null.
    const statusHolder: {
      value: {
        serverId?: string;
        status?: string;
        listen?: string;
        pid?: number;
        desktopManaged?: boolean;
        error?: unknown;
      } | null;
    } = { value: null };
    await pollUntil(
      async () => {
        const current = await page
          ?.evaluate(async () => {
            const host = (
              window as unknown as {
                chisacodeDesktop?: { invoke?: (c: string) => Promise<unknown> };
              }
            ).chisacodeDesktop;
            if (!host?.invoke) {
              return null;
            }
            try {
              return (await host.invoke("desktop_daemon_status")) as {
                serverId?: string;
                status?: string;
                listen?: string;
                pid?: number;
                desktopManaged?: boolean;
                error?: unknown;
              };
            } catch {
              return null;
            }
          })
          .catch(() => null);
        statusHolder.value = current ?? null;
        const daemonStatus = statusHolder.value;
        return (
          daemonStatus?.status === "running" &&
          daemonStatus.desktopManaged === true &&
          typeof daemonStatus.listen === "string" &&
          daemonStatus.listen.length > 0 &&
          typeof daemonStatus.pid === "number"
        );
      },
      120_000,
      "desktop-managed daemon running",
    );
    const daemonStatus = statusHolder.value;
    if (!daemonStatus || typeof daemonStatus.pid !== "number") {
      throw new Error("desktop-managed daemon status missing pid after poll");
    }
    console.log("[desktop-packaged] daemon status:", JSON.stringify(daemonStatus).slice(0, 300));
    daemonPid = daemonStatus.pid;

    // Seed a mock agent through the desktop-managed daemon and open its route.
    const repo = await createTempGitRepo("packaged-slice-");
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
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `packaged-seed-${randomUUID()}`,
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
    await page.goto(`chisacode://app${route}`, { waitUntil: "domcontentloaded" });
    try {
      await page
        .getByTestId("workspace-main-panel")
        .waitFor({ state: "visible", timeout: 120_000 });
    } catch (error) {
      const body = await page.evaluate(() =>
        (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      );
      console.log("[desktop-packaged] window body:", body);
      throw error;
    }
    await expectComposerEditable(page);
    console.log("[desktop-packaged] agent route open, composer editable");

    // SidebarV2 smoke: prefer stable testID, fall back to the visible "新会话"
    // row when packaged Electron has not yet projected the testID attribute.
    const sidebarThreadById = page.getByTestId(`sidebar-v2-thread-${agent.id}`);
    const sidebarThreadFallback = page.getByRole("button", { name: /新会话|New session/i }).first();
    const sidebarThreadRow =
      (await sidebarThreadById.count()) > 0 ? sidebarThreadById : sidebarThreadFallback;
    await expect(sidebarThreadRow).toBeVisible({ timeout: 30_000 });
    await sidebarThreadRow.click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 60_000 });
    console.log("[desktop-packaged] SidebarV2: thread row click navigated to workspace route");

    // Slice D + E first: the trailing-tool-run turn drains in a few seconds,
    // the tool run folds to a "+N" badge once complete, and the streamed
    // fenced code block renders (streaming highlight cache path).
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
    console.log("[desktop-packaged] Slice D: work-log fold +3 expand -> 4 badges");

    await expect(page.getByText("const anchorRef = useRef<FlatList>(null);")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("const NEAR_BOTTOM_PX = 160;")).toBeVisible({ timeout: 15_000 });
    console.log("[desktop-packaged] Slice E: streaming highlight fence rendered");

    // Slice B: a fresh 60s turn anchors the sent row near the top of the
    // viewport. Guard on the running state first so the later queue cannot
    // race a completed turn (the packaged renderer is slow).
    await submitMessage(page, "Anchor this packaged turn.");
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
      "anchor pin in packaged window",
    );
    console.log("[desktop-packaged] Slice B: sent row anchored in upper half");

    // Slice C: the projection ack released composer busy — a second message
    // can be queued while the turn still streams. Flush it: the daemon
    // replaces the running turn with a new one (replaceRunning).
    await fillComposerDraft(page, "Second packaged message.");
    await sendDraftToQueue(page);
    await expectQueuedMessageButton(page);
    await sendQueuedMessageNow(page);
    console.log("[desktop-packaged] Slice C: busy released, second message queued and flushed");

    console.log("[desktop-packaged] ALL PACKAGED SLICES PASSED");
  } finally {
    // Preserve diagnostics from this run for post-mortem (overwrites each run).
    const diagDir = path.join(releaseDir, ".last-packaged-run");
    try {
      mkdirSync(diagDir, { recursive: true });
      for (const [src, name] of [
        [path.join(home, "daemon.log"), "daemon.log"],
        [path.join(userData, "logs", "main.log"), "desktop-main.log"],
      ] as const) {
        if (existsSync(src)) {
          rmSync(path.join(diagDir, name), { force: true });
          copyFileSync(src, path.join(diagDir, name));
        }
      }
    } catch (error) {
      console.warn("[desktop-packaged] diag copy warning:", error);
    }
    // The packaged app can be slow to acknowledge shutdown — bound the close
    // so cleanup never hangs the gate after a green or red verdict.
    const boundedClose = (closer: () => Promise<void>) =>
      Promise.race([
        closer(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 10_000);
        }),
      ]).catch(() => undefined);
    await boundedClose(() => page?.close().catch(() => undefined) ?? Promise.resolve());
    await boundedClose(() => electronApp?.close().catch(() => undefined) ?? Promise.resolve());
    await boundedClose(() => client?.close().catch(() => undefined) ?? Promise.resolve());
    if (daemonPid) {
      try {
        spawnSync("taskkill", ["/pid", String(daemonPid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // Best effort.
      }
    } else {
      // Bridge may not have reported a pid; kill packaged node-entrypoint-runner
      // holders of 6767 so the next run is not blocked.
      const script =
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*node-entrypoint-runner*' } | " +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      try {
        spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
      } catch {
        // Best effort.
      }
    }
    for (const dir of [home, userData]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      } catch (error) {
        console.warn("[desktop-packaged] cleanup warning:", error);
      }
    }
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error("[desktop-packaged] FAILED:", error);
    process.exit(1);
  },
);
