/**
 * Real-surface observation of optimistic sidebar row appearance.
 *
 * Launches the packaged exe with the USER's real home + userData and a CDP
 * debugging port, drives a real send through the Soft Home draft composer, and
 * samples the sidebar DOM at high frequency to determine whether/where the
 * optimistic row appears and when the authoritative row lands.
 *
 * Run: npx tsx e2e/desktop-sidebar-optimistic-observe.script.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { _electron, type ElectronApplication } from "playwright";
import { expect } from "@playwright/test";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";
import { buildHostNewWorkspaceRoute } from "../src/utils/host-routes";

import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");
const CDP_PORT = 9223;

interface Sample {
  atMs: number;
  rows: { title: string; group: string; testid: string }[];
}

function log(message: string): void {
  console.log(`[observe] ${message}`);
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main(): Promise<void> {
  const home = homedir() + "/.chisacode"; // real user home
  const userData = path.join(homedir(), "AppData", "Roaming", "ChisaCode"); // real userData
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(
    evidenceDir,
    `desktop-sidebar-optimistic-observe-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  const promptText = `观察侧栏 ${Date.now()}`;
  const samples: Sample[] = [];
  let app: ElectronApplication | null = null;

  try {
    app = await _electron.launch({
      executablePath: packagedExe,
      args: [`--remote-debugging-port=${CDP_PORT}`],
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_ELECTRON_USER_DATA_DIR: userData,
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_RELAY_ENABLED: "0",
      },
    });

    const page = await app.firstWindow();
    page.setDefaultTimeout(60_000);
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 });
    log(`window url=${page.url()}`);

    // Wait for daemon.
    const statusHolder: { value: { listen?: string; serverId?: string } | null } = {
      value: null,
    };
    await pollUntil(
      async () => {
        const status = await page.evaluate(async () => {
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
              listen?: string;
              serverId?: string;
            };
          } catch {
            return null;
          }
        });
        statusHolder.value = status;
        return Boolean(status?.listen);
      },
      120_000,
      "daemon online",
    );
    const serverId = statusHolder.value?.serverId || "local";
    log(`daemon online serverId=${serverId}`);

    // Open the pi-desktop project's soft home so the composer has a workspace.
    const repo = await createTempGitRepo("observe-sidebar-");
    const DaemonClient = (
      await import(pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href)
    ).DaemonClient as new (config: Record<string, unknown>) => {
      connect(): Promise<void>;
      close(): Promise<void>;
      openProject(cwd: string): Promise<{ workspace: { id: string } | null; error: string | null }>;
    };
    const client = new DaemonClient({
      url: `ws://${statusHolder.value!.listen}/ws`,
      clientId: `observe-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.2",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await client.connect();
    const opened = await client.openProject(repo.path);
    log(`opened project workspace=${opened.workspace?.id}`);

    const softHomeRoute = buildHostNewWorkspaceRoute(serverId, repo.path);
    await page.goto(`chisacode://app${softHomeRoute}`, { waitUntil: "domcontentloaded" });
    const composer = page
      .getByRole("textbox", { name: /^(Message agent\.\.\.|给智能体发消息.*)$/ })
      .first();
    await composer.waitFor({ state: "visible", timeout: 120_000 }).catch(() => undefined);
    await expect(composer).toBeEditable({ timeout: 120_000 });
    log("soft-home composer ready");

    // Dump composer model selector state.
    const modelTrigger = page.getByTestId("combined-model-selector").first();
    const modelText = (await modelTrigger.textContent().catch(() => "")) ?? "";
    log(`model selector text: ${JSON.stringify(modelText)}`);

    // Wait for the model to become ready (snapshot loading can take a while in
    // this environment; the composer blocks send without a model).
    try {
      await pollUntil(
        async () => {
          const text = (await modelTrigger.textContent().catch(() => "")) ?? "";
          return text.length > 0 && !/select|选择/.test(text);
        },
        90_000,
        "model ready",
      );
      log(
        `model ready: ${JSON.stringify((await modelTrigger.textContent().catch(() => "")) ?? "")}`,
      );
    } catch {
      log("model never became ready; attempting send anyway");
    }

    // Sample helper: dump sidebar rows with their group.
    const sampleSidebar = async (atMs: number): Promise<void> => {
      const rows = await page
        .evaluate(() => {
          const out: { title: string; group: string; testid: string }[] = [];
          const groups = Array.from(
            document.querySelectorAll('[data-testid^="sidebar-session-group-toggle-"]'),
          );
          for (const g of groups) {
            const groupKey = (g.getAttribute("data-testid") ?? "").replace(
              "sidebar-session-group-toggle-",
              "",
            );
            // walk siblings: rows are sidebar-v2-thread elements
            const root = g.parentElement?.parentElement?.parentElement;
            const threads = root?.querySelectorAll('[data-testid^="sidebar-v2-thread-"]') ?? [];
            for (const t of threads) {
              out.push({
                title: (t.textContent ?? "").trim().slice(0, 40),
                group: groupKey,
                testid: (t.getAttribute("data-testid") ?? "")
                  .replace("sidebar-v2-thread-", "")
                  .slice(0, 12),
              });
            }
          }
          return out;
        })
        .catch(() => []);
      samples.push({ atMs, rows });
      log(
        `t+${atMs}ms rows=${rows.length} ${rows
          .map((r) => `${r.title.slice(0, 10)}@${r.group.slice(0, 16)}#${r.testid}`)
          .join(" | ")}`,
      );
    };

    await sampleSidebar(0);
    const sendStarted = Date.now();
    await composer.fill(promptText);
    await composer.press("Enter");

    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await sampleSidebar(Date.now() - sendStarted);
    }

    // Wait for the authoritative row to appear too (agent_update).
    await pollUntil(
      async () => {
        const count = await page
          .getByText(promptText, { exact: false })
          .count()
          .catch(() => 0);
        return count > 0;
      },
      30_000,
      "sidebar row",
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sampleSidebar(Date.now() - sendStarted);

    // Screenshot.
    const shots = path.join(tmpdir(), "observe-shots");
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, "final-sidebar.png"), fullPage: true });
    log(`screenshot: ${path.join(shots, "final-sidebar.png")}`);

    // Daemon create evidence.
    let daemonCreates: string[] = [];
    try {
      const raw = readFileSync(path.join(home, "daemon.log"), "utf8");
      daemonCreates = raw
        .split(/\r?\n/)
        .filter((l) => l.includes("Created agent"))
        .map((l) => (l.match(/Created agent ([0-9a-f-]{36})/i)?.[1] ?? "").slice(0, 12))
        .filter(Boolean)
        .slice(-5);
    } catch {
      // ignore
    }

    const lines = [
      `# Optimistic sidebar row observation`,
      ``,
      `- time: ${new Date().toISOString()}`,
      `- serverId: ${serverId}`,
      `- prompt: ${promptText}`,
      `- model selector: ${JSON.stringify(modelText)}`,
      `- screenshot: ${path.join(shots, "final-sidebar.png")}`,
      ``,
      `## Sidebar samples`,
      ``,
      ...samples.map(
        (s) =>
          `- t+${s.atMs}ms: ${
            s.rows
              .map((r) => `${r.title.slice(0, 14)} @ ${r.group.slice(0, 20)} #${r.testid}`)
              .join(" | ") || "(empty)"
          }`,
      ),
      ``,
      `## Daemon creates (last 5)`,
      ``,
      `- ${daemonCreates.join("\n- ") || "none"}`,
    ];
    writeFileSync(evidencePath, lines.join("\n"));
    log(`evidence: ${evidencePath}`);

    await client.close();
  } finally {
    await app?.close().catch(() => undefined);
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
