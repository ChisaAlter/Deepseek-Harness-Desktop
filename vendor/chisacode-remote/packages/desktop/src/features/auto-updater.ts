import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { UUID } from "builder-util-runtime";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { z } from "zod/v3";
import { translateDesktop } from "../i18n.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  body: string | null;
  date: string | null;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export type AppReleaseChannel = "stable" | "beta";

export const rolloutManifestSchema = z.object({
  rolloutHours: z
    .union([z.number(), z.string().transform(Number)])
    .pipe(z.number().finite().nonnegative())
    .optional()
    .catch(undefined),
  releaseDate: z.string().optional().catch(undefined),
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedUpdateInfo: UpdateInfo | null = null;
let downloadedUpdateVersion: string | null = null;
let downloading = false;
let autoUpdaterConfigured = false;
let configuredReleaseChannel: AppReleaseChannel | null = null;
let cachedStagingUserIdPromise: Promise<string> | null = null;

export function shouldAdmitToRollout(args: {
  channel: AppReleaseChannel;
  rolloutHours: number | undefined;
  releaseDate: string | undefined;
  now: number;
  bucket: number;
}): boolean {
  if (args.channel !== "stable") return true;
  if (args.rolloutHours == null) return true;
  if (args.rolloutHours === 0) return true;
  if (!args.releaseDate) return true;

  const releaseTime = new Date(args.releaseDate).getTime();
  if (Number.isNaN(releaseTime)) return true;

  const ageHours = (args.now - releaseTime) / 3_600_000;
  if (ageHours < 0) return false;

  const pct = Math.min(100, (ageHours / args.rolloutHours) * 100);
  return args.bucket * 100 < pct;
}

export function bucketFromStagingUserId(stagingUserId: string): number {
  return UUID.parse(stagingUserId).readUInt32BE(12) / 0x100000000;
}

let inMemoryStagingUserId: string | null = null;

export async function resolveStagingUserId(filePath: string): Promise<string> {
  try {
    const id = (await readFile(filePath, "utf8")).trim();
    if (UUID.check(id)) {
      return id;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[auto-updater] Couldn't read staging user ID, creating a blank one: ${error}`);
    }
  }

  if (inMemoryStagingUserId != null) {
    return inMemoryStagingUserId;
  }

  const id = UUID.v5(randomBytes(4096), UUID.OID);
  inMemoryStagingUserId = id;

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, id);
  } catch (error) {
    console.warn(`[auto-updater] Couldn't write out staging user ID: ${error}`);
  }

  return id;
}

