import { type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app, ipcMain, powerMonitor, safeStorage } from "electron";
import log from "electron-log/main";
import { resolveChisaCodeHome, spawnProcess } from "@chisacode/server";
import {
  copyAttachmentFileToManagedStorage,
  deleteManagedAttachmentFile,
  garbageCollectManagedAttachmentFiles,
  readManagedFileBase64,
  writeAttachmentBase64,
  writeAttachmentBytes,
} from "../features/attachments.js";
import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
  type AppReleaseChannel,
} from "../features/auto-updater.js";
import { setApplicationMenuLanguage } from "../features/menu.js";
import { getCliInstallStatus, installCli } from "../integrations/cli-install/index.js";
import {
  getSkillsStatus,
  installSkills,
  uninstallSkills,
  updateSkills,
} from "../integrations/skills/index.js";
import {
  openLocalTransportSession,
  sendLocalTransportMessage,
  closeLocalTransportSession,
} from "./local-transport.js";
import { createNodeEntrypointInvocation, resolveDaemonRunnerEntrypoint } from "./runtime-paths.js";
import { runExternalCliJsonCommand, runExternalCliTextCommand } from "./cli/external.js";
import {
  createDesktopSettingsCommandHandlers,
  type DesktopCommandHandler,
} from "../settings/desktop-settings-commands.js";
import type { DesktopSettings } from "../settings/desktop-settings.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import { isRunningUnderARM64Translation } from "../system/arm64-translation.js";
import { translateDesktop } from "../i18n.js";

const DAEMON_LOG_FILENAME = "daemon.log";
const DAEMON_PID_FILENAMES = ["chisacode.pid"] as const;
const IPC_PREFIXES = ["chisacode"] as const;

/**
 * SECURITY: When adding a new IPC handler that performs privileged operations
 * (file I/O, process management, transport, installation), you MUST:
 * 1. Add the command name to PRIVILEGED_COMMANDS below
 * 2. Ensure isMainAppSenderUrl() validates the sender origin
 * 3. Review the blast radius of path arguments (see assertTransportPathAllowed)
 *
 * Non-privileged handlers (pure data retrieval) do NOT need to be added,
 * but should be documented inline to avoid ambiguous intent.
 *
 * Commands that require the sender to be the main application window.
 * These perform privileged operations (starting/stopping the daemon, writing
 * attachments, opening transport sessions, etc.) that should not be callable
 * from a compromised webview or sub-frame.
 */
const PRIVILEGED_COMMANDS: ReadonlySet<string> = new Set([
  "start_desktop_daemon",
  "stop_desktop_daemon",
  "restart_desktop_daemon",
  "write_attachment_base64",
  "write_attachment_bytes",
  "copy_attachment_file",
  "read_file_base64",
  "delete_attachment_file",
  "garbage_collect_attachment_files",
  "open_local_daemon_transport",
  "send_local_daemon_transport_message",
  "close_local_daemon_transport",
  "install_cli",
  "install_app_update",
  "install_skills",
  "update_skills",
  "uninstall_skills",
  // Writes desktop-settings.json (releaseChannel, daemon management). Any
  // webview could otherwise flip the release channel or disable the built-in
  // daemon manager. Read-only get_desktop_settings is intentionally NOT here.
  "patch_desktop_settings",
  "migrate_legacy_desktop_settings",
  // Initiates an outbound network request to GitHub release metadata. While
  // it cannot install an update (install_app_update is separately privileged),
  // restricting it keeps the privileged surface consistent and prevents a
  // compromised frame from triggering update probes.
  "check_app_update",
  "encrypt_relay_device_secret",
  "decrypt_relay_device_secret",
]);

export { PRIVILEGED_COMMANDS };
const STARTUP_POLL_INTERVAL_MS = 200;
const STARTUP_POLL_MAX_ATTEMPTS = 150;
const DETACHED_STARTUP_GRACE_MS = 1200;
const STARTUP_OUTPUT_CAPTURE_LIMIT_CHARS = 64 * 1024;

