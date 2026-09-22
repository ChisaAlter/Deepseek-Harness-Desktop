import { app, Menu, BrowserWindow, ipcMain } from "electron";
import { getWorkspaceActiveChisaCodeBrowserWebContents } from "./browser-webviews.js";
import { translateDesktop, type DesktopTranslationKey } from "../i18n.js";
import type { AppLanguage } from "../settings/desktop-settings.js";

interface ShowContextMenuInput {
  kind?: "terminal";
  hasSelection?: boolean;
}

let applicationMenuLanguage: AppLanguage = "zh-CN";
const IPC_PREFIXES = ["chisacode"] as const;

function withBrowserWindow(
  callback: (win: BrowserWindow) => void,
): (_item: Electron.MenuItem, baseWin: Electron.BaseWindow | undefined) => void {
  return (_item, baseWin) => {
    const win = baseWin instanceof BrowserWindow ? baseWin : BrowserWindow.getFocusedWindow();
    if (win) callback(win);
  };
}

function getReloadTargetBrowserWebContents(): Electron.WebContents | null {
  return getWorkspaceActiveChisaCodeBrowserWebContents();
}

function reloadFocusedContentsOrWindow(win: BrowserWindow, options?: { ignoreCache?: boolean }) {
  const browserContents = getReloadTargetBrowserWebContents();
  if (browserContents) {
    if (options?.ignoreCache) {
      browserContents.reloadIgnoringCache();
      return;
    }
    if (browserContents.isLoadingMainFrame()) {
      browserContents.stop();
      return;
    }
    browserContents.reload();
    return;
  }

  if (options?.ignoreCache) {
    win.webContents.reloadIgnoringCache();
    return;
  }
  win.webContents.reload();
}

function buildApplicationMenu(language: AppLanguage): void {
  const isMac = process.platform === "darwin";
  const t = (key: DesktopTranslationKey) => translateDesktop(language, key);

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: t("menu.edit"),
      submenu: [
        { label: t("menu.undo"), role: "undo" },
        { label: t("menu.redo"), role: "redo" },
        { type: "separator" },
        { label: t("menu.cut"), role: "cut" },
        { label: t("menu.copy"), role: "copy" },
        { label: t("menu.paste"), role: "paste" },
        { label: t("menu.selectAll"), role: "selectAll" },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        {
          label: t("menu.zoomIn"),
          accelerator: "CmdOrCtrl+=",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
          }),
        },
        {
          label: t("menu.zoomOut"),
          accelerator: "CmdOrCtrl+-",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
          }),
        },
        {
          label: t("menu.actualSize"),
          accelerator: "CmdOrCtrl+0",
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(0);
          }),
        },
        { type: "separator" },
        {
          label: t("menu.reload"),
          accelerator: "CmdOrCtrl+R",
          click: withBrowserWindow((win) => {
            reloadFocusedContentsOrWindow(win);
          }),
        },
        {
          label: t("menu.forceReload"),
          accelerator: "CmdOrCtrl+Shift+R",
          click: withBrowserWindow((win) => {
            reloadFocusedContentsOrWindow(win, { ignoreCache: true });
          }),
        },
        { label: t("menu.toggleDevTools"), role: "toggleDevTools" },
        { type: "separator" },
        { label: t("menu.toggleFullscreen"), role: "togglefullscreen" },
      ],
    },
    {
      label: t("menu.window"),
      submenu: [
        { label: t("menu.minimize"), role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ label: t("menu.close"), role: "close" as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

export function setApplicationMenuLanguage(language: AppLanguage): void {
  applicationMenuLanguage = language;
  buildApplicationMenu(language);
}

export function setupApplicationMenu(options: { language?: AppLanguage } = {}): void {
  applicationMenuLanguage = options.language ?? applicationMenuLanguage;
  buildApplicationMenu(applicationMenuLanguage);

  const showContextMenu = (event: Electron.IpcMainInvokeEvent, input?: ShowContextMenuInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }

    if (input?.kind !== "terminal") {
      return;
    }

    const t = (key: DesktopTranslationKey) => translateDesktop(applicationMenuLanguage, key);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: t("menu.copy"),
        role: "copy",
        enabled: input.hasSelection === true,
      },
      {
        label: t("menu.paste"),
        role: "paste",
      },
      {
        type: "separator",
      },
      {
        label: t("menu.selectAll"),
        role: "selectAll",
      },
    ]);

    contextMenu.popup({ window: win });
  };

  for (const prefix of IPC_PREFIXES) {
    ipcMain.removeHandler(`${prefix}:menu:showContextMenu`);
    ipcMain.handle(`${prefix}:menu:showContextMenu`, showContextMenu);
  }
}
