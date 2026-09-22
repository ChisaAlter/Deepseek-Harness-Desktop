/**
 * Packaged Electron gate: the SELECTED sidebar row must not change its
 * background on hover (selection fill is stable chrome), while an UNSELECTED
 * row may still highlight on hover. Covers both by-project (session rows) and
 * by-status (T3 cards) views.
 *
 * Note: status cards intentionally have NO inline hover actions (Settle/Snooze
 * stay in the right-click menu) — hover-revealed buttons replaced the status
 * label and made rows jump; hover must never change row content/layout.
 *
 * Run from packages/app (packaged build must exist):
 *   npx tsx e2e/desktop-selected-hover-stable.script.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const releaseDir = path.join(repoRoot, "packages/desktop", "release");
const winUnpackedExe = path.join(releaseDir, "win-unpacked", "ChisaCode.exe");
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
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-Process ChisaCode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
    ],
    { stdio: "ignore" },
  );
  await new Promise((r) => setTimeout(r, 1500));
}

function resolvePackagedExe(): string {
  if (existsSync(winUnpackedExe)) return winUnpackedExe;
  throw new Error(
    `Missing packaged exe at ${winUnpackedExe}. Run: npm run build:x64 --workspace=@chisacode/desktop`,
  );
}

interface RowBg {
  backgroundColor: string;
  opacity: string;
  boxShadow: string;
}

async function sampleRowBg(page: Page, testId: string): Promise<RowBg | null> {
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      boxShadow: style.boxShadow,
    };
  }, testId);
}

// eslint-disable-next-line complexity -- packaged gate covers seed, two views, hover states, and settle/snooze reveal
async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-sel-hover-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-sel-hover-ud-"));
  const serverId = "srv_sel_hover";
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
  const gates: { name: string; pass: boolean; detail?: string }[] = [];
  const crashLog: string[] = [];

  function gate(name: string, pass: boolean, detail?: string): void {
    gates.push({ name, pass, detail });
    console.log(`[sel-hover] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  }

  try {
    await ensurePortFree(6767);
    const executablePath = resolvePackagedExe();
    console.log("[sel-hover] launching", executablePath);

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

    electronApp.on("child-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`child-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    electronApp.on("render-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`render-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    page.on("pageerror", (error) => crashLog.push(`pageerror: ${String(error).slice(0, 300)}`));

    await pollUntil(
      async () => {
        return page!.evaluate(async () => {
          const host = (
            window as unknown as { chisacodeDesktop?: { invoke?: (c: string) => Promise<unknown> } }
          ).chisacodeDesktop;
          if (!host?.invoke) return false;
          try {
            const s = (await host.invoke("desktop_daemon_status")) as {
              status?: string;
              desktopManaged?: boolean;
              listen?: string;
            };
            return (
              s?.status === "running" &&
              s.desktopManaged === true &&
              typeof s.listen === "string" &&
              s.listen.length > 0
            );
          } catch {
            return false;
          }
        });
      },
      120_000,
      "desktop daemon",
    );

    const repo = await createTempGitRepo("sel-hover-");
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
      openProject(cwd: string): Promise<{ workspace: { id: string } | null; error: string | null }>;
      createAgent(options: {
        provider: string;
        cwd: string;
        model?: string;
        title?: string;
      }): Promise<{ id: string; status: string }>;
    };
    const seedClient = new DaemonClient({
      url: "ws://127.0.0.1:6767/ws",
      clientId: `sel-hover-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.2",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await seedClient.connect();
    client = seedClient;
    const opened = await seedClient.openProject(repo.path);
    if (!opened.workspace) throw new Error(opened.error ?? "openProject failed");
    const agentA = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Hover probe A",
    });
    const agentB = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Hover probe B",
    });
    gate("seed-agents", Boolean(agentA.id && agentB.id), `${agentA.id}, ${agentB.id}`);

    await page.goto(`chisacode://app/h/${serverId}/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sidebar-sessions").waitFor({ state: "visible", timeout: 120_000 });

    // ── By-project view: select A, hover A (must not change), hover B (may change) ──
    await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).click();
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(500);

    const selA = await sampleRowBg(page, `sidebar-v2-thread-${agentA.id}`);
    gate("by-project-selected-baseline", Boolean(selA), JSON.stringify(selA));
    if (selA) {
      await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).hover();
      await page.waitForTimeout(300);
      const selAHover = await sampleRowBg(page, `sidebar-v2-thread-${agentA.id}`);
      const bgStable = selAHover?.backgroundColor === selA.backgroundColor;
      const opacityStable = selAHover?.opacity === selA.opacity;
      gate(
        "by-project-selected-hover-bg-stable",
        Boolean(selAHover) && bgStable && opacityStable,
        `rest ${selA.backgroundColor}/${selA.opacity} -> hover ${selAHover?.backgroundColor}/${selAHover?.opacity}`,
      );

      // Unselected row may still highlight on hover (sanity contrast).
      const unselB = await sampleRowBg(page, `sidebar-v2-thread-${agentB.id}`);
      await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).hover();
      await page.waitForTimeout(300);
      const unselBHover = await sampleRowBg(page, `sidebar-v2-thread-${agentB.id}`);
      if (unselB && unselBHover) {
        gate(
          "by-project-unselected-hover-changes-or-stays",
          unselBHover.backgroundColor !== unselB.backgroundColor ||
            unselB.backgroundColor === "rgba(0, 0, 0, 0)",
          `rest ${unselB.backgroundColor} -> hover ${unselBHover.backgroundColor}`,
        );
      } else {
        gate("by-project-unselected-hover-changes-or-stays", false, "missing row bg sample");
      }
    }

    // ── By-status view: same assertions on T3 cards ──
    const byStatusTab = page.getByTestId("sidebar-view-by-status");
    if ((await byStatusTab.count()) > 0) {
      await byStatusTab.click();
      await page.getByTestId("sidebar-status-view").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(400);
    }
    const cardA = await sampleRowBg(page, `sidebar-v2-thread-${agentA.id}`);
    gate("by-status-selected-baseline", Boolean(cardA), JSON.stringify(cardA));
    if (cardA) {
      await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).hover();
      await page.waitForTimeout(300);
      const cardAHover = await sampleRowBg(page, `sidebar-v2-thread-${agentA.id}`);
      const bgStable = cardAHover?.backgroundColor === cardA.backgroundColor;
      const opacityStable = cardAHover?.opacity === cardA.opacity;
      gate(
        "by-status-selected-hover-bg-stable",
        Boolean(cardAHover) && bgStable && opacityStable,
        `rest ${cardA.backgroundColor}/${cardA.opacity} -> hover ${cardAHover?.backgroundColor}/${cardAHover?.opacity}`,
      );

      const cardB = await sampleRowBg(page, `sidebar-v2-thread-${agentB.id}`);
      await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).hover();
      await page.waitForTimeout(300);
      const cardBHover = await sampleRowBg(page, `sidebar-v2-thread-${agentB.id}`);
      if (cardB && cardBHover) {
        gate(
          "by-status-unselected-hover-changes-or-stays",
          cardBHover.backgroundColor !== cardB.backgroundColor ||
            cardB.backgroundColor === "rgba(0, 0, 0, 0)",
          `rest ${cardB.backgroundColor} -> hover ${cardBHover.backgroundColor}`,
        );
      } else {
        gate("by-status-unselected-hover-changes-or-stays", false, "missing card bg sample");
      }

      // Hover must NOT reveal inline action buttons on cards (product decision:
      // hover-revealed buttons replaced the status label and made rows jump).
      // The hover from the selected-row check above is still active — assert
      // that no Settle/Snooze action chrome exists in the DOM at all.
      const settleCount =
        (await page.getByTestId(`sidebar-status-settle-${agentA.id}`).count()) +
        (await page.getByTestId(`sidebar-status-settle-${agentB.id}`).count());
      const snoozeCount =
        (await page.getByTestId(`sidebar-status-snooze-${agentA.id}`).count()) +
        (await page.getByTestId(`sidebar-status-snooze-${agentB.id}`).count());
      gate(
        "by-status-no-inline-hover-actions",
        settleCount === 0 && snoozeCount === 0,
        `settle=${settleCount} snooze=${snoozeCount} (must be 0)`,
      );
    }

    await page.screenshot({ path: path.join(shots, "sel-hover-final.png"), fullPage: true });

    const reportPath = path.join(
      evidenceDir,
      `desktop-selected-hover-stable-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const failed = gates.filter((g) => !g.pass);
    const evidenceShots = path.join(evidenceDir, "selected-hover-shots");
    mkdirSync(evidenceShots, { recursive: true });
    const srcShot = path.join(shots, "sel-hover-final.png");
    if (existsSync(srcShot)) {
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Copy-Item -Force '${srcShot}' '${path.join(evidenceShots, "sel-hover-final.png")}'`,
        ],
        { stdio: "ignore" },
      );
    }

    const md = [
      "# Packaged Electron selected-row hover stability",
      "",
      `- status: **${failed.length === 0 ? "PASS" : "FAIL"}**`,
      `- exe: ${executablePath}`,
      "",
      "## Gates",
      ...gates.map(
        (g) => `- ${g.pass ? "PASS" : "FAIL"} ${g.name}${g.detail ? `: ${g.detail}` : ""}`,
      ),
      "",
      "## Crash log",
      crashLog.length === 0 ? "- (none)" : crashLog.map((l) => `- ${l}`).join("\n"),
      "",
    ].join("\n");
    writeFileSync(reportPath, md, "utf8");
    console.log("[sel-hover] evidence:", reportPath);

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`[sel-hover] FAILED ${failed.length} gate(s)`);
    } else {
      console.log("[sel-hover] ALL GATES PASSED");
    }
  } catch (error) {
    console.error("[sel-hover] fatal:", error);
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
    if (electronApp) await electronApp.close().catch(() => {});
    if (repoCleanup) await repoCleanup().catch(() => {});
  }
}

void main();
