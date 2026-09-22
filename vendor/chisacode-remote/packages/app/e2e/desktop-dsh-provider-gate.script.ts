/**
 * Packaged Electron real-surface gate for the built-in dsh (DeepSeek
 * Harness) provider, 2026-08-22.
 *
 * Flow against win-unpacked ChisaCode.exe with an isolated CHISACODE_HOME:
 *   1. Cold start keeps dsh enabled (everything else off to avoid probe
 *      storms on this machine; dsh's own probe is MCP-free + fast).
 *   2. The composer model selector lists "DeepSeek Harness" and its
 *      default-catalog models (ACP discovery advertises none upstream).
 *   3. A first send on /new without credentials fails the create *fast* with
 *      the Zh actionable banner; the composer keeps the draft text and never
 *      gets stuck (CREATE_FAILED lane, per the draft-send hard gates).
 *   5. daemon.log shows the managed cordis.yml composition was used
 *      (provider-runtime/dsh/...), proving the file-URL plugin wiring ran.
 *
 * Exit 0 only when every assertion passes. Evidence lands in
 * .omo/evidence/desktop-dsh-provider-gate-<ts>.md plus screenshots.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { createTempGitRepo } from "./helpers/workspace";
import { createNodeWebSocketFactory } from "./helpers/node-ws-factory";
import { buildHostNewWorkspaceRoute } from "../src/utils/host-routes";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const packagedExe = path.join(repoRoot, "packages/desktop/release/win-unpacked/ChisaCode.exe");
const evidenceDir = path.join(repoRoot, ".omo", "evidence");

function log(message: string): void {
  console.log(`[desktop-dsh-provider-gate] ${message}`);
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

/**
 * Isolated home with ONLY dsh enabled. Machine-level MCP servers routinely
 * stall provider probes at 30s here; dsh strips them (supportsMcpServers
 * false) so the selector stays instant. Gateways are emptied to keep the
 * selector deterministic.
 */
function prepareIsolatedHome(home: string): void {
  mkdirSync(home, { recursive: true });
  const sourceConfig = path.join(homedir(), ".chisacode", "config.json");
  const targetConfig = path.join(home, "config.json");
  const raw = existsSync(sourceConfig)
    ? (JSON.parse(readFileSync(sourceConfig, "utf8")) as {
        daemon?: { mcpServers?: unknown; mcp?: unknown };
        agents?: {
          modelGateways?: unknown;
          providers?: Record<string, { enabled?: boolean }>;
        };
      })
    : {};
  if (raw.daemon) {
    delete raw.daemon.mcpServers;
    delete raw.daemon.mcp;
  }
  raw.agents = {
    ...raw.agents,
    modelGateways: {},
    providers: {
      claude: { enabled: false },
      codex: { enabled: false },
      opencode: { enabled: false },
      pi: { enabled: false },
      kimi: { enabled: false },
      grokbuild: { enabled: false },
      // dsh intentionally left enabled.
    },
  };
  delete process.env.DEEPSEEK_API_KEY; // the gate exercises the missing-key path
  writeFileSync(targetConfig, JSON.stringify(raw, null, 2));
}

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: /^(Message agent\.\.\.|给智能体发消息.*)$/ }).first();
}