export interface SenderValidationOptions {
  /**
   * Whether the desktop app is running from a packaged build. When true,
   * `file://` and `http(s)://localhost` origins are rejected because the
   * packaged app loads from the `chisacode://` protocol. When false (dev),
   * localhost and the dev port are trusted.
   */
  packaged: boolean;
  /**
   * Optional primary dev server port. Only consulted in dev mode. Defaults to
   * the port resolved from EXPO_DEV_URL / EXPO_PORT, then 8081.
   */
  devPort?: number;
  /**
   * Optional additional Metro/dev ports to trust. Desktop dev scripts fall back
   * across 8081-8085 when earlier ports are busy; without this list a fallback
   * port blocks every privileged IPC (start_desktop_daemon, attachments, …).
   */
  allowedDevPorts?: readonly number[];
}

const DEFAULT_DEV_PORT = 8081;
/** Ports used by packages/desktop/scripts/dev.ps1 via get-port-cli. */
const DEFAULT_ALLOWED_DEV_PORTS = [8081, 8082, 8083, 8084, 8085] as const;

/**
 * Resolves the primary Metro/dev port from the environment used by desktop dev.
 * @returns A port in 1..65535, or the default 8081 when unset/invalid
 */
export function resolveDesktopDevPort(
  env: NodeJS.ProcessEnv = process.env,
  fallback = DEFAULT_DEV_PORT,
): number {
  const fromExpoPort = parsePortValue(env.EXPO_PORT);
  if (fromExpoPort !== null) {
    return fromExpoPort;
  }
  const fromDevUrl = parsePortFromUrl(env.EXPO_DEV_URL);
  if (fromDevUrl !== null) {
    return fromDevUrl;
  }
  return fallback;
}

/**
 * Builds sender-validation options for the current desktop process.
 * Packaged builds only trust chisacode://; dev trusts file:// and localhost
 * Metro ports from the desktop dev launcher.
 */
export function resolveMainAppSenderValidationOptions(
  input: {
    packaged: boolean;
    env?: NodeJS.ProcessEnv;
  } = { packaged: true },
): SenderValidationOptions {
  if (input.packaged) {
    return { packaged: true };
  }
  const env = input.env ?? process.env;
  const devPort = resolveDesktopDevPort(env);
  const allowed = new Set<number>(DEFAULT_ALLOWED_DEV_PORTS);
  allowed.add(devPort);
  return {
    packaged: false,
    devPort,
    allowedDevPorts: Array.from(allowed).sort((left, right) => left - right),
  };
}

function parsePortValue(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function parsePortFromUrl(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.port) {
      return parsePortValue(url.port);
    }
    if (url.protocol === "https:") {
      return 443;
    }
    if (url.protocol === "http:") {
      return 80;
    }
    return null;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function resolveAllowedDevPorts(options: SenderValidationOptions): ReadonlySet<string> {
  const ports = new Set<string>();
  const primary = options.devPort ?? DEFAULT_DEV_PORT;
  ports.add(String(primary));
  // Default HTTP port may be represented as an empty URL.port.
  if (primary === 80) {
    ports.add("");
  }
  for (const port of options.allowedDevPorts ?? DEFAULT_ALLOWED_DEV_PORTS) {
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      ports.add(String(port));
    }
  }
  return ports;
}

