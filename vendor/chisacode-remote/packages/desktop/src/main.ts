/**
 * Filter noisy Electron/Chromium process warnings instead of silently
 * dropping every warning. Known noise codes (e.g. DEP0062 — Chromium
 * internal pending-deprecation churn) are suppressed; everything else
 * passes through to the default stderr emitter so real deprecations
 * and V8 memory pressure signals remain visible during development.
 *
 * This MUST sit at line 1 to intercept warnings from all subsequent
 * imports, including Electron and its dependencies.
 */
const _originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, type: string, code?: string) => {
  if (code === "DEP0062") return;
  _originalEmitWarning(warning, type, code);
}) as typeof process.emitWarning;

import log from "electron-log/main";
log.transports.console.level = "info";
log.initialize({ spyRendererConsole: true });

import { inheritLoginShellEnv, inheritLoginShellEnvAsync } from "./login-shell-env.js";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { app, BrowserWindow, Menu, ipcMain, nativeImage, net, protocol, session } from "electron";
import { createDaemonCommandHandlers, registerDaemonManager } from "./daemon/daemon-manager.js";
import { parsePassthroughCliArgsFromArgv, runPassthroughCli } from "./daemon/cli/passthrough.js";
import { closeAllTransportSessions } from "./daemon/local-transport.js";
import {
  registerWindowManager,
  getMainWindowChromeOptions,
  getWindowBackgroundColor,
  resolveSystemWindowTheme,
  setupWindowResizeEvents,
  setupDefaultContextMenu,
  setupDragDropPrevention,
  buildStandardContextMenuItems,
  getMainWindowSizingOptions,
} from "./window/window-manager.js";
import { setupDarwinCompositorWatchdog } from "./window/compositor-watchdog/index.js";
import { registerDialogHandlers } from "./features/dialogs.js";
import {
  registerNotificationHandlers,
  ensureNotificationCenterRegistration,
} from "./features/notifications.js";
import { registerOpenerHandlers } from "./features/opener.js";
import { setupApplicationMenu } from "./features/menu.js";
import { translateDesktop } from "./i18n.js";
import {
  getChisaCodeBrowserIdForWebContents,
  getChisaCodeBrowserWebContents,
  listRegisteredChisaCodeBrowserIds,
  registerChisaCodeBrowserWebContents,
  setWorkspaceActiveChisaCodeBrowserId,
} from "./features/browser-webviews.js";
import { parseOpenProjectPathFromArgv } from "./open-project-routing.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import {
  isDesktopManagedDaemonRunningSync,
  stopDesktopDaemonViaCli,
  isMainAppSenderUrl,
  resolveMainAppSenderValidationOptions,
} from "./daemon/daemon-manager.js";
import {
  createBeforeQuitHandler,
  stopDesktopManagedDaemonOnQuitIfNeeded,
} from "./daemon/quit-lifecycle.js";
import { runDesktopStartup } from "./desktop-startup.js";
import {
  isAllowedBrowserWebviewUrl,
  isBrowserRefreshInput,
  isBrowserLocationInput,
  isForwardableChisaCodeShortcutInput,
} from "./browser-webview-security.js";

const DEV_SERVER_URL = process.env.EXPO_DEV_URL ?? "http://localhost:8081";
const APP_SCHEMES = ["chisacode"] as const;
const APP_SCHEME = APP_SCHEMES[0];
const CHISACODE_DEBUG = process.env.CHISACODE_DEBUG === "1";
const DISABLE_SINGLE_INSTANCE_LOCK = process.env.CHISACODE_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const APP_NAME = process.env.CHISACODE_TEST_APP_NAME?.trim() || "ChisaCode";

function preventUnsafeBrowserWebviewNavigation(
  event: Electron.Event,
  url: string | undefined,
): void {
  if (!isAllowedBrowserWebviewUrl(url)) {
    event.preventDefault();
  }
}
const IPC_PREFIXES = ["chisacode"] as const;

const DESKTOP_SMOKE_ENV = "CHISACODE_DESKTOP_SMOKE";
const DESKTOP_SMOKE_STOP_REQUEST = "chisacode-smoke-stop";
app.setName(APP_NAME);

function getBrowserIdFromWebviewPartition(partition: string | undefined): string | null {
  const prefix = "persist:chisacode-browser-";
  if (!partition?.startsWith(prefix)) {
    return null;
  }
  const browserId = partition.slice(prefix.length).trim();
  return browserId.length > 0 ? browserId : null;
}

