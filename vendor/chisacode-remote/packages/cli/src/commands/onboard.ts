import { cancel, confirm, intro, isCancel, log, note, outro, spinner } from "@clack/prompts";
import { Command, Option } from "commander";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  generateLocalPairingOffer,
  loadConfig,
  loadPersistedConfig,
  type CliConfigOverrides,
  type PersistedConfig,
} from "@chisacode/server";
import {
  resolveLocalChisaCodeHome,
  resolveLocalDaemonState,
  resolveTcpHostFromListen,
  startLocalDaemonDetached,
  tailDaemonLog,
  type DaemonStartOptions,
} from "./daemon/local-daemon.js";
import { tryConnectToDaemon } from "../utils/client.js";
import { tCli } from "../i18n.js";

interface OnboardOptions extends DaemonStartOptions {
  timeout?: string;
  voice?: "ask" | "enable" | "disable";
}

type RawOnboardOptions = OnboardOptions & {
  allowedHosts?: string;
};

type OnboardPersistedConfig = PersistedConfig & {
  features?: PersistedConfig["features"] & {
    dictation?: PersistedConfig["features"] extends { dictation?: infer T }
      ? T & { enabled?: boolean }
      : { enabled?: boolean };
    voiceMode?: PersistedConfig["features"] extends { voiceMode?: infer T }
      ? T & { enabled?: boolean }
      : { enabled?: boolean };
  };
};

const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1000;

class OnboardCancelledError extends Error {}

const plainNoteFormat = (line: string): string => line;

