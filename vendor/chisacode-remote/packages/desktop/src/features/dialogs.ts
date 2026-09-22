import { dialog, ipcMain, BrowserWindow } from "electron";
import { translateDesktop, type DesktopTranslationKey } from "../i18n.js";
import type { AppLanguage } from "../settings/desktop-settings.js";

interface AskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

interface AskWithCheckboxOptions extends AskOptions {
  checkboxLabel: string;
  checkboxChecked?: boolean;
}

interface OpenOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface DialogHandlerOptions {
  getLanguage?: () => AppLanguage | Promise<AppLanguage>;
}

const IPC_PREFIXES = ["chisacode"] as const;

function resolveDialogType(kind: AskOptions["kind"]): "warning" | "error" | "question" {
  if (kind === "warning") return "warning";
  if (kind === "error") return "error";
  return "question";
}

function getFocusedWindowSafe(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerDialogHandlers(handlerOptions: DialogHandlerOptions = {}): void {
  const getLanguage = async () => (await handlerOptions.getLanguage?.()) ?? "zh-CN";

  const ask = async (event: Electron.IpcMainInvokeEvent, message: string, options?: AskOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getFocusedWindowSafe();
    if (!win) return false;
    const language = await getLanguage();
    const t = (key: DesktopTranslationKey) => translateDesktop(language, key);
    const result = await dialog.showMessageBox(win, {
      type: resolveDialogType(options?.kind),
      title: options?.title ?? t("dialog.confirm"),
      message,
      buttons: [options?.cancelLabel ?? t("dialog.cancel"), options?.okLabel ?? t("dialog.ok")],
      defaultId: 1,
      cancelId: 0,
    });
    return result.response === 1;
  };

  const askWithCheckbox = async (
    event: Electron.IpcMainInvokeEvent,
    message: string,
    options: AskWithCheckboxOptions,
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getFocusedWindowSafe();
    if (!win) return { confirmed: false, dontAskAgain: false };
    const language = await getLanguage();
    const t = (key: DesktopTranslationKey) => translateDesktop(language, key);
    const result = await dialog.showMessageBox(win, {
      type: resolveDialogType(options.kind),
      title: options.title ?? t("dialog.confirm"),
      message,
      buttons: [options.cancelLabel ?? t("dialog.cancel"), options.okLabel ?? t("dialog.ok")],
      defaultId: 1,
      cancelId: 0,
      checkboxLabel: options.checkboxLabel,
      checkboxChecked: options.checkboxChecked ?? false,
    });
    return {
      confirmed: result.response === 1,
      dontAskAgain: result.checkboxChecked,
    };
  };

  const open = async (event: Electron.IpcMainInvokeEvent, options?: OpenOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getFocusedWindowSafe();
    if (!win) return null;
    const properties: Electron.OpenDialogOptions["properties"] = [];
    if (options?.directory) properties.push("openDirectory");
    if (options?.multiple) properties.push("multiSelections");
    if (!options?.directory) properties.push("openFile");

    const result = await dialog.showOpenDialog(win, {
      title: options?.title,
      defaultPath: options?.defaultPath,
      properties,
      filters: options?.filters,
    });

    if (result.canceled) return null;
    return options?.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  };

  for (const prefix of IPC_PREFIXES) {
    ipcMain.handle(`${prefix}:dialog:ask`, ask);
    ipcMain.handle(`${prefix}:dialog:askWithCheckbox`, askWithCheckbox);
    ipcMain.handle(`${prefix}:dialog:open`, open);
  }
}