const pendingBrowserWebviewIds: string[] = [];

async function showBrowserWebviewContextMenu(
  win: BrowserWindow,
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Promise<void> {
  const language = (await getDesktopSettingsStore().get()).language;
  const t = (key: Parameters<typeof translateDesktop>[1]) => translateDesktop(language, key);
  const menu = Menu.buildFromTemplate([
    ...(await buildStandardContextMenuItems(contents, params)),
    ...(app.isPackaged
      ? []
      : [
          { type: "separator" as const },
          {
            label: t("menu.inspectElement"),
            click: () => {
              log.info("[browser-devtools] inspect-element.request", {
                webContentsId: contents.id,
                browserId: getChisaCodeBrowserIdForWebContents(contents),
                x: params.x,
                y: params.y,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
              contents.openDevTools({ mode: "detach" });
              contents.inspectElement(params.x, params.y);
              log.info("[browser-devtools] inspect-element.done", {
                webContentsId: contents.id,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
            },
          },
        ]),
  ]);
  menu.popup({ window: win });
}

// In dev mode, detect git worktrees and isolate each instance so multiple
// Electron windows can run side-by-side (separate userData = separate lock).
let devWorktreeName: string | null = null;
const forcedUserDataDir = process.env.CHISACODE_ELECTRON_USER_DATA_DIR?.trim();
if (forcedUserDataDir) {
  app.setPath("userData", forcedUserDataDir);
  log.info("[dev-user-data] forced userData dir:", forcedUserDataDir);
} else if (!app.isPackaged) {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    }).trim();
    devWorktreeName = path.basename(topLevel);
    // Main checkout (e.g. "chisacode") gets default userData — only worktrees diverge.
    const commonDir = path.resolve(
      topLevel,
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: topLevel,
        encoding: "utf-8",
        timeout: 3000,
        windowsHide: true,
      }).trim(),
    );
    const isWorktree = path.resolve(topLevel, ".git") !== commonDir;
    if (isWorktree) {
      app.setPath("userData", path.join(app.getPath("appData"), `ChisaCode-${devWorktreeName}`));
      log.info("[worktree] isolated userData for worktree:", devWorktreeName);
    } else {
      devWorktreeName = null;
    }
  } catch {
    devWorktreeName = null;
  }
}

// Linux AppImage runtimes mount the app from /tmp under the user's UID, so the
// SUID chrome-sandbox helper we ship in .deb/.rpm cannot work there (FUSE
// mounts do not support setuid). Disable the sandbox only for AppImage; .deb
// and .rpm keep the sandbox enabled, matching VS Code's approach.
//
// SECURITY NOTE: this removes the Chromium renderer sandbox as a defense-in-
// depth layer. The remaining protections that prevent a compromised renderer
// from escaping are:
//   - contextIsolation: true (no direct Node.js access from page context)
//   - nodeIntegration: false
//   - strict webview will-attach validation (src must be http/https/about:blank,
//     sandbox:true, webSecurity:true, preload stripped)
//   - privileged IPC commands validate sender frame URL (chisacode:// only)
// A renderer compromise first requires bypassing contextIsolation; only then
// does the missing sandbox become relevant. This is an accepted tradeoff for
// AppImage compatibility, consistent with VS Code and the broader Electron
// ecosystem. Do NOT extend `no-sandbox` to .deb/.rpm builds.
//
// Alternatives considered:
//   - user namespace sandbox: fails on hardened kernels that disable
//     unprivileged_userns_clone (common in enterprise Linux)
//   - zypak (Flatpak-style sandbox wrapper): adds runtime dependency and
//     packaging complexity not justified for the AppImage distribution
if (process.platform === "linux" && process.env.APPIMAGE) {
  app.commandLine.appendSwitch("no-sandbox");
}

// Allow users to pass a curated set of Chromium flags via CHISACODE_ELECTRON_FLAGS
// for debugging rendering issues (e.g. "--disable-gpu --ozone-platform=x11").
// Must run before app.whenReady().
//
// SECURITY: the allowlist avoids flags that weaken web security
// (--disable-web-security, --ignore-certificate-errors, etc.). Users who need
// those can still pass them directly on the command line when launching from a
// terminal; the env var is the convenience path and must stay safe.
const ALLOWED_ELECTRON_FLAGS = new Set([
  // GPU / rendering
  "disable-gpu",
  "disable-gpu-compositing",
  "disable-software-rasterizer",
  "enable-gpu-rasterization",
  "use-gl",
  "use-angle",
  // Display / compositor
  "ozone-platform",
  "disable-features",
  "enable-features",
  "disable-dev-shm-usage",
  // Logging
  "enable-logging",
  "v",
  "log-level",
  // Input
  "disable-pinch",
  "disable-overscroll-edge-effect",
]);

