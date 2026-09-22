import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { WebUtils } from "electron";

type EventHandler = (payload: unknown) => void;

export interface ChisaCodeDesktopApi {
  platform: NodeJS.Platform;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  getPendingOpenProject: () => Promise<string | null>;
  events: {
    on: (event: string, handler: EventHandler) => Promise<() => void>;
  };
  window: {
    getCurrentWindow: () => {
      toggleMaximize: () => Promise<unknown>;
      minimize: () => Promise<unknown>;
      close: () => Promise<unknown>;
      isMaximized: () => Promise<unknown>;
      isFullscreen: () => Promise<unknown>;
      updateWindowControls: (update: {
        height?: number;
        backgroundColor?: string;
        foregroundColor?: string;
      }) => Promise<unknown>;
      onResized: (handler: EventHandler) => () => void;
      setBadgeCount: (count?: number) => Promise<unknown>;
    };
  };
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) => Promise<unknown>;
    askWithCheckbox: (message: string, options: Record<string, unknown>) => Promise<unknown>;
    open: (options?: Record<string, unknown>) => Promise<unknown>;
  };
  notification: {
    isSupported: () => Promise<unknown>;
    sendNotification: (payload: {
      title: string;
      body?: string;
      data?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  opener: {
    openUrl: (url: string) => Promise<unknown>;
    openPath: (path: string) => Promise<unknown>;
  };
  webUtils: {
    getPathForFile: (file: File) => string;
  };
  menu: {
    showContextMenu: (input?: Record<string, unknown>) => Promise<unknown>;
  };
  browser: {
    setWorkspaceActiveBrowser: (browserId: string | null) => Promise<unknown>;
    openDevTools: (browserId: string) => Promise<unknown>;
    clearPartition: (browserId: string) => Promise<unknown>;
  };
}

/**
 * Builds the desktop bridge API object from injectable dependencies so
 * the contract can be tested without spinning up a real Electron preload
 * context.
 */
export function createDesktopBridge(
  channelPrefix: "chisacode",
  deps: {
    ipcRenderer: Pick<Electron.IpcRenderer, "invoke" | "on" | "removeListener">;
    platform: NodeJS.Platform;
    getPathForFile: WebUtils["getPathForFile"];
  },
): ChisaCodeDesktopApi {
  const { ipcRenderer: ipc, platform, getPathForFile } = deps;
  const channel = (name: string) => `${channelPrefix}:${name}`;

  return {
    platform,
    invoke: (command: string, args?: Record<string, unknown>) =>
      ipc.invoke(channel("invoke"), command, args),
    getPendingOpenProject: () =>
      ipc.invoke(channel("get-pending-open-project")) as Promise<string | null>,
    events: {
      on: (event: string, handler: EventHandler): Promise<() => void> => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipc.on(channel(`event:${event}`), listener);
        return Promise.resolve(() => {
          ipc.removeListener(channel(`event:${event}`), listener);
        });
      },
    },
    window: {
      getCurrentWindow: () => ({
        toggleMaximize: () => ipc.invoke(channel("window:toggleMaximize")),
        minimize: () => ipc.invoke(channel("window:minimize")),
        close: () => ipc.invoke(channel("window:close")),
        isMaximized: () => ipc.invoke(channel("window:isMaximized")),
        isFullscreen: () => ipc.invoke(channel("window:isFullscreen")),
        updateWindowControls: (update: {
          height?: number;
          backgroundColor?: string;
          foregroundColor?: string;
        }) => ipc.invoke(channel("window:updateWindowControls"), update),
        onResized: (handler: EventHandler): (() => void) => {
          const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
            handler(payload);
          };
          ipc.on(channel("window:resized"), listener);
          return () => {
            ipc.removeListener(channel("window:resized"), listener);
          };
        },
        setBadgeCount: (count?: number) => ipc.invoke(channel("window:setBadgeCount"), count),
      }),
    },
    dialog: {
      ask: (message: string, options?: Record<string, unknown>) =>
        ipc.invoke(channel("dialog:ask"), message, options),
      askWithCheckbox: (message: string, options: Record<string, unknown>) =>
        ipc.invoke(channel("dialog:askWithCheckbox"), message, options),
      open: (options?: Record<string, unknown>) => ipc.invoke(channel("dialog:open"), options),
    },
    notification: {
      isSupported: () => ipc.invoke(channel("notification:isSupported")),
      sendNotification: (payload: {
        title: string;
        body?: string;
        data?: Record<string, unknown>;
      }) => ipc.invoke(channel("notification:send"), payload),
    },
    opener: {
      openUrl: (url: string) => ipc.invoke(channel("opener:openUrl"), url),
      openPath: (path: string) => ipc.invoke(channel("opener:openPath"), path),
    },
    webUtils: {
      getPathForFile: (file: File) => getPathForFile(file),
    },
    menu: {
      showContextMenu: (input?: Record<string, unknown>) =>
        ipc.invoke(channel("menu:showContextMenu"), input),
    },
    browser: {
      setWorkspaceActiveBrowser: (browserId: string | null) =>
        ipc.invoke(channel("browser:set-workspace-active-browser"), browserId),
      openDevTools: (browserId: string) => ipc.invoke(channel("browser:open-devtools"), browserId),
      clearPartition: (browserId: string) =>
        ipc.invoke(channel("browser:clear-partition"), browserId),
    },
  };
}

contextBridge.exposeInMainWorld(
  "chisacodeDesktop",
  createDesktopBridge("chisacode", {
    ipcRenderer,
    platform: process.platform,
    getPathForFile: webUtils.getPathForFile.bind(webUtils),
  }),
);
