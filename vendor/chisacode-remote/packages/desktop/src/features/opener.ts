import path from "node:path";
import { app, shell, ipcMain } from "electron";
import { translateDesktop } from "../i18n.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import {
  isMainAppSenderUrl,
  resolveMainAppSenderValidationOptions,
} from "../daemon/daemon-manager.js";

const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);
const IPC_PREFIXES = ["chisacode"] as const;

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function isAllowedLocalPath(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\0") && path.isAbsolute(value);
}

export function registerOpenerHandlers(): void {
  const openUrl = async (_event: Electron.IpcMainInvokeEvent, url: unknown) => {
    const language = (await getDesktopSettingsStore().get()).language;
    if (!isAllowedExternalUrl(url)) {
      throw new Error(translateDesktop(language, "opener.unsupportedExternalUrl"));
    }
    await shell.openExternal(url);
  };

  const openPath = async (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    const senderUrl = event.senderFrame?.url ?? event.sender?.getURL?.() ?? "";
    if (
      !isMainAppSenderUrl(
        senderUrl,
        resolveMainAppSenderValidationOptions({ packaged: app.isPackaged }),
      )
    ) {
      throw new Error("Opening local paths is not available from this context");
    }
    if (!isAllowedLocalPath(value)) {
      throw new Error("A valid absolute path is required");
    }
    const error = await shell.openPath(value);
    if (error) {
      throw new Error(error);
    }
  };

  for (const prefix of IPC_PREFIXES) {
    ipcMain.handle(`${prefix}:opener:openUrl`, openUrl);
    ipcMain.handle(`${prefix}:opener:openPath`, openPath);
  }
}