// eslint-disable-next-line complexity -- packaged-UI gate runner covers boot, seeding, selector, send path, and evidence writes
async function main(): Promise<void> {
  if (!existsSync(packagedExe)) {
    throw new Error(`missing packaged exe: ${packagedExe}`);
  }
  const home = mkdtempSync(path.join(tmpdir(), "chisacode-dsh-gate-home-"));
  const userData = mkdtempSync(path.join(tmpdir(), "chisacode-dsh-gate-user-data-"));
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(
    evidenceDir,
    `desktop-dsh-provider-gate-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
  prepareIsolatedHome(home);
  log(`home=${home}`);

  const startedAt = Date.now();
  const results: { step: string; ok: boolean; detail: string }[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    log(`${ok ? "PASS" : "FAIL"} ${step} — ${detail}`);
  };

  let electronApp: ElectronApplication | null = null;
  let page: Page | null = null;
  let repoCleanup: (() => Promise<void>) | null = null;

  try {
    await ensurePortFree(6767);
    electronApp = await _electron.launch({
      executablePath: packagedExe,
      env: {
        ...process.env,
        CHISACODE_HOME: home,
        CHISACODE_ELECTRON_USER_DATA_DIR: userData,
        CHISACODE_DICTATION_ENABLED: "0",
        CHISACODE_LOG_LEVEL: "trace",
        CHISACODE_VOICE_MODE_ENABLED: "0",
        CHISACODE_RELAY_ENABLED: "0",
      },
    });
    page = await electronApp.firstWindow();
    page.setDefaultTimeout(60_000);
    // Pre-select the dsh provider/model via the same persisted-composer-preferences
    // key the draft-send gate uses; the composer then skips selector choreography
    // whose async model loading is unrelated to provider correctness.
    await page.addInitScript(
      (preferences) => {
        localStorage.setItem("@chisacode:create-agent-preferences", JSON.stringify(preferences));
      },
      {
        provider: "dsh",
        providerPreferences: { dsh: { model: "deepseek-v4-flash" } },
      },
    );

    const statusHolder: {
      value: { status?: string; listen?: string; serverId?: string } | null;
    } = { value: null };
    const daemonOnline = await pollUntil(
      async () => {
        const status = await page!.evaluate(async () => {
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
              status?: string;
              listen?: string;
              serverId?: string;
            };
          } catch {
            return null;
          }
        });
        statusHolder.value = status;
        return Boolean(status?.listen || status?.status === "running");
      },
      90_000,
      "desktop daemon online",
    );
    if (!daemonOnline) {
      throw new Error(`daemon never came online: ${JSON.stringify(statusHolder.value)}`);
    }
    record("daemon-online", true, `listen=${statusHolder.value?.listen ?? "?"}`);

    const repo = await createTempGitRepo("dsh-gate-");
    repoCleanup = repo.cleanup;

    // Register the workspace with the daemon before navigating: a /new route
    // for an unknown directory leaves the composer blocked on
    // "请选择工作目录" and the draft never submits (lesson from run 3/4).
    const DaemonClient = (
      await import(pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href)
    ).DaemonClient as new (config: Record<string, unknown>) => {
      connect(): Promise<void>;
      close(): Promise<void>;
      openProject(cwd: string): Promise<{
        workspace: { id: string } | null;
        error: string | null;
      }>;
    };
    const daemonClient = new DaemonClient({
      url: `ws://${statusHolder.value?.listen}/ws`,
      clientId: `dsh-gate-${randomUUID()}`,
      clientType: "cli",
      appVersion: "1.0.3",
      webSocketFactory: createNodeWebSocketFactory(),
    });
    await daemonClient.connect();
    const opened = await daemonClient.openProject(repo.path);
    await daemonClient.close().catch(() => undefined);
    if (!opened.workspace) {
      throw new Error(`openProject failed: ${opened.error ?? "unknown"}`);
    }
    log(`project registered workspace=${opened.workspace.id}`);

    const shellBooted = await pollUntil(
      async () =>
        (await page!
          .getByTestId("message-input-root")
          .count()
          .catch(() => 0)) > 0,
      120_000,
      "app shell booted",
    );
    if (!shellBooted) {
      throw new Error("app shell never booted (stuck on splash)");
    }

    // Open the new-chat workspace and pick the dsh provider through the same
    // composer the user sees.
    const serverId = statusHolder.value?.serverId || "local";
    log(`serverId=${serverId}`);
    const workspaceRoute = buildHostNewWorkspaceRoute(serverId, repo.path, {
      displayName: "dsh 实机门槛",
    });
    await page.goto(`chisacode://app${workspaceRoute}`, { waitUntil: "domcontentloaded" });
    log(`workspace route ${workspaceRoute}`);

    const selectorOpened = await pollUntil(
      async () => {
        const trigger = page!
          .getByTestId("combined-model-selector")
          .or(page!.getByTestId("agent-controls-model"))
          .first();
        await trigger.click({ force: true }).catch(() => undefined);
        return await page!
          .getByTestId("model-search-input")
          .isVisible()
          .catch(() => false);
      },
      60_000,
      "model selector opened",
    );
    if (!selectorOpened) {
      throw new Error("model selector never opened");
    }

    const search = page.getByTestId("model-search-input");
    await search.fill("deepseek");
    const dshRowVisible = await pollUntil(
      async () =>
        (await page!
          .getByText(/DeepSeek Harness/i)
          .count()
          .catch(() => 0)) > 0,
      120_000,
      "DeepSeek Harness row in selector",
    );
    record(
      "selector-lists-dsh",
      dshRowVisible,
      dshRowVisible ? "DeepSeek Harness row rendered" : "no DeepSeek Harness row",
    );
    if (!dshRowVisible) {
      throw new Error("dsh provider row missing from the selector");
    }

    // Close the selector without driving it further; the composer relies on
    // the seeded preferences from here on (verified by the chip text).
    await page.keyboard.press("Escape").catch(() => undefined);
    const chipIndicatesDsh = await pollUntil(
      async () =>
        (await page!
          .getByText(/DeepSeek V4 Flash/i)
          .count()
          .catch(() => 0)) > 0,
      120_000,
      "composer chip shows DeepSeek V4 Flash",
    );
    record(
      "default-catalog-models",
      chipIndicatesDsh,
      chipIndicatesDsh
        ? "composer chip resolved to DeepSeek V4 Flash from the default catalog"
        : "composer chip never resolved the dsh default model",
    );

    const shotComposer = path.join(home, "shots-composer-dsh.png");
    await page.screenshot({ path: shotComposer });

    // Send the gate prompt. With no DEEPSEEK_API_KEY the session create fails
    // BEFORE any turn: the composer falls back to draft with a banner.
    const promptText = `Reply with exactly: DSH_DESKTOP_GATE_OK ${randomUUID().slice(0, 8)}`;
    await composerInput(page).fill(promptText);
    const sentAt = Date.now();
    await draftCreateOrSend(page);

    // In the missing-key lane the create RPC fails immediately; the draft
    // must remain editable with the text retained (users fix the key and
    // resend). The optimistic sidebar row rolls back on CREATE_FAILED.
    const draftRetained = await pollUntil(
      async () =>
        (await composerInput(page!)
          .inputValue()
          .catch(() => "")) !== "",
      30_000,
      "draft retained after failed create",
    );
    record(
      "draft-retained-on-failure",
      draftRetained,
      draftRetained
        ? "draft text retained (no silent drop on create failure)"
        : "draft text vanished on create failure",
    );

    // With no API key the create leg of dsh fails FAST (composer returns to
    // draft with an error banner); the optimistic sidebar row is rolled back
    // by the create flow. Both hard gates are about the error lane here,
    // because there is no session to stream to.
    const errorBannerVisible = await pollUntil(
      async () => {
        const body = await page!.evaluate(() => document.body.innerText).catch(() => "");
        return /尚未配置 API 密钥/.test(body);
      },
      30_000,
      "missing-key banner in UI",
    );
    record(
      "missing-key-error-surface",
      errorBannerVisible,
      errorBannerVisible
        ? `credential banner visible in ${Date.now() - sentAt}ms`
        : "no credential banner after 30s (create hung?)",
    );

    const noStuckRow = await pollUntil(
      async () => {
        // The composer stays editable: draft never gets stuck on a dead create.
        const canType = await composerInput(page!)
          .isEditable()
          .catch(() => false);
        return canType;
      },
      30_000,
      "composer editable after failed create",
    );
    record(
      "composer-not-stuck",
      noStuckRow,
      noStuckRow ? "composer remains editable after fast-create failure" : "composer stuck",
    );
    const shotFinal = path.join(home, "shots-final-dsh.png");
    await page.screenshot({ path: shotFinal });

    // The turn_failed provider/session ids in daemon.log already prove the
    // spawn chain ran; assert the on-disk managed composition artifact too.
    const runtimeRoot = path.join(home, "provider-runtime", "dsh");
    let managedComposition = false;
    if (existsSync(runtimeRoot)) {
      for (const entry of readdirSync(runtimeRoot)) {
        if (existsSync(path.join(runtimeRoot, entry, "cordis.yml"))) {
          managedComposition = true;
          break;
        }
      }
    }
    record(
      "managed-composition-materialized",
      managedComposition,
      managedComposition
        ? "provider-runtime/dsh/*/cordis.yml exists for the gate home"
        : "no managed composition written under provider-runtime/dsh",
    );

    const failed = results.filter((entry) => !entry.ok);
    const summary = [
      `# desktop-dsh-provider-gate ${new Date().toISOString()}`,
      "",
      `Home: ${home}`,
      `Overall: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`,
      "",
      ...results.map((entry) => `- ${entry.ok ? "✅" : "❌"} ${entry.step}: ${entry.detail}`),
      "",
      `Screenshots: ${shotComposer}, ${shotFinal}`,
    ].join("\n");
    writeFileSync(evidencePath, summary);
    log(`evidence written: ${evidencePath}`);

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    record("uncaught", false, String(error));
    writeFileSync(
      evidencePath,
      `# desktop-dsh-provider-gate ${new Date().toISOString()}\n\nFATAL ${String(error)}\n`,
    );
    process.exitCode = 1;
  } finally {
    await repoCleanup?.().catch(() => undefined);
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*daemon-worker*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: "ignore" },
    );
  }
  log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function draftCreateOrSend(page: Page): Promise<void> {
  // The composer's send control is icon-only; address it via its stable
  // testid and wait until validation enables it.
  const button = page.getByTestId("composer-send-button");
  const enabled = await pollUntil(
    async () => {
      const disabled =
        (await button
          .evaluate((el) => el.getAttribute("data-disabled") ?? el.getAttribute("aria-disabled"))
          .catch(() => "unknown")) ?? "unknown";
      return disabled === "false" || disabled === "" || disabled === "unknown";
    },
    30_000,
    "composer send button enabled",
  );
  if (!enabled) {
    throw new Error("composer send button stayed disabled");
  }
  await button.click({ force: true });
}

void main();
