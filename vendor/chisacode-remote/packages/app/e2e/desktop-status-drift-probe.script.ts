/**
 * Focused probe: why do by-status card project-name labels shrink 2px when a
 * session is selected? Dumps card/line1 geometry before and after selection.
 *
 * Run from packages/app:
 *   npx tsx e2e/desktop-status-drift-probe.script.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const desktopDir = path.join(repoRoot, "packages/desktop");
const winUnpackedExe = path.join(desktopDir, "release", "win-unpacked", "ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

async function pollUntil(
  poll: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await poll()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`);
}

async function ensurePortFree(port: number): Promise<void> {
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
  if (!occupied) return;
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*daemon-worker*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

interface DaemonStatus {
  status?: string;
  listen?: string;
  pid?: number;
  desktopManaged?: boolean;
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
          if (!host?.invoke) return null;
          try {
            return (await host.invoke("desktop_daemon_status")) as DaemonStatus;
          } catch {
            return null;
          }
        })
        .catch(() => null);
      statusHolder.value = current ?? null;
      const d = statusHolder.value;
      return (
        d?.status === "running" &&
        d.desktopManaged === true &&
        typeof d.listen === "string" &&
        d.listen.length > 0
      );
    },
    120_000,
    "desktop-managed daemon running",
  );
  return statusHolder.value!;
}

async function dumpLayout(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="desktop-left-sidebar"]');
    const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
    const cards = Array.from(
      document.querySelectorAll(
        '[data-testid="sidebar-status-view"] [data-testid^="sidebar-v2-thread-"]',
      ),
    ).map((card) => {
      const rect = card.getBoundingClientRect();
      const line1 = card.children[0];
      const children = line1
        ? Array.from(line1.children).map((el) => {
            const r = el.getBoundingClientRect();
            const style = window.getComputedStyle(el as HTMLElement);
            return {
              tag: (el as HTMLElement).tagName,
              width: Math.round(r.width * 100) / 100,
              height: Math.round(r.height * 100) / 100,
              text: ((el as HTMLElement).textContent ?? "").trim().slice(0, 30),
              flex: style.flex,
              display: style.display,
            };
          })
        : [];
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        line1Children: children,
      };
    });
    const sidebarOverflow = sidebar ? window.getComputedStyle(sidebar).overflow : null;
    const timeLabels = Array.from(
      document.querySelectorAll(
        '[data-testid="sidebar-status-view"] [data-testid^="sidebar-v2-thread-"] *',
      ),
    )
      .filter((el) => {
        const text = (el.textContent ?? "").trim();
        return text === "now" || text === "1m" || text === "2m";
      })
      .map((el) => {
        const style = window.getComputedStyle(el as HTMLElement);
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent ?? "").trim(),
          width: Math.round(rect.width * 100) / 100,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontFamily: style.fontFamily,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          color: style.color,
        };
      });
    return {
      sidebarWidth: sidebarRect ? Math.round(sidebarRect.width * 100) / 100 : null,
      sidebarOverflow,
      cards,
      timeLabels,
    };
  });
}

async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-drift-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-drift-ud-"));
  const serverId = "srv_drift";
  process.env.CHISACODE_HOME = home;
  process.env.CHISACODE_SERVER_ID = serverId;
  process.env.E2E_SERVER_ID = serverId;

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let client: { close(): Promise<void> } | null = null;
  let repoCleanup: (() => Promise<void>) | null = null;

  try {
    await ensurePortFree(6767);
    electronApp = await _electron.launch({
      executablePath: winUnpackedExe,
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

    const daemonStatus = await waitForDesktopDaemon(page);
    const repo = await createTempGitRepo("drift-");
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
      openProject(cwd: string): Promise<{ workspace: unknown; error: string | null }>;
      createAgent(options: {
        provider: string;
        cwd: string;
        model?: string;
        title?: string;
      }): Promise<{ id: string }>;
    };
    const seedClient = new DaemonClient({
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `drift-seed-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.2",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await seedClient.connect();
    client = seedClient;
    await seedClient.openProject(repo.path);
    // Second agent gives the list two rows so sibling drift is measurable;
    // agentA itself is only a row, the probe clicks agentB below.
    await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Drift probe A",
    });
    const agentB = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Drift probe B",
    });

    // Go to home, switch to by-status, measure.
    await page.goto(`chisacode://app/h/${serverId}/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sidebar-sessions").waitFor({ state: "visible", timeout: 120_000 });
    const statusTab = page.getByTestId("sidebar-view-by-status");
    if ((await statusTab.count()) > 0) {
      await statusTab.click();
    }
    await page.getByTestId("sidebar-status-view").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);
    const homeLayout = await dumpLayout(page);

    // Click agent B (workspace route, selection).
    await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).click();
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(800);
    const selectedLayout = await dumpLayout(page);

    const reportPath = path.join(
      evidenceDir,
      `desktop-status-drift-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const md = [
      "# by-status card drift probe",
      "",
      "## Home (nothing selected)",
      "```json",
      JSON.stringify(homeLayout, null, 2),
      "```",
      "",
      "## Workspace route (agent B selected)",
      "```json",
      JSON.stringify(selectedLayout, null, 2),
      "```",
      "",
    ].join("\n");
    writeFileSync(reportPath, md, "utf8");
    console.log(`[drift-probe] report: ${reportPath}`);
  } catch (error) {
    console.error("[drift-probe] FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (electronApp) await electronApp.close().catch(() => undefined);
    if (repoCleanup) await repoCleanup().catch(() => undefined);
  }
}

main();
