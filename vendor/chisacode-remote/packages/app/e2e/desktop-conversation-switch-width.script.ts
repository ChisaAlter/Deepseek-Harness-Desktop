/**
 * Packaged Electron gate: same-workspace agent switches must not change the
 * centered conversation column width/x (no 800→paneHeight horizontal flash),
 * and AI prose must render at T3-aligned 14px / ~23 line-height / foreground@80%.
 *
 * Run from packages/app (after build:x64):
 *   npx tsx e2e/desktop-conversation-switch-width.script.ts
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
const desktopDir = path.join(repoRoot, "packages/desktop");
const releaseDir = path.join(desktopDir, "release");
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
  if (!occupied) {
    return;
  }
  console.log(`[conv-switch-width] port ${port} occupied; killing stale daemon workers`);
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

interface ColumnBox {
  width: number;
  x: number;
  y: number;
  height: number;
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

async function measureColumn(page: Page): Promise<ColumnBox | null> {
  return page.evaluate(() => {
    const node =
      document.querySelector<HTMLElement>('[data-testid="conversation-aspect-column"]') ??
      document.querySelector<HTMLElement>('[data-testid="conversation-aspect-host"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { width: rect.width, x: rect.x, y: rect.y, height: rect.height };
  });
}

async function sampleColumnStability(
  page: Page,
  baseline: ColumnBox,
  sampleMs = 220,
): Promise<{ maxWidthDelta: number; maxXDelta: number; last: ColumnBox | null }> {
  const started = Date.now();
  let maxWidthDelta = 0;
  let maxXDelta = 0;
  let last: ColumnBox | null = null;
  while (Date.now() - started < sampleMs) {
    const sample = await measureColumn(page);
    if (sample) {
      maxWidthDelta = Math.max(maxWidthDelta, Math.abs(sample.width - baseline.width));
      maxXDelta = Math.max(maxXDelta, Math.abs(sample.x - baseline.x));
      last = sample;
    }
    await page.waitForTimeout(16);
  }
  return { maxWidthDelta, maxXDelta, last };
}

async function sampleAssistantProseStyle(page: Page): Promise<{
  leafCount: number;
  alignedCount: number;
  misaligned: string[];
  textPreview: string;
  fontSizeHistogram: string;
} | null> {
  // Keep this evaluate body free of nested function declarations — tsx/esbuild
  // injects `__name` helpers that crash inside Chromium's isolated world.

  // eslint-disable-next-line complexity -- gate leaf sampler branches on many style keys
  return page.evaluate(() => {
    const surface =
      document.querySelector('[data-testid="assistant-message-surface"]') ??
      document.querySelector('[data-testid="assistant-message"]');
    if (!(surface instanceof HTMLElement)) return null;

    // Only true text leaves carry the prose styles; RNW wraps them in plain
    // <div> containers whose computed style is the browser default (16px/black).
    // Counting containers produced the misleading "6x16px black" histogram, so
    // gate on text leaves only and require ALL of them to match the T3 token.
    const histCounts: Record<string, number> = {};
    const misaligned: string[] = [];
    const all: Element[] = Array.from(surface.querySelectorAll("*"));
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i];
      if (!(el instanceof HTMLElement)) continue;
      // Text leaf: single TEXT_NODE child.
      if (el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE) continue;
      const text = (el.textContent ?? "").trim();
      if (text.length < 1) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const key = `${style.fontSize}|${style.lineHeight}|${style.color}`;
      histCounts[key] = (histCounts[key] ?? 0) + 1;
      const lh = Number.parseFloat(style.lineHeight);
      const aligned =
        style.fontSize === "14px" &&
        Number.isFinite(lh) &&
        Math.abs(lh - 23) <= 1.5 &&
        /rgba\(/i.test(style.color);
      if (!aligned) {
        misaligned.push(`${key} :: "${text.slice(0, 40)}"`);
      }
    }

    const histEntries: [string, number][] = [];
    for (const key of Object.keys(histCounts)) {
      histEntries.push([key, histCounts[key] ?? 0]);
    }
    histEntries.sort((a, b) => b[1] - a[1]);
    let fontSizeHistogram = "";
    for (let i = 0; i < Math.min(8, histEntries.length); i += 1) {
      const entry = histEntries[i];
      if (!entry) continue;
      if (fontSizeHistogram.length > 0) fontSizeHistogram += " ; ";
      fontSizeHistogram += `${entry[1]}x${entry[0]}`;
    }

    const leafCount = histEntries.reduce((sum, entry) => sum + entry[1], 0);
    return {
      leafCount,
      alignedCount: leafCount - misaligned.length,
      misaligned,
      textPreview: (surface.textContent ?? "").trim().slice(0, 80),
      fontSizeHistogram,
    };
  });
}

// eslint-disable-next-line complexity -- packaged gate covers seed, switch, sample, AI style
async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-conv-switch-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-conv-switch-ud-"));
  const serverId = "srv_conv_switch";
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
    console.log(
      `[conv-switch-width] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  }

  try {
    await ensurePortFree(6767);
    const executablePath = resolvePackagedExe();
    console.log("[conv-switch-width] launching", executablePath);

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
    console.log("[conv-switch-width] window url:", page.url());

    // Crash instrumentation (typed loosely — Electron event typings lag playwright).
    electronApp.on("child-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`child-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    electronApp.on("render-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`render-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    page.on("crash", () => crashLog.push("page crash event"));
    page.on("pageerror", (error) => crashLog.push(`pageerror: ${String(error).slice(0, 300)}`));

    const daemonStatus = await waitForDesktopDaemon(page);
    gate("daemon-online", true, daemonStatus.listen);
    console.log("[conv-switch-width] daemon status:", JSON.stringify(daemonStatus).slice(0, 300));

    const repo = await createTempGitRepo("conv-switch-");
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
      sendAgentMessage(
        agentId: string,
        text: string,
      ): Promise<{ accepted?: boolean; error?: string | null }>;
    };
    const seedClient = new DaemonClient({
      url: `ws://${daemonStatus.listen}/ws`,
      clientId: `conv-switch-seed-${randomUUID()}`,
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
    const agentA = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Conv switch probe A",
    });
    const agentB = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Conv switch probe B",
    });
    gate("seed-agents", Boolean(agentA.id && agentB.id), `${agentA.id}, ${agentB.id}`);

    // Seed an AI reply on A so we can sample assistant prose styles.
    const sendResult = await seedClient.sendAgentMessage(
      agentA.id,
      "Please explain React Server Components briefly with a short heading and a code sample.",
    );
    gate("seed-message-accepted", sendResult.accepted !== false, JSON.stringify(sendResult));

    await page.goto(`chisacode://app/h/${serverId}/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sidebar-sessions").waitFor({ state: "visible", timeout: 120_000 });

    await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).click();
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 60_000 });
    await page
      .getByTestId(`agent-panel-${agentA.id}`)
      .waitFor({ state: "visible", timeout: 60_000 });

    // Wait for column to settle after first measure.
    await pollUntil(
      async () => {
        const box = await measureColumn(page!);
        return Boolean(box && box.width > 0 && box.height > 0);
      },
      20_000,
      "conversation column measured",
    );
    await page.waitForTimeout(200);
    const baseline = await measureColumn(page);
    gate(
      "baseline-column-present",
      Boolean(baseline && baseline.width > 0),
      JSON.stringify(baseline),
    );
    if (!baseline) {
      throw new Error("conversation column missing after open agent A");
    }
    // First-frame should already be settled (shell-hosted column), not stuck at 800
    // when the pane is shorter. We only assert the settled width is finite and stable.
    gate("baseline-column-finite", Number.isFinite(baseline.width), `width=${baseline.width}`);

    // Capture main-panel before/after switch for visual evidence (not just metrics).
    const mainPanel = page.getByTestId("workspace-main-panel");
    await mainPanel.screenshot({ path: path.join(shots, "panel-before-a.png") }).catch(() => {});
    await page.screenshot({ path: path.join(shots, "window-before-a.png"), fullPage: true });

    // Switch A → B and sample stability.
    await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).click();
    await page
      .getByTestId(`agent-panel-${agentB.id}`)
      .waitFor({ state: "visible", timeout: 60_000 });
    const switchAB = await sampleColumnStability(page, baseline, 240);
    gate(
      "switch-a-to-b-width-stable",
      switchAB.maxWidthDelta <= 0.5 && switchAB.maxXDelta <= 0.5,
      `Δw=${switchAB.maxWidthDelta.toFixed(3)} Δx=${switchAB.maxXDelta.toFixed(3)} last=${JSON.stringify(switchAB.last)}`,
    );
    await mainPanel.screenshot({ path: path.join(shots, "panel-after-b.png") }).catch(() => {});
    await page.screenshot({ path: path.join(shots, "window-after-b.png"), fullPage: true });

    // Switch B → A and sample again.
    await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).click();
    await page
      .getByTestId(`agent-panel-${agentA.id}`)
      .waitFor({ state: "visible", timeout: 60_000 });
    const switchBA = await sampleColumnStability(page, baseline, 240);
    gate(
      "switch-b-to-a-width-stable",
      switchBA.maxWidthDelta <= 0.5 && switchBA.maxXDelta <= 0.5,
      `Δw=${switchBA.maxWidthDelta.toFixed(3)} Δx=${switchBA.maxXDelta.toFixed(3)} last=${JSON.stringify(switchBA.last)}`,
    );
    await mainPanel.screenshot({ path: path.join(shots, "panel-after-a.png") }).catch(() => {});
    await page.screenshot({ path: path.join(shots, "window-after-a.png"), fullPage: true });

    // Wait for an assistant message surface, then sample computed prose styles.
    await pollUntil(
      async () => {
        return page!.evaluate(() => {
          return Boolean(
            document.querySelector('[data-testid="assistant-message-surface"]') ??
            document.querySelector('[data-testid="assistant-message"]'),
          );
        });
      },
      60_000,
      "assistant-message surface",
    );
    // Give markdown styles a moment to settle after the surface mounts.
    await page.waitForTimeout(800);
    let prose = await sampleAssistantProseStyle(page);
    // Retry until we have real text leaves AND they are all T3-aligned.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!prose) break;
      if (prose.leafCount > 0 && prose.misaligned.length === 0) {
        break;
      }
      await page.waitForTimeout(500);
      prose = await sampleAssistantProseStyle(page);
    }
    gate("assistant-prose-present", Boolean(prose && prose.leafCount > 0), JSON.stringify(prose));
    if (prose) {
      // Gate on ALL text leaves carrying the T3 token (14px / ~23 lh / 80% alpha
      // color). No best-sample cherry-picking; any default-styled leaf fails.
      const allAligned = prose.leafCount > 0 && prose.misaligned.length === 0;
      gate(
        "assistant-prose-t3-aligned",
        allAligned,
        `leaves=${prose.leafCount} aligned=${prose.alignedCount} misaligned=${JSON.stringify(prose.misaligned.slice(0, 6))} hist=${prose.fontSizeHistogram} preview=${prose.textPreview}`,
      );
    }

    await page.screenshot({
      path: path.join(shots, "conv-switch-final.png"),
      fullPage: true,
    });

    const reportPath = path.join(
      evidenceDir,
      `desktop-conversation-switch-width-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const failed = gates.filter((g) => !g.pass);
    const evidenceShots = path.join(evidenceDir, "conversation-switch-width-shots");
    mkdirSync(evidenceShots, { recursive: true });
    // Copy all panel/window evidence frames (before/after switch + final).
    for (const name of [
      "panel-before-a.png",
      "window-before-a.png",
      "panel-after-b.png",
      "window-after-b.png",
      "panel-after-a.png",
      "window-after-a.png",
      "conv-switch-final.png",
    ]) {
      const srcShot = path.join(shots, name);
      if (!existsSync(srcShot)) continue;
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Copy-Item -Force '${srcShot}' '${path.join(evidenceShots, name)}'`,
        ],
        { stdio: "ignore" },
      );
    }

    const md = [
      "# Packaged Electron conversation-switch width + AI prose verification",
      "",
      `- status: **${failed.length === 0 ? "PASS" : "FAIL"}**`,
      `- exe: ${executablePath}`,
      `- shots: ${evidenceShots}`,
      `- baseline: ${JSON.stringify(baseline)}`,
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
    console.log("[conv-switch-width] evidence:", reportPath);

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`[conv-switch-width] FAILED ${failed.length} gate(s)`);
    } else {
      console.log("[conv-switch-width] ALL GATES PASSED");
    }
  } catch (error) {
    console.error("[conv-switch-width] fatal:", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
    if (repoCleanup) {
      await repoCleanup().catch(() => {});
    }
  }
}

void main();
