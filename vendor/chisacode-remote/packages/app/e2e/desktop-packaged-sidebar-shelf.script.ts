/**
 * Packaged Electron real-surface gate for sidebar shelf merge (Slices 3-6).
 *
 * Launches packages/desktop/release/win-unpacked/ChisaCode.exe with an isolated
 * CHISACODE_HOME, seeds a temp git repo + idle agent via the desktop-managed
 * daemon, then asserts view switcher, dual testids, by-status shelves, search,
 * and settle/snooze context menu items.
 *
 * Run from packages/app:
 *   npx tsx e2e/desktop-packaged-sidebar-shelf.script.ts
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { createTempGitRepo } from "./helpers/workspace";
import { buildAgentRoute } from "./helpers/mock-agent";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const desktopDir = path.join(repoRoot, "packages/desktop");
const releaseDir = path.join(desktopDir, "release");
const winUnpackedExe = path.join(releaseDir, "win-unpacked", "ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

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
  console.log(`[desktop-sidebar] port ${port} occupied; killing stale daemon workers`);
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*daemon-worker*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

function resolvePackagedExe(): string {
  if (existsSync(winUnpackedExe)) {
    return winUnpackedExe;
  }
  throw new Error(
    `Missing packaged exe at ${winUnpackedExe}. Run: npm run build:x64 --workspace=@chisacode/desktop`,
  );
}

interface DaemonStatus {
  serverId?: string;
  status?: string;
  listen?: string;
  pid?: number;
  desktopManaged?: boolean;
  error?: unknown;
}

async function waitForDesktopDaemon(page: Page): Promise<DaemonStatus> {
  const statusHolder: { value: DaemonStatus | null } = { value: null };
  await pollUntil(
    async () => {
      const current = await page
        .evaluate(async () => {
          const host = (
            window as unknown as {
              chisacodeDesktop?: { invoke?: (c: string) => Promise<unknown> };
            }
          ).chisacodeDesktop;
          if (!host?.invoke) {
            return null;
          }
          try {
            return (await host.invoke("desktop_daemon_status")) as DaemonStatus;
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
  if (!statusHolder.value) {
    throw new Error("desktop-managed daemon status missing after poll");
  }
  return statusHolder.value;
}

async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-sidebar-shelf-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-sidebar-shelf-ud-"));
  const serverId = "srv_desktop_sidebar_shelf";
  const shots = path.join(home, "shots");
  mkdirSync(shots, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  process.env.CHISACODE_HOME = home;
  process.env.CHISACODE_SERVER_ID = serverId;
  process.env.E2E_SERVER_ID = serverId;

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let client: { close(): Promise<void> } | null = null;
  let repoCleanup: (() => Promise<void>) | null = null;
  const gates: Array<{ name: string; pass: boolean; detail?: string }> = [];

  function gate(name: string, pass: boolean, detail?: string): void {
    gates.push({ name, pass, detail });
    console.log(
      `[desktop-sidebar] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  }

  try {
    await ensurePortFree(6767);
    const executablePath = resolvePackagedExe();
    console.log("[desktop-sidebar] launching", executablePath);

    electronApp = await _electron.launch({
      executablePath,
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_ELECTRON_USER_DATA_DIR: userData,
        CHISACODE_ENABLE_DEV_PROVIDERS: "1",
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_RELAY_ENABLED: "0",
      },
    });
    page = await electronApp.firstWindow();
    page.setDefaultTimeout(30_000);
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
    console.log("[desktop-sidebar] window url:", page.url());

    page.on("console", (message) => {
      const text = message.text();
      if (/error|failed|exception|unhandled/i.test(text) && text.length < 400) {
        console.log("[packaged-renderer-console]", text);
      }
    });

    const daemonStatus = await waitForDesktopDaemon(page);
    console.log("[desktop-sidebar] daemon status:", JSON.stringify(daemonStatus).slice(0, 300));
    gate("daemon-online", true, daemonStatus.listen);

    const repo = await createTempGitRepo("sidebar-shelf-packaged-");
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
        workspace: { id: string; name: string; workspaceDirectory: string } | null;
        error: string | null;
      }>;
      createAgent(options: {
        provider: string;
        cwd: string;
        model?: string;
        modeId?: string;
        title?: string;
      }): Promise<{ id: string; status: string }>;
    };
    const seedClient = new DaemonClient({
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `sidebar-shelf-seed-${randomUUID()}`,
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
      model: "echo",
      title: "Shelf packaged verify",
    });
    gate("seed-agent", Boolean(agent.id), agent.id);
    console.log("[desktop-sidebar] seeded agent", agent.id, "in", repo.path);

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
      console.log("[desktop-sidebar] window body:", body);
      throw error;
    }
    gate("workspace-panel-visible", true);

    const newConversation = page
      .getByTestId("sidebar-v2-new-project")
      .or(page.getByTestId("sidebar-new-conversation"));
    const newConversationVisible = await newConversation
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    gate("hydration-new-conversation", newConversationVisible);

    const sessionsRoot = page
      .getByTestId("sidebar-sessions")
      .or(page.getByTestId("desktop-left-sidebar"));
    const sessionsVisible = await sessionsRoot
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    gate("sidebar-shell-visible", sessionsVisible);

    const viewSwitcher = page.getByTestId("sidebar-view-switcher");
    const switcherVisible = await viewSwitcher
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    gate("view-switcher-visible", switcherVisible);

    const searchInput = page.getByTestId("sidebar-search-input");
    const searchVisible = await searchInput
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    gate("search-input-visible", searchVisible);

    const threadById = page.getByTestId(`sidebar-v2-thread-${agent.id}`);
    const threadFallback = page
      .getByRole("button", { name: /Shelf packaged verify|新会话|New session/i })
      .first();
    let rowVisible = await threadById
      .waitFor({ state: "visible", timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    let threadRow = threadById;
    if (!rowVisible) {
      rowVisible = await threadFallback
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      threadRow = threadFallback;
    }
    gate("by-project-thread-row", rowVisible, agent.id);

    if (rowVisible) {
      await page.screenshot({ path: path.join(shots, "by-project.png"), fullPage: true });
      await threadRow.click({ button: "right" });
      await pollUntil(
        async () => {
          const p = page!;
          const rename = await p.getByTestId("sidebar-v2-menu-rename").count();
          const settle = await p
            .getByTestId(new RegExp(`sidebar-session-settle-.*-${agent.id}$`))
            .count();
          return rename > 0 || settle > 0;
        },
        8_000,
        "context menu open",
      ).catch(() => undefined);

      const renameVisible = await page
        .getByTestId("sidebar-v2-menu-rename")
        .isVisible()
        .catch(() => false);
      const settleVisible = await page
        .getByTestId(new RegExp(`sidebar-session-settle-.*-${agent.id}$`))
        .first()
        .isVisible()
        .catch(() => false);
      const snoozeVisible = await page
        .getByTestId(new RegExp(`sidebar-session-snooze-hour-.*-${agent.id}$`))
        .first()
        .isVisible()
        .catch(async () => {
          return page!
            .getByText(/In 1 hour|1 小时后|1小时后|Snooze|稍后提醒/i)
            .first()
            .isVisible()
            .catch(() => false);
        });
      gate("context-menu-rename", renameVisible);
      gate("context-menu-settle", settleVisible);
      gate("context-menu-snooze", snoozeVisible);
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.click(8, 8).catch(() => undefined);
    }

    const byStatus = page.getByTestId("sidebar-view-by-status");
    const byStatusClickable = await byStatus
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (byStatusClickable) {
      await byStatus.click();
    }
    const statusView = page.getByTestId("sidebar-status-view");
    const statusVisible = await statusView
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    gate("by-status-view-visible", statusVisible);
    await page.screenshot({ path: path.join(shots, "by-status.png"), fullPage: true });

    if (statusVisible) {
      const statusRowById = page.getByTestId(`sidebar-v2-thread-${agent.id}`);
      const statusRowFallback = page
        .getByRole("button", { name: /Shelf packaged verify|新会话|New session/i })
        .first();
      let statusRowVisible = await statusRowById
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!statusRowVisible) {
        statusRowVisible = await statusRowFallback
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
      }
      gate("by-status-thread-row", statusRowVisible);
    }

    if (searchVisible) {
      // Scope all search assertions to the sidebar shell. The workspace header
      // also shows the open agent title and would false-positive page-wide
      // getByText(/Shelf packaged verify/) checks.
      const sidebarScope = page
        .getByTestId("sidebar-status-view")
        .or(page.getByTestId("sidebar-sessions"))
        .or(page.getByTestId("desktop-left-sidebar"))
        .first();

      await searchInput.fill("Shelf packaged");
      await pollUntil(
        async () => {
          const hit = await sidebarScope
            .getByTestId(`sidebar-v2-thread-${agent.id}`)
            .isVisible()
            .catch(() => false);
          return hit;
        },
        8_000,
        "search match",
      ).catch(() => undefined);
      const searchHitVisible = await sidebarScope
        .getByTestId(`sidebar-v2-thread-${agent.id}`)
        .isVisible()
        .catch(() => false);
      gate("search-keeps-matching-row", searchHitVisible);

      await searchInput.fill("zzzz-no-match-xyz");
      await pollUntil(
        async () => {
          const byId = await sidebarScope
            .getByTestId(`sidebar-v2-thread-${agent.id}`)
            .isVisible()
            .catch(() => false);
          return !byId;
        },
        8_000,
        "search miss",
      ).catch(() => undefined);
      const searchMiss = await sidebarScope
        .getByTestId(`sidebar-v2-thread-${agent.id}`)
        .isVisible()
        .catch(() => false);
      gate("search-hides-non-matching-row", !searchMiss);

      const clearBtn = page.getByTestId("sidebar-search-clear");
      if ((await clearBtn.count()) > 0) {
        await clearBtn.click().catch(() => undefined);
      } else {
        await searchInput.fill("");
      }
    }

    const byProject = page.getByTestId("sidebar-view-by-project");
    if ((await byProject.count()) > 0) {
      await byProject.click().catch(() => undefined);
    }
    await page.screenshot({ path: path.join(shots, "final-by-project.png"), fullPage: true });

    const failed = gates.filter((g) => !g.pass);
    const reportPath = path.join(
      evidenceDir,
      `desktop-packaged-sidebar-shelf-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const md = [
      "# Packaged Electron sidebar shelf verification",
      "",
      `- status: **${failed.length === 0 ? "PASS" : "FAIL"}**`,
      `- exe: ${executablePath}`,
      `- agentId: ${agent.id}`,
      `- shots: ${shots}`,
      `- daemon: ${daemonStatus.listen} pid=${daemonStatus.pid}`,
      "",
      "## Gates",
      ...gates.map(
        (g) => `- ${g.pass ? "PASS" : "FAIL"} ${g.name}${g.detail ? `: ${g.detail}` : ""}`,
      ),
      "",
      `## Summary: pass=${gates.filter((g) => g.pass).length} fail=${failed.length}`,
      "",
    ].join("\n");
    writeFileSync(reportPath, md, "utf8");
    for (const name of readdirSync(shots)) {
      copyFileSync(path.join(shots, name), path.join(evidenceDir, `sidebar-shelf-${name}`));
    }
    console.log("[desktop-sidebar] report:", reportPath);
    if (failed.length > 0) {
      throw new Error(
        `Packaged sidebar verification failed: ${failed.map((f) => f.name).join(", ")}`,
      );
    }
    console.log("[desktop-sidebar] ALL GATES PASSED");
  } finally {
    if (client) {
      await client.close().catch(() => undefined);
    }
    if (repoCleanup) {
      await repoCleanup().catch(() => undefined);
    }
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-Process ChisaCode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
      ],
      { stdio: "ignore" },
    );
  }
}

main().catch((error) => {
  console.error("[desktop-sidebar] FAILED:", error);
  process.exitCode = 1;
});