const electronFlags = process.env.CHISACODE_ELECTRON_FLAGS?.trim();
if (electronFlags) {
  const rejected: string[] = [];
  for (const token of electronFlags.split(/\s+/)) {
    const [key, ...rest] = token.replace(/^--/, "").split("=");
    if (!ALLOWED_ELECTRON_FLAGS.has(key)) {
      rejected.push(token);
      continue;
    }
    app.commandLine.appendSwitch(key, rest.join("=") || undefined);
  }
  if (rejected.length > 0) {
    log.warn(
      "[electron-flags] rejected non-allowlisted flags (use the command line directly if truly needed):",
      rejected,
    );
  }
  log.info("[electron-flags] applied:", electronFlags);
}

let pendingOpenProjectPath = parseOpenProjectPathFromArgv({
  argv: process.argv,
  isDefaultApp: process.defaultApp,
});

if (CHISACODE_DEBUG) {
  log.info("[open-project] argv:", process.argv);
  log.info("[open-project] isDefaultApp:", process.defaultApp);
  log.info("[open-project] pendingOpenProjectPath:", pendingOpenProjectPath);
}

function sendRendererEvent(
  contents: Electron.WebContents,
  event: string,
  payload: Record<string, unknown>,
): void {
  for (const prefix of IPC_PREFIXES) {
    contents.send(`${prefix}:event:${event}`, payload);
  }
}

// The renderer pulls the pending path on mount via IPC — this avoids
// a race where the push event arrives before React registers its listener.
function handlePendingOpenProject(): string | null {
  log.info("[open-project] renderer requested pending path:", pendingOpenProjectPath);
  const result = pendingOpenProjectPath;
  pendingOpenProjectPath = null;
  return result;
}

for (const prefix of IPC_PREFIXES) {
  ipcMain.handle(`${prefix}:get-pending-open-project`, handlePendingOpenProject);
}

function handleSetWorkspaceActiveBrowser(_event: unknown, browserId: unknown): void {
  setWorkspaceActiveChisaCodeBrowserId(typeof browserId === "string" ? browserId : null);
}

for (const prefix of IPC_PREFIXES) {
  ipcMain.handle(`${prefix}:browser:set-workspace-active-browser`, handleSetWorkspaceActiveBrowser);
}

function handleOpenBrowserDevtools(event: Electron.IpcMainInvokeEvent, browserId: unknown) {
  if (
    !isMainAppSenderUrl(
      event.senderFrame?.url ?? "",
      resolveMainAppSenderValidationOptions({ packaged: app.isPackaged }),
    )
  ) {
    log.warn("[browser-devtools] blocked open-devtools from non-main sender", {
      senderUrl: (event.senderFrame?.url ?? "").slice(0, 200),
    });
    return { ok: false, reason: "not-allowed" };
  }
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    const result = {
      ok: false,
      reason: "invalid-browser-id",
      browserId,
      registeredBrowserIds: listRegisteredChisaCodeBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.invalid", result);
    return result;
  }
  const contents = getChisaCodeBrowserWebContents(browserId);
  if (!contents) {
    const result = {
      ok: false,
      reason: "browser-webcontents-not-found",
      browserId,
      registeredBrowserIds: listRegisteredChisaCodeBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.not-found", result);
    return result;
  }
  log.info("[browser-devtools] open-devtools.request", {
    browserId,
    webContentsId: contents.id,
    isDestroyed: contents.isDestroyed(),
    isDevToolsOpened: contents.isDevToolsOpened(),
    registeredBrowserIds: listRegisteredChisaCodeBrowserIds(),
  });
  contents.openDevTools({ mode: "detach" });
  const result = {
    ok: true,
    reason: "opened",
    browserId,
    webContentsId: contents.id,
    isDevToolsOpened: contents.isDevToolsOpened(),
  };
  log.info("[browser-devtools] open-devtools.done", result);
  return result;
}

for (const prefix of IPC_PREFIXES) {
  ipcMain.handle(`${prefix}:browser:open-devtools`, handleOpenBrowserDevtools);
}

async function handleClearBrowserPartition(
  event: Electron.IpcMainInvokeEvent,
  browserId: unknown,
): Promise<void> {
  if (
    !isMainAppSenderUrl(
      event.senderFrame?.url ?? "",
      resolveMainAppSenderValidationOptions({ packaged: app.isPackaged }),
    )
  ) {
    log.warn("[browser-partition] blocked clear-partition from non-main sender", {
      senderUrl: (event.senderFrame?.url ?? "").slice(0, 200),
    });
    return;
  }
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return;
  }
  const partition = `persist:chisacode-browser-${browserId}`;
  await session.fromPartition(partition).clearStorageData();
}

