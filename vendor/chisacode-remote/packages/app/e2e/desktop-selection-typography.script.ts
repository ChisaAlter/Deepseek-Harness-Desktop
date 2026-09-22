/**
 * Packaged Electron gate: selection / view-switch must not change the
 * rendered text width / weight / size of sibling labels, and the by-status
 * view must keep the same typography as the by-project view.
 *
 * Covers what desktop-selection-text-width.script.ts does not: the by-status
 * (T3 card) view, plus the "nothing selected" (soft home) state.
 *
 * Run from packages/app:
 *   npx tsx e2e/desktop-selection-typography.script.ts
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
  console.log(`[selection-typography] port ${port} occupied; killing stale daemon workers`);
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

interface TextMetrics {
  text: string;
  width: number;
  height: number;
  fontWeight: string;
  fontSize: string;
  fontFamily: string;
  color: string;
  opacity: string;
  top: number;
  left: number;
}

async function collectSidebarTextMetrics(page: Page): Promise<TextMetrics[]> {
  return page.evaluate(() => {
    const sidebar =
      document.querySelector('[data-testid="desktop-left-sidebar"]') ??
      document.querySelector('[data-testid="sidebar-sessions"]') ??
      document.body;
    const nodes = Array.from(sidebar.querySelectorAll("*")).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.children.length > 0) return false;
      const text = (el.textContent ?? "").trim();
      if (!text || text.length < 2) return false;
      if (
        /^(新对话|搜索会话|项目|状态|所有项目|Sessions|Snoozed|Settled|now|\d+[mhd]|DESKTOP-)/.test(
          text,
        )
      ) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      return true;
    });

    return nodes.slice(0, 60).map((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? "").trim().slice(0, 100),
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: style.color,
        opacity: style.opacity,
        top: Math.round(rect.top * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
      };
    });
  });
}

function metricsKey(m: TextMetrics): string {
  return `${m.text}@@${Math.round(m.top)}`;
}

// eslint-disable-next-line complexity -- e2e gate covers seeding, two views, and selection states
async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-typography-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-typography-ud-"));
  const serverId = "srv_typography";
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
  const captured: { name: string; state: string }[] = [];
  const crashLog: string[] = [];

  function gate(name: string, pass: boolean, detail?: string): void {
    gates.push({ name, pass, detail });
    console.log(
      `[selection-typography] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  }

  async function instrumentCrashes(app: ElectronApplication, targetPage: Page): Promise<void> {
    app.on("child-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`child-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    app.on("render-process-gone" as "window", (...args: unknown[]) => {
      crashLog.push(`render-process-gone ${JSON.stringify(args).slice(0, 200)}`);
    });
    targetPage.on("crash", () => crashLog.push("page crash event"));
    targetPage.on("console", (msg) => {
      if (msg.type() === "error") {
        crashLog.push(`renderer error: ${msg.text().slice(0, 300)}`);
      }
    });
    targetPage.on("pageerror", (error) => {
      crashLog.push(`pageerror: ${String(error).slice(0, 300)}`);
    });
  }

  async function shoot(name: string): Promise<void> {
    if (!page) return;
    const sidebar = page.getByTestId("desktop-left-sidebar");
    try {
      await sidebar.screenshot({ path: path.join(shots, `${name}-sidebar.png`) });
    } catch {
      // sidebar element may not be mounted on this surface; window shot covers it
    }
    await page.screenshot({ path: path.join(shots, `${name}-window.png`), fullPage: true });
    captured.push({ name, state: `${name}` });
  }

  function compareSiblings(
    before: TextMetrics[],
    after: TextMetrics[],
    skipText: string,
  ): string[] {
    const beforeByKey = new Map(before.map((m) => [metricsKey(m), m]));
    const afterByKey = new Map(after.map((m) => [metricsKey(m), m]));
    const diffs: string[] = [];
    for (const [key, prev] of beforeByKey) {
      const next = afterByKey.get(key);
      if (!next) continue;
      if (prev.text.includes(skipText)) continue;
      const widthDelta = Math.abs(next.width - prev.width);
      const weightChanged = next.fontWeight !== prev.fontWeight;
      const sizeChanged = next.fontSize !== prev.fontSize;
      const familyChanged = next.fontFamily !== prev.fontFamily;
      const colorChanged = next.color !== prev.color;
      const opacityChanged = next.opacity !== prev.opacity;
      if (
        widthDelta > 0.5 ||
        weightChanged ||
        sizeChanged ||
        familyChanged ||
        colorChanged ||
        opacityChanged
      ) {
        diffs.push(
          `${prev.text} width ${prev.width}->${next.width} (Δ${widthDelta.toFixed(2)}) weight ${prev.fontWeight}->${next.fontWeight} size ${prev.fontSize}->${next.fontSize} family ${prev.fontFamily}->${next.fontFamily} color ${prev.color}->${next.color} opacity ${prev.opacity}->${next.opacity}`,
        );
      }
    }
    return diffs;
  }

  try {
    await ensurePortFree(6767);
    const executablePath = resolvePackagedExe();
    console.log("[selection-typography] launching", executablePath);

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
    console.log("[selection-typography] window url:", page.url());
    await instrumentCrashes(electronApp, page);

    const daemonStatus = await waitForDesktopDaemon(page);
    console.log(
      "[selection-typography] daemon status:",
      JSON.stringify(daemonStatus).slice(0, 300),
    );
    gate("daemon-online", true, daemonStatus.listen);

    const repo = await createTempGitRepo("typography-");
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
      clientId: `typography-seed-${randomUUID()}`,
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
      title: "Selection width probe A",
    });
    const agentB = await seedClient.createAgent({
      provider: "mock",
      cwd: repo.path,
      model: "echo",
      title: "Selection width probe B",
    });
    gate("seed-agents", Boolean(agentA.id && agentB.id), `${agentA.id}, ${agentB.id}`);
    console.log("[selection-typography] seeded agents", agentA.id, agentB.id, "in", repo.path);

    // ── State 1: soft home (nothing selected), by-project ─────────────────
    await page.goto(`chisacode://app/h/${serverId}/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sidebar-sessions").waitFor({ state: "visible", timeout: 120_000 });
    await page.waitForTimeout(800);
    await shoot("s1-home-by-project");
    const s1 = await collectSidebarTextMetrics(page);
    gate("s1-home-metrics", s1.length > 0, `n=${s1.length}`);

    // ── State 2: click agent A → by-project selected ──────────────────────
    await page.getByTestId(`sidebar-v2-thread-${agentA.id}`).click();
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(600);
    await shoot("s2-selected-a-by-project");
    const s2 = await collectSidebarTextMetrics(page);
    gate("s2-selected-metrics", s2.length > 0, `n=${s2.length}`);

    const byProjectDiffs = compareSiblings(s1, s2, "Selection width probe A");
    gate(
      "by-project-siblings-stable-on-select",
      byProjectDiffs.length === 0,
      byProjectDiffs.length === 0 ? "no metric drift" : byProjectDiffs.slice(0, 10).join(" | "),
    );

    // ── State 3: switch to 状态 tab (by-status) ────────────────────────────
    const byStatusTab = page.getByTestId("sidebar-view-by-status");
    if ((await byStatusTab.count()) > 0) {
      await byStatusTab.click();
      await page.waitForTimeout(600);
    }
    await page.getByTestId("sidebar-status-view").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(500);
    await shoot("s3-by-status-selected-a");
    const s3 = await collectSidebarTextMetrics(page);
    gate("s3-by-status-metrics", s3.length > 0, `n=${s3.length}`);

    // ── State 4: back to home → by-status, nothing selected ───────────────
    await page.goto(`chisacode://app/h/${serverId}/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sidebar-status-view").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(800);
    await shoot("s4-home-by-status");
    const s4 = await collectSidebarTextMetrics(page);
    gate("s4-home-by-status-metrics", s4.length > 0, `n=${s4.length}`);

    // ── State 5: click agent B → by-status selected ───────────────────────
    await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).click();
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(600);
    await shoot("s5-selected-b-by-status");
    const s5 = await collectSidebarTextMetrics(page);
    gate("s5-by-status-selected-metrics", s5.length > 0, `n=${s5.length}`);

    const byStatusDiffs = compareSiblings(s4, s5, "Selection width probe B");
    gate(
      "by-status-siblings-stable-on-select",
      byStatusDiffs.length === 0,
      byStatusDiffs.length === 0 ? "no metric drift" : byStatusDiffs.slice(0, 10).join(" | "),
    );

    // ── Cross-view typography: by-status calibrated to roadmap 57-62 spec ──
    const projectTitle = s2.find((m) => m.text.includes("Selection width probe A"));
    const statusTitle = s3.find((m) => m.text.includes("Selection width probe A"));
    const homeProjectTitle = s1.find((m) => m.text.includes("Selection width probe A"));
    if (projectTitle && statusTitle) {
      // Roadmap 「侧栏 项目/状态 视图字体校准」: card title 13px medium, project
      // name 12.5px muted — both views keep their own structure but the
      // by-status typography must match the calibrated spec exactly.
      const calibrated = statusTitle.fontSize === "13px" && statusTitle.fontWeight === "500";
      gate(
        "by-status-title-calibrated",
        calibrated,
        `status ${statusTitle.fontSize}/${statusTitle.fontWeight} (spec 13px/500)`,
      );
      const projectName = s3.find(
        (m) => m.text.startsWith("typography-") || m.text.startsWith("drift-"),
      );
      if (projectName) {
        gate(
          "by-status-project-name-calibrated",
          projectName.fontSize === "12.5px" && projectName.fontWeight === "500",
          `project ${projectName.fontSize}/${projectName.fontWeight} (spec 12.5px/500)`,
        );
      }
    } else {
      gate("by-status-title-calibrated", false, "title metrics missing in one view");
    }
    if (homeProjectTitle && projectTitle) {
      const d = Math.abs(projectTitle.width - homeProjectTitle.width);
      gate(
        "by-project-title-width-stable-home-vs-selected",
        d <= 0.5 &&
          homeProjectTitle.fontWeight === projectTitle.fontWeight &&
          homeProjectTitle.fontSize === projectTitle.fontSize &&
          homeProjectTitle.opacity === projectTitle.opacity,
        `home ${homeProjectTitle.width} -> selected ${projectTitle.width} weight ${homeProjectTitle.fontWeight}->${projectTitle.fontWeight} size ${homeProjectTitle.fontSize}->${projectTitle.fontSize} opacity ${homeProjectTitle.opacity}->${projectTitle.opacity}`,
      );
    }

    const reportPath = path.join(
      evidenceDir,
      `desktop-selection-typography-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const failed = gates.filter((g) => !g.pass);
    const evidenceShots = path.join(evidenceDir, "selection-typography-shots");
    mkdirSync(evidenceShots, { recursive: true });
    for (const shot of captured) {
      for (const suffix of ["sidebar", "window"]) {
        const src = path.join(shots, `${shot.name}-${suffix}.png`);
        const dst = path.join(evidenceShots, `${shot.name}-${suffix}.png`);
        if (existsSync(src)) {
          spawnSync(
            "powershell.exe",
            ["-NoProfile", "-Command", `Copy-Item -Force '${src}' '${dst}'`],
            { stdio: "ignore" },
          );
        }
      }
    }

    const md = [
      "# Packaged Electron sidebar selection/view typography verification",
      "",
      `- status: **${failed.length === 0 ? "PASS" : "FAIL"}**`,
      `- exe: ${executablePath}`,
      `- shots: ${evidenceShots}`,
      "",
      "## Gates",
      ...gates.map(
        (g) => `- ${g.pass ? "PASS" : "FAIL"} ${g.name}${g.detail ? `: ${g.detail}` : ""}`,
      ),
      "",
      "## State samples",
      "",
      "### s1 home by-project",
      "```json",
      JSON.stringify(s1.slice(0, 12), null, 2),
      "```",
      "",
      "### s3 by-status selected A",
      "```json",
      JSON.stringify(s3.slice(0, 12), null, 2),
      "```",
      "",
    ].join("\n");
    writeFileSync(reportPath, md, "utf8");
    console.log(`[selection-typography] report: ${reportPath}`);
    if (failed.length > 0) {
      process.exitCode = 1;
      console.log("[selection-typography] FAILED");
    } else {
      console.log("[selection-typography] ALL GATES PASSED");
    }
  } catch (error) {
    console.error("[selection-typography] FAILED:", error);
    if (crashLog.length > 0) {
      console.error("[selection-typography] crash diagnostics:");
      for (const line of crashLog.slice(-25)) {
        console.error(`  ${line}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close().catch(() => undefined);
    }
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
    if (repoCleanup) {
      await repoCleanup().catch(() => undefined);
    }
  }
}

main();
