/**
 * Packaged Electron gate: selecting one sidebar session must NOT change the
 * rendered text width / weight / color of sibling project/session labels.
 *
 * Run from packages/app:
 *   npx tsx e2e/desktop-selection-text-width.script.ts
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
  console.log(`[selection-width] port ${port} occupied; killing stale daemon workers`);
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
        color: style.color,
        opacity: style.opacity,
        top: Math.round(rect.top * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
      };
    });
  });
}

function metricsKey(m: TextMetrics): string {
  // Position-stable key so the same visual label is matched across selection.
  return `${m.text}@@${Math.round(m.top)}`;
}

// eslint-disable-next-line complexity -- packaged gate covers seed, two views, and width sampling
async function main(): Promise<void> {
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-selection-width-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-selection-width-ud-"));
  const serverId = "srv_selection_width";
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

  function gate(name: string, pass: boolean, detail?: string): void {
    gates.push({ name, pass, detail });
    console.log(
      `[selection-width] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  }

  try {
    await ensurePortFree(6767);
    const executablePath = resolvePackagedExe();
    console.log("[selection-width] launching", executablePath);

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
    console.log("[selection-width] window url:", page.url());

    const daemonStatus = await waitForDesktopDaemon(page);
    console.log("[selection-width] daemon status:", JSON.stringify(daemonStatus).slice(0, 300));
    gate("daemon-online", true, daemonStatus.listen);

    const repo = await createTempGitRepo("selection-width-");
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
      clientId: `selection-width-seed-${randomUUID()}`,
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
    console.log("[selection-width] seeded agents", agentA.id, agentB.id, "in", repo.path);

    const route = buildAgentRoute(repo.path, agentA.id);
    await page.goto(`chisacode://app${route}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("workspace-main-panel").waitFor({ state: "visible", timeout: 120_000 });
    gate("workspace-panel-visible", true);

    await pollUntil(
      async () => {
        const a = await page!
          .getByTestId(`sidebar-v2-thread-${agentA.id}`)
          .isVisible()
          .catch(() => false);
        const b = await page!
          .getByTestId(`sidebar-v2-thread-${agentB.id}`)
          .isVisible()
          .catch(() => false);
        return a && b;
      },
      60_000,
      "both sidebar threads visible",
    );
    gate("both-threads-visible", true);

    // Force by-project for tree labels.
    const byProject = page.getByTestId("sidebar-view-by-project");
    if ((await byProject.count()) > 0) {
      await byProject.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }

    // Clear selection visually by clicking soft empty area if needed — start
    // from agent A selected (route), measure, then select B.
    await page.screenshot({ path: path.join(shots, "before-select-b.png"), fullPage: true });
    const before = await collectSidebarTextMetrics(page);
    gate("before-metrics-collected", before.length > 0, `n=${before.length}`);

    await page.getByTestId(`sidebar-v2-thread-${agentB.id}`).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, "after-select-b.png"), fullPage: true });
    const after = await collectSidebarTextMetrics(page);
    gate("after-metrics-collected", after.length > 0, `n=${after.length}`);

    const beforeByKey = new Map(before.map((m) => [metricsKey(m), m]));
    const afterByKey = new Map(after.map((m) => [metricsKey(m), m]));
    const diffs: string[] = [];
    for (const [key, prev] of beforeByKey) {
      const next = afterByKey.get(key);
      if (!next) continue;
      // Skip the row we intentionally selected (its bg can change; still assert
      // width/weight/size/color/opacity for unselected siblings primarily).
      if (prev.text.includes("Selection width probe B")) continue;
      const widthDelta = Math.abs(next.width - prev.width);
      const weightChanged = next.fontWeight !== prev.fontWeight;
      const sizeChanged = next.fontSize !== prev.fontSize;
      const colorChanged = next.color !== prev.color;
      const opacityChanged = next.opacity !== prev.opacity;
      if (widthDelta > 0.5 || weightChanged || sizeChanged || colorChanged || opacityChanged) {
        diffs.push(
          `${prev.text} width ${prev.width}->${next.width} (Δ${widthDelta.toFixed(2)}) weight ${prev.fontWeight}->${next.fontWeight} size ${prev.fontSize}->${next.fontSize} color ${prev.color}->${next.color} opacity ${prev.opacity}->${next.opacity}`,
        );
      }
    }

    gate(
      "sibling-text-metrics-stable",
      diffs.length === 0,
      diffs.length === 0 ? "no metric drift" : diffs.slice(0, 10).join(" | "),
    );

    const titleABefore = before.find((m) => m.text.includes("Selection width probe A"));
    const titleAAfter = after.find((m) => m.text.includes("Selection width probe A"));
    if (titleABefore && titleAAfter) {
      const d = Math.abs(titleAAfter.width - titleABefore.width);
      gate(
        "unselected-agent-a-title-width-stable",
        d <= 0.5 &&
          titleABefore.fontWeight === titleAAfter.fontWeight &&
          titleABefore.fontSize === titleAAfter.fontSize &&
          titleABefore.color === titleAAfter.color &&
          titleABefore.opacity === titleAAfter.opacity,
        `${titleABefore.width}->${titleAAfter.width} weight ${titleABefore.fontWeight}->${titleAAfter.fontWeight} size ${titleABefore.fontSize}->${titleAAfter.fontSize} color ${titleABefore.color}->${titleAAfter.color} opacity ${titleABefore.opacity}->${titleAAfter.opacity}`,
      );
    } else {
      gate(
        "unselected-agent-a-title-width-stable",
        false,
        `missing metrics before=${Boolean(titleABefore)} after=${Boolean(titleAAfter)}`,
      );
    }

    // Also measure project group label if present.
    const projectBefore = before.find((m) => /selection-width/i.test(m.text));
    const projectAfter = after.find((m) => m.text === projectBefore?.text);
    if (projectBefore && projectAfter) {
      const d = Math.abs(projectAfter.width - projectBefore.width);
      gate(
        "project-label-width-stable",
        d <= 0.5 &&
          projectBefore.fontWeight === projectAfter.fontWeight &&
          projectBefore.color === projectAfter.color,
        `${projectBefore.text} ${projectBefore.width}->${projectAfter.width} weight ${projectBefore.fontWeight}->${projectAfter.fontWeight}`,
      );
    } else {
      gate("project-label-width-stable", true, "project label not found (non-fatal)");
    }

    const reportPath = path.join(
      evidenceDir,
      `desktop-selection-text-width-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
    const failed = gates.filter((g) => !g.pass);
    // Copy shots into evidence for durable inspection.
    const evidenceShots = path.join(evidenceDir, "selection-text-width-shots");
    mkdirSync(evidenceShots, { recursive: true });
    for (const name of ["before-select-b.png", "after-select-b.png"]) {
      const src = path.join(shots, name);
      const dst = path.join(evidenceShots, name);
      if (existsSync(src)) {
        spawnSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `Copy-Item -Force '${src}' '${dst}'`],
          {
            stdio: "ignore",
          },
        );
      }
    }

    const md = [
      "# Packaged Electron sidebar selection text-width verification",
      "",
      `- status: **${failed.length === 0 ? "PASS" : "FAIL"}**`,
      `- exe: ${executablePath}`,
      `- shots: ${evidenceShots}`,
      `- before metrics: ${before.length}`,
      `- after metrics: ${after.length}`,
      "",
      "## Gates",
      ...gates.map(
        (g) => `- ${g.pass ? "PASS" : "FAIL"} ${g.name}${g.detail ? `: ${g.detail}` : ""}`,
      ),
      "",
      "## Diffs (sibling labels)",
      ...(diffs.length === 0 ? ["- (none)"] : diffs.map((d) => `- ${d}`)),
      "",
      "## Before sample",
      "```json",
      JSON.stringify(before.slice(0, 16), null, 2),
      "```",
      "",
      "## After sample",
      "```json",
      JSON.stringify(after.slice(0, 16), null, 2),
      "```",
      "",
    ].join("\n");
    writeFileSync(reportPath, md, "utf8");
    console.log(`[selection-width] report: ${reportPath}`);
    if (failed.length > 0) {
      process.exitCode = 1;
      console.log("[selection-width] FAILED");
    } else {
      console.log("[selection-width] ALL GATES PASSED");
    }
  } catch (error) {
    console.error("[selection-width] FAILED:", error);
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