function renderNote(message: string, title: string): void {
  note(message, title, { format: plainNoteFormat });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout value: ${raw}`);
  }

  return Math.ceil(seconds * 1000);
}

function toCliOverrides(options: OnboardOptions): CliConfigOverrides {
  const cliOverrides: CliConfigOverrides = {};

  if (options.listen) {
    cliOverrides.listen = options.listen;
  } else if (options.port) {
    cliOverrides.listen = `127.0.0.1:${options.port}`;
  }

  if (options.relay === false) {
    cliOverrides.relayEnabled = false;
  }

  if (options.hostnames) {
    const raw = options.hostnames.trim();
    cliOverrides.hostnames =
      raw.toLowerCase() === "true"
        ? true
        : raw
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean);
  }

  if (options.mcp === false) {
    cliOverrides.mcpEnabled = false;
  }

  return cliOverrides;
}

function savePersistedConfig(chisacodeHome: string, config: OnboardPersistedConfig): void {
  const configPath = path.join(chisacodeHome, "config.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function applyVoiceSelection(
  config: OnboardPersistedConfig,
  enabled: boolean,
): OnboardPersistedConfig {
  return {
    ...config,
    features: {
      ...config.features,
      dictation: {
        ...config.features?.dictation,
        enabled,
      },
      voiceMode: {
        ...config.features?.voiceMode,
        enabled,
      },
    },
  };
}

function resolvePersistedVoiceSelection(config: OnboardPersistedConfig): boolean | null {
  const voiceModeEnabled = config.features?.voiceMode?.enabled;
  if (typeof voiceModeEnabled === "boolean") {
    return voiceModeEnabled;
  }

  const dictationEnabled = config.features?.dictation?.enabled;
  if (typeof dictationEnabled === "boolean") {
    return dictationEnabled;
  }

  return null;
}

async function resolveVoiceSelection(mode: OnboardOptions["voice"]): Promise<boolean> {
  if (mode === "enable") {
    return true;
  }
  if (mode === "disable") {
    return false;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.message(tCli("onboard.voice.nonInteractive"));
    return false;
  }

  const answer = await confirm({
    message: tCli("onboard.voice.prompt"),
    active: tCli("onboard.voice.yes"),
    inactive: tCli("onboard.voice.no"),
    initialValue: false,
  });

  if (isCancel(answer)) {
    throw new OnboardCancelledError(tCli("onboard.cancelled"));
  }

  return answer;
}

interface DownloadProgress {
  modelId: string | null;
  pct: number | null;
}

function parseDownloadProgress(logTail: string): DownloadProgress | null {
  const lines = logTail.split("\n").filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || !line.includes("Downloading model artifact")) {
      continue;
    }

    const pctMatch = line.match(/"pct"\s*:\s*(\d{1,3})|\bpct[=:]\s*(\d{1,3})/);
    const modelMatch = line.match(/"modelId"\s*:\s*"([^"]+)"|\bmodelId[=:]\s*"?([^\s",}]+)/);

    return {
      modelId: modelMatch?.[1] ?? modelMatch?.[2] ?? null,
      pct: pctMatch ? Number(pctMatch[1] ?? pctMatch[2]) : null,
    };
  }

  return null;
}

function renderProgressLine(progress: DownloadProgress): string {
  const modelSuffix = progress.modelId ? ` (${progress.modelId})` : "";
  if (progress.pct === null) {
    return tCli("onboard.downloadSpeech", { model: modelSuffix });
  }
  return tCli("onboard.downloadSpeechPct", { model: modelSuffix, pct: progress.pct });
}

type ProbeResult = { kind: "ready"; listen: string; host: string | null } | { kind: "pending" };

async function probeDaemonReady(home: string): Promise<ProbeResult> {
  const state = resolveLocalDaemonState({ home });
  const host = resolveTcpHostFromListen(state.listen);

  if (state.running && host) {
    const client = await tryConnectToDaemon({ host, timeout: 1200 });
    if (client) {
      try {
        await client.fetchAgents();
        return { kind: "ready", listen: state.listen, host };
      } catch {
        // Daemon process is alive but not API-ready yet.
      } finally {
        await client.close().catch(() => {});
      }
    }
  } else if (state.running && !host) {
    return { kind: "ready", listen: state.listen, host: null };
  }

  return { kind: "pending" };
}

interface ProgressState {
  lastStatus: string;
  lastPrintedAt: number;
}

function announceProgress(
  home: string,
  state: ProgressState,
  onStatus: ((message: string) => void) | undefined,
): ProgressState {
  const progress = parseDownloadProgress(tailDaemonLog(home, 120) ?? "");
  const progressLine = progress ? renderProgressLine(progress) : null;
  const statusMessage = progressLine ?? tCli("onboard.waiting");

  if (statusMessage !== state.lastStatus) {
    onStatus?.(statusMessage);
    return { lastStatus: statusMessage, lastPrintedAt: Date.now() };
  }
  if (!onStatus && Date.now() - state.lastPrintedAt >= 3000) {
    console.log(statusMessage);
    return { lastStatus: state.lastStatus, lastPrintedAt: Date.now() };
  }
  return state;
}

async function waitForDaemonReady(args: {
  home: string;
  timeoutMs: number;
  onStatus?: (message: string) => void;
}): Promise<{ listen: string; host: string | null }> {
  const deadline = Date.now() + args.timeoutMs;

  async function poll(state: ProgressState): Promise<{ listen: string; host: string | null }> {
    const probe = await probeDaemonReady(args.home);
    if (probe.kind === "ready") {
      return { listen: probe.listen, host: probe.host };
    }
    const nextState = announceProgress(args.home, state, args.onStatus);
    if (Date.now() >= deadline) {
      const recentLogs = tailDaemonLog(args.home, 60);
      throw new Error(
        [
          tCli("onboard.waitTimeout", { seconds: Math.ceil(args.timeoutMs / 1000) }),
          recentLogs ? tCli("onboard.recentLogs", { logs: recentLogs }) : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }
    await sleep(200);
    return poll(nextState);
  }

  return poll({ lastStatus: "", lastPrintedAt: 0 });
}

function printNextSteps(pairingUrl: string | null, chisacodeHome: string, richUi: boolean): void {
  const daemonLogPath = path.join(chisacodeHome, "daemon.log");
  const nextStepsLines = [
    pairingUrl ? tCli("onboard.nextPair") : tCli("onboard.nextConnect"),
    tCli("onboard.webApp"),
    tCli("onboard.desktopApp"),
    tCli("onboard.docs"),
    tCli("onboard.example"),
  ];
  const quickReferenceLines = [
    "1. chisacode --help",
    "2. chisacode ls",
    '3. chisacode run "your prompt"',
    "4. chisacode status",
    tCli("onboard.daemonLogs", { path: daemonLogPath }),
  ];

  if (!richUi) {
    console.log("");
    console.log(tCli("onboard.nextSteps") + ":");
    for (const line of nextStepsLines) {
      console.log(line);
    }
    console.log("");
    console.log(tCli("onboard.quickReference") + ":");
    for (const line of quickReferenceLines) {
      console.log(line);
    }
    return;
  }

  renderNote(nextStepsLines.join("\n"), tCli("onboard.nextSteps"));
  renderNote(quickReferenceLines.join("\n"), tCli("onboard.quickReference"));
}

export function onboardCommand(): Command {
  return new Command("onboard")
    .description(tCli("onboard.description"))
    .option("--listen <listen>", tCli("daemon.option.listen"))
    .option("--port <port>", tCli("daemon.option.port"))
    .option("--home <path>", tCli("option.home"))
    .option("--no-relay", tCli("daemon.option.noRelay"))
    .option("--no-mcp", tCli("daemon.option.noMcp"))
    .option("--hostnames <hosts>", tCli("option.hostnames"))
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .option("--timeout <seconds>", tCli("onboard.option.timeout"))
    .option("--voice <mode>", tCli("onboard.option.voice"), "ask")
    .action(async (options: RawOnboardOptions) => {
      await runOnboard({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

async function resolveAndPersistVoice(
  chisacodeHome: string,
  options: OnboardOptions,
): Promise<boolean> {
  let persisted = loadPersistedConfig(chisacodeHome) as OnboardPersistedConfig;
  const persistedVoiceSelection = resolvePersistedVoiceSelection(persisted);
  const shouldPrompt = options.voice === "ask" || options.voice === undefined;
  let voiceEnabled: boolean;
  try {
    voiceEnabled =
      shouldPrompt && persistedVoiceSelection !== null
        ? persistedVoiceSelection
        : await resolveVoiceSelection(options.voice);
  } catch (error) {
    if (error instanceof OnboardCancelledError) {
      cancel(tCli("onboard.cancelled"));
      process.exit(0);
    }
    throw error;
  }

  if (shouldPrompt && persistedVoiceSelection !== null) {
    log.message(
      tCli("onboard.savedVoice", {
        state: voiceEnabled ? tCli("onboard.enabled") : tCli("onboard.disabled"),
      }),
    );
  }

  persisted = applyVoiceSelection(persisted, voiceEnabled);
  savePersistedConfig(chisacodeHome, persisted);
  return voiceEnabled;
}

async function ensureDaemonStarted(options: OnboardOptions, richUi: boolean): Promise<void> {
  const stateBeforeStart = resolveLocalDaemonState({ home: options.home });
  if (stateBeforeStart.running) {
    log.message(tCli("onboard.daemonAlready", { pid: stateBeforeStart.pidInfo?.pid ?? "unknown" }));
    return;
  }

  const startSpinner = richUi ? spinner() : null;
  try {
    if (startSpinner) {
      startSpinner.start(tCli("onboard.starting"));
    } else {
      log.message(tCli("onboard.starting"));
    }
    const startup = await startLocalDaemonDetached(options);
    if (startSpinner) {
      startSpinner.stop(tCli("onboard.started", { pid: startup.pid ?? "unknown" }));
    } else {
      log.message(tCli("onboard.started", { pid: startup.pid ?? "unknown" }));
    }
    log.message(tCli("daemon.start.logs", { path: startup.logPath }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (startSpinner) {
      startSpinner.error(message);
    } else {
      log.error(message);
    }
    process.exit(1);
  }
}

async function waitForDaemonReadyWithUi(args: {
  home: string;
  timeoutMs: number;
  richUi: boolean;
}): Promise<{ listen: string; host: string | null }> {
  const readySpinner = args.richUi ? spinner() : null;
  try {
    if (readySpinner) {
      readySpinner.start(tCli("onboard.waiting"));
    } else {
      log.message(tCli("onboard.waiting"));
    }
    const readyState = await waitForDaemonReady({
      home: args.home,
      timeoutMs: args.timeoutMs,
      onStatus: readySpinner ? (message) => readySpinner.message(message) : undefined,
    });
    if (readySpinner) {
      readySpinner.stop(tCli("onboard.ready", { listen: readyState.listen }));
    } else {
      log.message(tCli("onboard.ready", { listen: readyState.listen }));
    }
    return readyState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (readySpinner) {
      readySpinner.error(message);
    } else {
      log.error(message);
    }
    return process.exit(1);
  }
}

export async function runOnboard(options: OnboardOptions): Promise<void> {
  const richUi = process.stdin.isTTY && process.stdout.isTTY;
  if (richUi) {
    intro(tCli("onboard.welcome"));
  }

  if (options.listen && options.port) {
    cancel(tCli("daemon.error.listenPort"));
    process.exit(1);
  }

  let timeoutMs = DEFAULT_READY_TIMEOUT_MS;
  try {
    timeoutMs = parseTimeoutMs(options.timeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancel(message);
    process.exit(1);
  }

  const chisacodeHome = resolveLocalChisaCodeHome(options.home);
  if (richUi) {
    renderNote(chisacodeHome, "ChisaCode home");
  }

  const voiceEnabled = await resolveAndPersistVoice(chisacodeHome, options);
  const config = loadConfig(chisacodeHome, { cli: toCliOverrides(options) });

  log.message(voiceEnabled ? tCli("onboard.voiceEnabled") : tCli("onboard.voiceDisabled"));

  await ensureDaemonStarted(options, richUi);
  await waitForDaemonReadyWithUi({
    home: options.home ?? chisacodeHome,
    timeoutMs,
    richUi,
  });

  if (config.relayEnabled === false) {
    log.warn(tCli("onboard.relayDisabled"));
    printNextSteps(null, chisacodeHome, richUi);
    if (richUi) {
      outro(tCli("onboard.daemonRunning"));
    }
    return;
  }

  const pairing = await generateLocalPairingOffer({
    chisacodeHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });

  if (!pairing.url) {
    log.warn(tCli("onboard.relayUrlUnavailable"));
    printNextSteps(null, chisacodeHome, richUi);
    if (richUi) {
      outro(tCli("onboard.daemonRunning"));
    }
    return;
  }

  renderNote(pairing.qr ?? tCli("onboard.qrUnavailable"), tCli("onboard.scan"));
  renderNote(pairing.url, tCli("onboard.pairingLink"));
  printNextSteps(pairing.url, chisacodeHome, richUi);
  if (richUi) {
    outro(tCli("onboard.readyOutro"));
  }
}