for (const prefix of IPC_PREFIXES) {
  ipcMain.handle(`${prefix}:browser:clear-partition`, handleClearBrowserPartition);
}

protocol.registerSchemesAsPrivileged(
  APP_SCHEMES.map((scheme) => ({
    scheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  })),
);

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function getPreloadPath(): string {
  return path.join(__dirname, "preload.js");
}

function getAppDistDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-dist");
  }

  return path.resolve(__dirname, "../../app/dist");
}

function getWindowIconCandidates(): string[] {
  if (app.isPackaged) {
    if (process.platform === "win32") {
      return [
        path.join(process.resourcesPath, "icon.ico"),
        path.join(process.resourcesPath, "icon.png"),
      ];
    }
    return [path.join(process.resourcesPath, "icon.png")];
  }
  if (process.platform === "win32") {
    return [
      path.resolve(__dirname, "../assets/icon.ico"),
      path.resolve(__dirname, "../assets/icon.png"),
    ];
  }
  return [path.resolve(__dirname, "../assets/icon.png")];
}

function getWindowIconPath(): string | null {
  const candidates = getWindowIconCandidates();
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function applyAppIcon(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const iconPath = path.resolve(__dirname, "../assets/icon.png");
  if (!existsSync(iconPath)) {
    return;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return;
  }

  app.dock?.setIcon(icon);
}

async function createMainWindow(): Promise<void> {
  const iconPath = getWindowIconPath();
  const systemTheme = resolveSystemWindowTheme();

  const title = devWorktreeName ? `${APP_NAME} (${devWorktreeName})` : APP_NAME;
  const mainWindow = new BrowserWindow({
    title,
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: getWindowBackgroundColor(systemTheme),
    ...(iconPath ? { icon: iconPath } : {}),
    ...getMainWindowSizingOptions(),
    ...getMainWindowChromeOptions({
      platform: process.platform,
      theme: systemTheme,
    }),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (devWorktreeName) {
    app.dock?.setBadge(devWorktreeName);
  }

  setupDarwinCompositorWatchdog(mainWindow);
  setupWindowResizeEvents(mainWindow);
  setupDefaultContextMenu(mainWindow);
  setupDragDropPrevention(mainWindow);

  /**
   * Webview hardening — defense-in-depth layers enforced on every webview:
   *
   * Current protections:
   * - nodeIntegration / nodeIntegrationInSubFrames / nodeIntegrationInWorker: false
   * - contextIsolation: true
   * - sandbox: true
   * - webSecurity: true
   * - webviewTag: false (prevent nested webviews)
   * - allowRunningInsecureContent: false
   * - preload stripped (no custom preload scripts)
   * - src limited to http/https/about:blank (isAllowedBrowserWebviewUrl)
   * - partition must be named chisacode-browser-* (getBrowserIdFromWebviewPartition)
   * - Navigation guarded: will-navigate / will-frame-navigate / will-redirect
   * - window.open intercepted (setWindowOpenHandler)
   *
   * TODO(security): Audit webview-loaded resource origins (scripts, styles,
   * images, fonts, connect targets), then inject a Content-Security-Policy
   * header via webRequest.onHeadersReceived for frames that lack their own CSP.
   * Conservative starting point:
   *   default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
   *   img-src 'self' data: https:; connect-src 'self' https: wss:;
   *   frame-src 'self' https:; font-src 'self' data:
   */
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!isAllowedBrowserWebviewUrl(params.src)) {
      event.preventDefault();
      return;
    }
    const browserId = getBrowserIdFromWebviewPartition(params.partition);
    if (!browserId) {
      event.preventDefault();
      return;
    }
    pendingBrowserWebviewIds.push(browserId);
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.webviewTag = false;
    webPreferences.allowRunningInsecureContent = false;
    // Suppress native alert/confirm/prompt dialogs from webview content so a
    // loaded page cannot phish via OS-level modal dialogs.
    webPreferences.disableDialogs = true;
    delete webPreferences.preload;
    delete params.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    delete (params as { preloadURL?: string }).preloadURL;
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    const browserId = pendingBrowserWebviewIds.shift() ?? null;
    if (browserId) {
      registerChisaCodeBrowserWebContents(contents, browserId);
      log.info("[browser-webview] registered", {
        browserId,
        webContentsId: contents.id,
        registeredBrowserIds: listRegisteredChisaCodeBrowserIds(),
      });
    }
    contents.on("before-input-event", (event, input) => {
      if (isBrowserRefreshInput(input)) {
        event.preventDefault();
        if (contents.isLoadingMainFrame()) {
          contents.stop();
        } else {
          contents.reload();
        }
        return;
      }
      if (isBrowserLocationInput(input)) {
        event.preventDefault();
        const focusedBrowserId = getChisaCodeBrowserIdForWebContents(contents);
        sendRendererEvent(mainWindow.webContents, "browser-shortcut", {
          action: "focus-url",
          ...(focusedBrowserId ? { browserId: focusedBrowserId } : {}),
        });
        return;
      }
      if (isForwardableChisaCodeShortcutInput(input)) {
        event.preventDefault();
        sendRendererEvent(mainWindow.webContents, "browser-forwarded-key", {
          key: input.key,
          code: input.code,
          meta: input.meta,
          control: input.control,
          shift: input.shift,
          alt: input.alt,
        });
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedBrowserWebviewUrl(url)) {
        return { action: "deny" };
      }
      contents.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    });
    contents.on("context-menu", (_contextMenuEvent, params) => {
      void showBrowserWebviewContextMenu(mainWindow, contents, params);
    });
    contents.on("will-navigate", (event) => {
      preventUnsafeBrowserWebviewNavigation(event, event.url);
    });
    contents.on("will-frame-navigate", (event) => {
      preventUnsafeBrowserWebviewNavigation(event, event.url);
    });
    contents.on("will-redirect", (event) => {
      preventUnsafeBrowserWebviewNavigation(event, event.url);
    });
  });

  // In dev, show immediately so a stuck/white renderer is visible for debugging
  // instead of hiding behind a ready-to-show that may never fire. In packaged
  // builds, keep the flash-free ready-to-show behavior.
  if (app.isPackaged) {
    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });
  } else {
    mainWindow.show();
    mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
      log.error("[dev] did-fail-load", code, desc, url);
    });
  }

  if (!app.isPackaged) {
    // Load React DevTools without blocking the window: the extension is fetched
    // from the Chrome Web Store on first run, which can hang or be unreachable
    // on restricted networks. A blocked `await` here would delay
    // `mainWindow.loadURL(DEV_SERVER_URL)` indefinitely and leave the window
    // white. The DevTools are optional — never let their load gate the UI.
    import("./features/react-devtools.js")
      .then(({ loadReactDevTools }) => loadReactDevTools())
      .catch((err) => console.warn("[DevTools] failed to initialize:", err));
    await mainWindow.loadURL(DEV_SERVER_URL);
    return;
  }

  await mainWindow.loadURL(`${APP_SCHEME}://app/`);
}