export function getStagingUserId(): Promise<string> {
  if (cachedStagingUserIdPromise == null) {
    cachedStagingUserIdPromise = resolveStagingUserId(
      path.join(app.getPath("userData"), ".updaterId"),
    );
  }
  return cachedStagingUserIdPromise;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function configureAutoUpdater(releaseChannel: AppReleaseChannel): void {
  // Download updates in the background and only prompt once they are ready to install.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Suppress built-in dialogs; the renderer handles UI.
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = releaseChannel === "beta";
  autoUpdater.channel = releaseChannel === "beta" ? "beta" : "latest";
  autoUpdater.allowDowngrade = false;
  autoUpdater.isUserWithinRollout = async (info) => {
    try {
      const parsed = rolloutManifestSchema.parse(info);
      const stagingUserId = await getStagingUserId();

      return shouldAdmitToRollout({
        channel: releaseChannel,
        rolloutHours: parsed.rolloutHours,
        releaseDate: parsed.releaseDate,
        now: Date.now(),
        bucket: bucketFromStagingUserId(stagingUserId),
      });
    } catch {
      return true;
    }
  };

  if (configuredReleaseChannel !== releaseChannel) {
    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    downloading = false;
    configuredReleaseChannel = releaseChannel;
  }

  if (autoUpdaterConfigured) {
    return;
  }

  autoUpdaterConfigured = true;

  autoUpdater.on("update-available", (info) => {
    cachedUpdateInfo = info;
    downloadedUpdateVersion = null;
    downloading = true;
  });

  autoUpdater.on("update-downloaded", (info) => {
    cachedUpdateInfo = info;
    downloadedUpdateVersion = info.version;
    downloading = false;
  });

  autoUpdater.on("update-not-available", () => {
    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    downloading = false;
  });

  autoUpdater.on("error", (error) => {
    downloading = false;
    // Preserve cachedUpdateInfo for transient network errors so users don't
    // see "no update" flicker on a flaky connection. Only clear it for fatal
    // errors that indicate the cached info is no longer trustworthy.
    if (!isTransientNetworkError(error)) {
      cachedUpdateInfo = null;
    }
    console.error("[auto-updater] Updater event failed:", error);
  });
}

/**
 * Detect transient network errors where retaining cachedUpdateInfo is
 * preferable to clearing it (which would make the next check report "no
 * update" until the network recovers).
 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  // electron-updater / node fetch surface these for DNS, socket hangup,
  // connection reset, and timeout. Keep the list conservative.
  return (
    message.includes("getaddrinfo") ||
    message.includes("enotfound") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("abort")
  );
}

function isReadyToInstallVersion(version: string): boolean {
  return downloadedUpdateVersion === version;
}

function buildCheckResult(input: {
  currentVersion: string;
  hasUpdate: boolean;
  readyToInstall: boolean;
  info?: UpdateInfo | null;
}): AppUpdateCheckResult {
  const { currentVersion, hasUpdate, readyToInstall, info } = input;

  return {
    hasUpdate,
    readyToInstall,
    currentVersion,
    latestVersion: info?.version ?? currentVersion,
    body: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
    date: typeof info?.releaseDate === "string" ? info.releaseDate : null,
  };
}

async function performQuitAndInstall(onBeforeQuit?: () => Promise<void>): Promise<void> {
  if (onBeforeQuit) await onBeforeQuit();
  autoUpdater.quitAndInstall(/* isSilent */ false, /* isForceRunAfter */ true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkForAppUpdate({
  currentVersion,
  releaseChannel,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
}): Promise<AppUpdateCheckResult> {
  if (!app.isPackaged) {
    return buildCheckResult({
      currentVersion,
      hasUpdate: false,
      readyToInstall: false,
    });
  }

  configureAutoUpdater(releaseChannel);

  const cachedVersion = cachedUpdateInfo?.version ?? null;
  if (cachedVersion && cachedVersion !== currentVersion) {
    return buildCheckResult({
      currentVersion,
      hasUpdate: true,
      readyToInstall: isReadyToInstallVersion(cachedVersion),
      info: cachedUpdateInfo,
    });
  }

  try {
    const result = await autoUpdater.checkForUpdates();

    if (!result || !result.updateInfo) {
      return buildCheckResult({
        currentVersion,
        hasUpdate: false,
        readyToInstall: false,
      });
    }

    const info = result.updateInfo;
    const latestVersion = info.version;
    const hasUpdate = latestVersion !== currentVersion;

    if (hasUpdate) {
      cachedUpdateInfo = info;
      downloading = !isReadyToInstallVersion(latestVersion);
      return buildCheckResult({
        currentVersion,
        hasUpdate: true,
        readyToInstall: isReadyToInstallVersion(latestVersion),
        info,
      });
    }

    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    downloading = false;

    return buildCheckResult({
      currentVersion,
      hasUpdate: false,
      readyToInstall: false,
    });
  } catch (error) {
    console.error("[auto-updater] Failed to check for updates:", error);
    throw error;
  }
}

export async function downloadAndInstallUpdate(
  {
    currentVersion,
    releaseChannel,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
  },
  onBeforeQuit?: () => Promise<void>,
): Promise<AppUpdateInstallResult> {
  const language = (await getDesktopSettingsStore().get()).language;
  const t = (key: Parameters<typeof translateDesktop>[1]) => translateDesktop(language, key);
  if (!app.isPackaged) {
    return {
      installed: false,
      version: currentVersion,
      message: t("updater.devUnavailable"),
    };
  }

  if (!cachedUpdateInfo) {
    return {
      installed: false,
      version: currentVersion,
      message: t("updater.noUpdate"),
    };
  }

  if (downloading) {
    return {
      installed: false,
      version: currentVersion,
      message: t("updater.preparing"),
    };
  }

  configureAutoUpdater(releaseChannel);

  const readyVersion = cachedUpdateInfo.version;
  if (isReadyToInstallVersion(readyVersion)) {
    await performQuitAndInstall(onBeforeQuit);
    return {
      installed: true,
      version: readyVersion,
      message: t("updater.downloadedRestart"),
    };
  }

  downloading = true;

  try {
    await autoUpdater.downloadUpdate();
    downloadedUpdateVersion = readyVersion;
    downloading = false;
    await performQuitAndInstall(onBeforeQuit);

    return {
      installed: true,
      version: readyVersion,
      message: t("updater.downloadedRestart"),
    };
  } catch (error) {
    downloading = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auto-updater] Failed to download/install update:", message);
    return {
      installed: false,
      version: currentVersion,
      message: `${t("updater.failedPrefix")}：${message}`,
    };
  }
}