export function isMainAppSenderUrl(
  senderUrl: string,
  options: SenderValidationOptions = { packaged: true },
): boolean {
  try {
    const url = new URL(senderUrl);
    if (url.protocol === "chisacode:" && url.hostname === "app") {
      return true;
    }
    // In packaged builds the app loads from chisacode://, so file:// and
    // localhost are not expected. Reject them to prevent a webview or iframe
    // with a file:// or localhost origin from invoking privileged IPC.
    if (options.packaged) {
      return false;
    }
    // Dev mode: trust file:// (static export dev), and loopback on the Metro
    // ports used by desktop dev. Other hosts/ports stay rejected.
    if (url.protocol === "file:") {
      return true;
    }
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackHostname(url.hostname) &&
      resolveAllowedDevPorts(options).has(url.port || (url.protocol === "https:" ? "443" : "80"))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate that a local transport path points at a ChisaCode-owned socket or
 * pipe, not an arbitrary IPC endpoint (e.g. Docker's socket, another app's
 * named pipe). A compromised renderer that has already passed sender
 * validation could otherwise use `open_local_daemon_transport` to connect to
 * and read/write any local IPC endpoint the user has access to.
 *
 * POSIX sockets must resolve under `$CHISACODE_HOME`. Windows named pipes must
 * have a name starting with `chisacode` (matching the daemon's pipe naming).
 */
export function assertTransportPathAllowed(
  transportType: "socket" | "pipe",
  transportPath: string,
): void {
  if (transportType === "socket") {
    const home = path.resolve(getChisaCodeHome());
    const resolved = path.resolve(transportPath);
    // Use path.relative + path.isAbsolute instead of a case-sensitive
    // `startsWith` prefix check: on Windows the filesystem is case-insensitive
    // and `path.relative` (win32) treats same-drive paths differing only by
    // case as equivalent, so a legitimate socket path with mixed-case drive
    // letters is not misrejected as escaping ChisaCode home. Traversal via
    // `..` resolves to an absolute path or a `..`-prefixed relative and is
    // rejected, mirroring the ACP resolvePathInsideBase guard.
    const relative = path.relative(home, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Local transport socket path must be under ChisaCode home (${home}). Received: ${transportPath}`,
      );
    }
    return;
  }

  // Windows named pipe. Windows named pipes do not support directory
  // traversal — the pipe name is a flat namespace. A prefix check is
  // sufficient to ensure the pipe belongs to ChisaCode.
  // Normalize the various forms:
  //   \\.\pipe\chisacode-...  →  \\.\pipe\chisacode-...
  //   pipe://chisacode-...    →  chisacode-...
  let pipeName = transportPath;
  if (pipeName.startsWith("pipe://")) {
    pipeName = pipeName.slice("pipe://".length);
  } else if (pipeName.startsWith("\\\\.\\pipe\\")) {
    pipeName = pipeName.slice("\\\\.\\pipe\\".length);
  }
  if (!pipeName.startsWith("chisacode")) {
    throw new Error(
      `Local transport pipe name must start with "chisacode". Received: ${transportPath}`,
    );
  }
}
type DesktopDaemonState = "starting" | "running" | "stopped" | "errored";

export interface DesktopDaemonStatus {
  serverId: string;
  status: DesktopDaemonState;
  listen: string | null;
  hostname: string | null;
  pid: number | null;
  home: string;
  version: string | null;
  desktopManaged: boolean;
  error: string | null;
}

interface DesktopDaemonLogs {
  logPath: string;
  contents: string;
}

interface DesktopPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

interface StartupOutputCapture {
  text: string;
  truncated: boolean;
}

function parseReleaseChannel(
  args: Record<string, unknown> | undefined,
): AppReleaseChannel | undefined {
  if (args?.releaseChannel === "beta") {
    return "beta";
  }
  if (args?.releaseChannel === "stable") {
    return "stable";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getChisaCodeHome(): string {
  return resolveChisaCodeHome(process.env);
}

function logFilePath(): string {
  return path.join(getChisaCodeHome(), DAEMON_LOG_FILENAME);
}

function pidFilePath(): string {
  const home = getChisaCodeHome();
  const pidFileName = DAEMON_PID_FILENAMES.find((fileName) =>
    existsSync(path.join(home, fileName)),
  );
  return path.join(home, pidFileName ?? DAEMON_PID_FILENAMES[0]);
}

export function isDesktopManagedDaemonRunningSync(): boolean {
  try {
    const raw = readFileSync(pidFilePath(), "utf-8");
    const lock = JSON.parse(raw) as { pid?: unknown; desktopManaged?: unknown };
    if (lock.desktopManaged !== true) return false;
    if (typeof lock.pid !== "number" || !Number.isInteger(lock.pid)) return false;
    return isProcessRunning(lock.pid);
  } catch {
    return false;
  }
}

export async function stopDesktopDaemonViaCli(): Promise<void> {
  await runExternalCliJsonCommand([
    "daemon",
    "stop",
    "--json",
    "--timeout",
    "5",
    "--force",
    "--kill-timeout",
    "5",
  ]);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EPERM") {
      // EPERM means the process exists but we lack permission to signal it
      // (e.g. owned by another user). It is still running — returning false
      // here would misreport a live daemon as dead and trigger spurious
      // restarts. Mirrors packages/cli/.../local-daemon.ts EPERM handling.
      return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tailFile(filePath: string, lines = 50): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function createStartupOutputCapture(): StartupOutputCapture {
  return { text: "", truncated: false };
}

function appendStartupOutput(capture: StartupOutputCapture, chunk: Buffer): StartupOutputCapture {
  const nextText = capture.text + chunk.toString();
  if (nextText.length <= STARTUP_OUTPUT_CAPTURE_LIMIT_CHARS) {
    return { text: nextText, truncated: capture.truncated };
  }

  return {
    text: nextText.slice(-STARTUP_OUTPUT_CAPTURE_LIMIT_CHARS),
    truncated: true,
  };
}

function formatStartupOutput(capture: StartupOutputCapture): string {
  if (!capture.truncated) {
    return capture.text;
  }

  return `[output truncated to the last ${STARTUP_OUTPUT_CAPTURE_LIMIT_CHARS} chars]\n${capture.text}`;
}

function logDesktopDaemonLifecycle(message: string, details?: Record<string, unknown>): void {
  log.info("[desktop daemon]", message, {
    pid: process.pid,
    ...details,
  });
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveDesktopAppVersion(): string {
  if (app.isPackaged) {
    return app.getVersion();
  }

  try {
    const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
    // Fall back to Electron's default version if the package metadata is unavailable.
  }

  return app.getVersion();
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

export async function resolveDesktopDaemonStatus(): Promise<DesktopDaemonStatus> {
  const home = getChisaCodeHome();

  try {
    const payload = (await runExternalCliJsonCommand(["daemon", "status", "--json"])) as Record<
      string,
      unknown
    >;
    const localDaemon = typeof payload.localDaemon === "string" ? payload.localDaemon : "stopped";
    const connectedDaemon =
      typeof payload.connectedDaemon === "string" ? payload.connectedDaemon : "not_probed";
    const hasRunningLocalProcess = localDaemon === "running";
    const hasLocalProcess = hasRunningLocalProcess || localDaemon === "unresponsive";
    const apiReachable = connectedDaemon === "reachable";
    let status: DesktopDaemonState = "stopped";
    if (apiReachable || hasRunningLocalProcess) {
      status = "running";
    } else if (localDaemon === "unresponsive") {
      status = "errored";
    }

    return {
      serverId: typeof payload.serverId === "string" ? payload.serverId : "",
      status,
      listen: typeof payload.listen === "string" ? payload.listen : null,
      hostname:
        status === "running" && typeof payload.hostname === "string" ? payload.hostname : null,
      pid: hasLocalProcess && typeof payload.pid === "number" ? payload.pid : null,
      home,
      version: typeof payload.daemonVersion === "string" ? payload.daemonVersion : null,
      desktopManaged: hasRunningLocalProcess && payload.desktopManaged === true,
      error: null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDesktopDaemonLifecycle("resolveStatus CLI command failed", { error: errorMessage });
    return {
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home,
      version: null,
      desktopManaged: false,
      error: errorMessage,
    };
  }
}

function normalizeVersion(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

export function shouldRestartForVersion(current: DesktopDaemonStatus): boolean {
  if (!current.desktopManaged) return false;
  const appVersion = normalizeVersion(resolveDesktopAppVersion());
  const daemonVersion = normalizeVersion(current.version);
  return Boolean(appVersion && daemonVersion && appVersion !== daemonVersion);
}

function assertBuiltInDaemonManagementEnabled(settings: DesktopSettings): void {
  if (!settings.daemon.manageBuiltInDaemon) {
    throw new Error(translateDesktop(settings.language, "daemon.manageBuiltInDisabled"));
  }
}

function buildStartupFailureError(
  result: { code: number | null; signal: string | null; error?: Error },
  stdout: StartupOutputCapture,
  stderr: StartupOutputCapture,
): Error {
  const reason = result.error
    ? result.error.message
    : `exit code ${result.code ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}`;
  const parts = [`Daemon failed to start: ${reason}`];
  const formattedStderr = formatStartupOutput(stderr).trim();
  const formattedStdout = formatStartupOutput(stdout).trim();
  if (formattedStderr) parts.push(`stderr:\n${formattedStderr}`);
  if (formattedStdout) parts.push(`stdout:\n${formattedStdout}`);
  const logs = tailFile(logFilePath(), 15);
  if (logs) parts.push(`Recent logs (${logFilePath()}):\n${logs}`);
  return new Error(parts.join("\n\n"));
}

async function pollForRunningDaemon(): Promise<DesktopDaemonStatus> {
  async function poll(attempt: number): Promise<DesktopDaemonStatus> {
    if (attempt >= STARTUP_POLL_MAX_ATTEMPTS) return resolveDesktopDaemonStatus();
    const status = await resolveDesktopDaemonStatus();
    if (attempt === 0 || attempt === STARTUP_POLL_MAX_ATTEMPTS - 1 || attempt % 10 === 9) {
      logDesktopDaemonLifecycle("polling daemon status after detached start", {
        attempt: attempt + 1,
        status: status.status,
        pid: status.pid,
        listen: status.listen,
        serverId: status.serverId || null,
      });
    }
    if (status.status === "running" && status.serverId && status.listen) return status;
    await sleep(STARTUP_POLL_INTERVAL_MS);
    return poll(attempt + 1);
  }
  return poll(0);
}

async function startDaemon(): Promise<DesktopDaemonStatus> {
  // Desktop cold start is hard-bound to the built-in daemon: the
  // manageBuiltInDaemon setting no longer blocks start. It only controls
  // whether the desktop may manually stop/restart the daemon during a session.
  const current = await resolveDesktopDaemonStatus();
  logDesktopDaemonLifecycle("initial status check before start", {
    status: current.status,
    pid: current.pid,
    listen: current.listen,
    serverId: current.serverId || null,
    error: current.error,
    desktopManaged: current.desktopManaged,
  });
  if (current.status === "running") {
    if (shouldRestartForVersion(current)) {
      logDesktopDaemonLifecycle("daemon version mismatch, restarting", {
        appVersion: normalizeVersion(resolveDesktopAppVersion()),
        daemonVersion: normalizeVersion(current.version),
      });
      await stopDesktopDaemon();
    } else {
      return current;
    }
  }

  const daemonRunner = resolveDaemonRunnerEntrypoint();
  const invocation = createNodeEntrypointInvocation({
    entrypoint: daemonRunner,
    argvMode: "node-script",
    args: [],
    baseEnv: process.env,
  });

  logDesktopDaemonLifecycle("starting detached daemon", {
    appIsPackaged: app.isPackaged,
    daemonRunnerEntry: daemonRunner.entryPath,
    daemonRunnerExecArgv: daemonRunner.execArgv,
    command: invocation.command,
    args: invocation.args,
    electronRunAsNode: invocation.env.ELECTRON_RUN_AS_NODE ?? null,
    parentExecPath: process.execPath,
    parentElectronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });

  const child: ChildProcess = spawnProcess(invocation.command, invocation.args, {
    detached: true,
    envMode: "internal",
    env: invocation.env,
    envOverlay: { CHISACODE_DESKTOP_MANAGED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = createStartupOutputCapture();
  let stderr = createStartupOutputCapture();
  child.stdout!.on("data", (data: Buffer) => {
    stdout = appendStartupOutput(stdout, data);
  });
  child.stderr!.on("data", (data: Buffer) => {
    stderr = appendStartupOutput(stderr, data);
  });

  logDesktopDaemonLifecycle("detached spawn returned", {
    childPid: child.pid ?? null,
    spawnfile: child.spawnfile,
    spawnargs: child.spawnargs,
  });

  child.unref();

  type GraceResult =
    | { exitedEarly: false }
    | { exitedEarly: true; code: number | null; signal: string | null; error?: Error };

  const result = await new Promise<GraceResult>((resolve) => {
    let settled = false;
    const finish = (value: GraceResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish({ exitedEarly: false }), DETACHED_STARTUP_GRACE_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code, signal });
    });
  });

  logDesktopDaemonLifecycle("detached startup grace period completed", {
    childPid: child.pid ?? null,
    exitedEarly: result.exitedEarly,
    stdout: formatStartupOutput(stdout).slice(0, 2000),
    stderr: formatStartupOutput(stderr).slice(0, 2000),
    ...(result.exitedEarly
      ? {
          exitCode: result.code,
          signal: result.signal,
          error: result.error?.message ?? null,
        }
      : {}),
  });

  if (result.exitedEarly) {
    throw buildStartupFailureError(result, stdout, stderr);
  }

  return pollForRunningDaemon();
}

export async function stopDesktopDaemon(): Promise<DesktopDaemonStatus> {
  const status = await resolveDesktopDaemonStatus();
  if (status.status !== "running" || !status.pid) return status;

  await stopDesktopDaemonViaCli();
  return await resolveDesktopDaemonStatus();
}

async function restartDaemon(): Promise<DesktopDaemonStatus> {
  assertBuiltInDaemonManagementEnabled(await getDesktopSettingsStore().get());
  await stopDesktopDaemon();
  return startDaemon();
}

function getDaemonLogs(): DesktopDaemonLogs {
  const logPath = logFilePath();
  return {
    logPath,
    contents: tailFile(logPath, 100),
  };
}

function assertElectronSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron secure storage is unavailable");
  }
  if (process.platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === "basic_text" || backend === "unknown") {
      throw new Error("Electron secure storage has no protected Linux backend");
    }
  }
}

function encryptRelayDeviceSecret(args: Record<string, unknown> | undefined): {
  ciphertextB64: string;
} {
  const deviceSecret = args?.deviceSecret;
  if (typeof deviceSecret !== "string" || deviceSecret.length < 32 || deviceSecret.length > 512) {
    throw new Error("Invalid relay device secret");
  }
  assertElectronSecureStorageAvailable();
  return { ciphertextB64: safeStorage.encryptString(deviceSecret).toString("base64") };
}

function decryptRelayDeviceSecret(args: Record<string, unknown> | undefined): {
  deviceSecret: string;
} {
  const ciphertextB64 = args?.ciphertextB64;
  if (
    typeof ciphertextB64 !== "string" ||
    ciphertextB64.length < 16 ||
    ciphertextB64.length > 4096 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(ciphertextB64)
  ) {
    throw new Error("Invalid encrypted relay device secret");
  }
  assertElectronSecureStorageAvailable();
  const deviceSecret = safeStorage.decryptString(Buffer.from(ciphertextB64, "base64"));
  if (deviceSecret.length < 32 || deviceSecret.length > 512) {
    throw new Error("Invalid decrypted relay device secret");
  }
  return { deviceSecret };
}

async function getCliDaemonStatus(): Promise<string> {
  return await runExternalCliTextCommand(["daemon", "status"]);
}

async function getDaemonPairing(): Promise<DesktopPairingOffer> {
  const status = await resolveDesktopDaemonStatus();
  if (status.status !== "running") {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }

  try {
    const payload = await runExternalCliJsonCommand(["daemon", "pair", "--json"]);
    if (!isRecord(payload)) {
      const language = (await getDesktopSettingsStore().get()).language;
      throw new Error(translateDesktop(language, "daemon.pairingResponseInvalid"));
    }

    return {
      relayEnabled: payload.relayEnabled === true,
      url: toTrimmedString(payload.url),
      qr: toTrimmedString(payload.qr),
    };
  } catch {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }
}

async function getLocalDaemonVersion(): Promise<{ version: string | null; error: string | null }> {
  const status = await resolveDesktopDaemonStatus();
  const language = (await getDesktopSettingsStore().get()).language;
  if (status.status !== "running") {
    return { version: null, error: translateDesktop(language, "daemon.notRunning") };
  }
  return {
    version: status.version,
    error: status.version ? null : translateDesktop(language, "daemon.versionMissing"),
  };
}

async function resolveRequestedReleaseChannel(
  args: Record<string, unknown> | undefined,
): Promise<AppReleaseChannel> {
  return parseReleaseChannel(args) ?? (await getDesktopSettingsStore().get()).releaseChannel;
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function createDaemonCommandHandlers(): Record<string, DesktopCommandHandler> {
  return {
    ...createDesktopSettingsCommandHandlers({
      settingsStore: getDesktopSettingsStore(),
      onSettingsChanged: (settings) => {
        setApplicationMenuLanguage(settings.language);
      },
    }),
    desktop_get_runtime_info: () => ({
      appVersion: resolveDesktopAppVersion(),
      runningUnderARM64Translation: isRunningUnderARM64Translation(),
    }),
    desktop_daemon_status: () => resolveDesktopDaemonStatus(),
    start_desktop_daemon: () => startDaemon(),
    stop_desktop_daemon: () => stopDesktopDaemon(),
    restart_desktop_daemon: () => restartDaemon(),
    desktop_daemon_logs: () => getDaemonLogs(),
    desktop_daemon_pairing: () => getDaemonPairing(),
    desktop_get_system_idle_time: () => powerMonitor.getSystemIdleTime() * 1000,
    encrypt_relay_device_secret: (args) => encryptRelayDeviceSecret(args),
    decrypt_relay_device_secret: (args) => decryptRelayDeviceSecret(args),
    cli_daemon_status: () => getCliDaemonStatus(),
    write_attachment_base64: (args) => writeAttachmentBase64(args ?? {}),
    write_attachment_bytes: (args) => writeAttachmentBytes(args ?? {}),
    copy_attachment_file: (args) => copyAttachmentFileToManagedStorage(args ?? {}),
    read_file_base64: (args) => readManagedFileBase64(args ?? {}),
    delete_attachment_file: (args) => deleteManagedAttachmentFile(args ?? {}),
    garbage_collect_attachment_files: (args) => garbageCollectManagedAttachmentFiles(args ?? {}),
    open_local_daemon_transport: async (args) => {
      if (
        !isRecord(args) ||
        typeof args.transportPath !== "string" ||
        (args.transportType !== "socket" && args.transportType !== "pipe")
      ) {
        throw new Error("Invalid arguments for open_local_daemon_transport");
      }
      const target = args as { transportType: "socket" | "pipe"; transportPath: string };
      assertTransportPathAllowed(target.transportType, target.transportPath);
      return await openLocalTransportSession(target);
    },
    send_local_daemon_transport_message: async (args) => {
      if (
        !isRecord(args) ||
        typeof args.sessionId !== "string" ||
        (args.text !== undefined && typeof args.text !== "string") ||
        (args.binaryBase64 !== undefined && typeof args.binaryBase64 !== "string")
      ) {
        throw new Error("Invalid arguments for send_local_daemon_transport_message");
      }
      await sendLocalTransportMessage(
        args as { sessionId: string; text?: string; binaryBase64?: string },
      );
    },
    close_local_daemon_transport: (args) => {
      if (!isRecord(args) || typeof args.sessionId !== "string") {
        throw new Error("Invalid arguments for close_local_daemon_transport");
      }
      const sessionId = args.sessionId;
      if (sessionId) closeLocalTransportSession(sessionId);
    },
    check_app_update: async (args) => {
      const currentVersion = resolveDesktopAppVersion();
      return checkForAppUpdate({
        currentVersion,
        releaseChannel: await resolveRequestedReleaseChannel(args),
      });
    },
    install_app_update: async (args) => {
      const currentVersion = resolveDesktopAppVersion();
      return downloadAndInstallUpdate(
        { currentVersion, releaseChannel: await resolveRequestedReleaseChannel(args) },
        async () => {
          await stopDesktopDaemon();
        },
      );
    },
    get_local_daemon_version: () => getLocalDaemonVersion(),
    install_cli: () => installCli(),
    get_cli_install_status: () => getCliInstallStatus(),
    get_skills_status: () => getSkillsStatus(),
    install_skills: () => installSkills(),
    update_skills: () => updateSkills(),
    uninstall_skills: () => uninstallSkills(),
  };
}

export function registerDaemonManager(): void {
  const handlers = createDaemonCommandHandlers();

  for (const prefix of IPC_PREFIXES) {
    ipcMain.handle(
      `${prefix}:invoke`,
      async (event, command: string, args?: Record<string, unknown>) => {
        // Validate sender for privileged commands. Only the main application
        // window (not webviews or sub-frames) may invoke these.
        if (PRIVILEGED_COMMANDS.has(command)) {
          const senderUrl = event.senderFrame?.url ?? event.sender?.getURL?.() ?? "";
          // The main app loads from the app protocol in packaged builds, file:// in
          // static exports, or localhost Metro ports in dev. Webviews use external
          // origins. Dev ports come from EXPO_DEV_URL / EXPO_PORT plus 8081-8085.
          if (
            !isMainAppSenderUrl(
              senderUrl,
              resolveMainAppSenderValidationOptions({ packaged: app.isPackaged }),
            )
          ) {
            logDesktopDaemonLifecycle("blocked privileged IPC command from non-main sender", {
              command,
              senderUrl: senderUrl.slice(0, 200),
            });
            throw new Error(`Command "${command}" is not available from this context`);
          }
        }

        const handler = handlers[command];
        if (!handler) {
          throw new Error(`Unknown desktop command: ${command}`);
        }
        return await handler(args);
      },
    );
  }
}