function sendOpenProjectEvent(win: BrowserWindow, projectPath: string): void {
  const send = () => {
    log.info("[open-project] sending event to renderer:", projectPath);
    sendRendererEvent(win.webContents, "open-project", { path: projectPath });
  };

  if (win.webContents.isLoadingMainFrame()) {
    log.info("[open-project] waiting for did-finish-load before sending event");
    win.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function setupSingleInstanceLock(): boolean {
  if (DISABLE_SINGLE_INSTANCE_LOCK) {
    log.info("[single-instance] disabled by CHISACODE_DISABLE_SINGLE_INSTANCE_LOCK");
    return true;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, commandLine) => {
    log.info("[open-project] second-instance commandLine:", commandLine);
    const openProjectPath = parseOpenProjectPathFromArgv({
      argv: commandLine,
      isDefaultApp: false,
    });
    log.info("[open-project] second-instance openProjectPath:", openProjectPath);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
      if (openProjectPath) {
        sendOpenProjectEvent(win, openProjectPath);
      }
    }
  });

  return true;
}

async function runCliPassthroughIfRequested(): Promise<boolean> {
  const cliArgs = parsePassthroughCliArgsFromArgv(process.argv);
  if (!cliArgs) {
    return false;
  }

  try {
    const exitCode = await runPassthroughCli(cliArgs);
    app.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    app.exit(1);
  }

  return true;
}

async function runDesktopSmokeIfRequested(): Promise<boolean> {
  if (process.env[DESKTOP_SMOKE_ENV] !== "1") {
    return false;
  }

  const handlers = createDaemonCommandHandlers();
  const startStatus = await handlers.start_desktop_daemon();
  process.stdout.write(
    `[chisacode-smoke] ${JSON.stringify({
      type: "desktop-daemon-smoke-started",
      status: startStatus,
    })}\n`,
  );

  await waitForDesktopSmokeStopRequest();

  const stopStatus = await handlers.stop_desktop_daemon();
  process.stdout.write(
    `[chisacode-smoke] ${JSON.stringify({
      type: "desktop-daemon-smoke-stopped",
      stopStatus,
    })}\n`,
  );

  app.exit(0);
  return true;
}

function waitForDesktopSmokeStopRequest(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    const stop = () => {
      process.stdin.off("data", onData);
      resolve();
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes(DESKTOP_SMOKE_STOP_REQUEST)) {
        stop();
      }
    };

    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function bootstrap(): Promise<void> {
  if (!setupSingleInstanceLock()) {
    return;
  }

  await app.whenReady();

  const appDistDir = getAppDistDir();
  const handleAppSchemeRequest = (request: Request) => {
    const { pathname, search, hash } = new URL(request.url);
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      // Malformed percent-encoding (e.g. stray "%") would throw URIError.
      return new Response("Not found", { status: 404 });
    }

    // Chromium can occasionally request the exported entrypoint directly.
    // Canonicalize it back to the route URL so Expo Router sees `/`, not `/index.html`.
    if (decodedPath.endsWith("/index.html")) {
      const normalizedPath = decodedPath.slice(0, -"/index.html".length) || "/";
      return Response.redirect(`${APP_SCHEME}://app${normalizedPath}${search}${hash}`, 307);
    }

    const filePath = path.join(appDistDir, decodedPath);
    const relativePath = path.relative(appDistDir, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return new Response("Not found", { status: 404 });
    }

    // SPA fallback: serve index.html for routes without a file extension
    if (!relativePath || !path.extname(relativePath)) {
      return net.fetch(pathToFileURL(path.join(appDistDir, "index.html")).toString());
    }

    return net.fetch(pathToFileURL(filePath).toString());
  };

  for (const scheme of APP_SCHEMES) {
    protocol.handle(scheme, handleAppSchemeRequest);
  }

  applyAppIcon();
  setupApplicationMenu({ language: (await getDesktopSettingsStore().get()).language });
  ensureNotificationCenterRegistration();
  if (await runDesktopSmokeIfRequested()) {
    return;
  }
  registerDaemonManager();
  registerWindowManager();
  registerDialogHandlers({
    getLanguage: async () => (await getDesktopSettingsStore().get()).language,
  });
  registerNotificationHandlers();
  registerOpenerHandlers();

  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

void runDesktopStartup({
  hasPendingOpenProjectPath: Boolean(pendingOpenProjectPath),
  runCliPassthroughIfRequested,
  inheritLoginShellEnv,
  inheritLoginShellEnvAsync,
  bootstrapGui: bootstrap,
}).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

function showDaemonShutdownDialog(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendRendererEvent(win.webContents, "quitting", {});
  }
}

app.on(
  "before-quit",
  createBeforeQuitHandler({
    app,
    closeTransportSessions: closeAllTransportSessions,
    stopDesktopManagedDaemonIfNeeded: () =>
      stopDesktopManagedDaemonOnQuitIfNeeded({
        settingsStore: getDesktopSettingsStore(),
        isDesktopManagedDaemonRunning: isDesktopManagedDaemonRunningSync,
        stopDaemon: stopDesktopDaemonViaCli,
        showShutdownFeedback: showDaemonShutdownDialog,
      }),
    onStopError: (error) => {
      log.error("[desktop daemon] failed to stop managed daemon on quit", error);
    },
  }),
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
