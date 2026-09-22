import { beforeEach, describe, expect, it, vi } from "vitest";

// The preload module imports `electron` at module level — stub all of it.
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}));

import { createDesktopBridge } from "./preload";

function mockIpcRenderer() {
  return {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function createBridge() {
  return createDesktopBridge("chisacode", {
    ipcRenderer: mockIpcRenderer(),
    platform: "darwin",
    getPathForFile: vi.fn().mockReturnValue("/path/to/file"),
  });
}

describe("createDesktopBridge", () => {
  let bridge: ReturnType<typeof createBridge>;
  let ipc: ReturnType<typeof mockIpcRenderer>;

  beforeEach(() => {
    ipc = mockIpcRenderer();
    bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn().mockReturnValue("/tmp/file.png"),
    });
  });

  it("exposes the correct top-level namespace keys", () => {
    const keys = Object.keys(bridge).sort();
    expect(keys).toEqual([
      "browser",
      "dialog",
      "events",
      "getPendingOpenProject",
      "invoke",
      "menu",
      "notification",
      "opener",
      "platform",
      "webUtils",
      "window",
    ]);
  });

  it("exposes the platform value", () => {
    expect(bridge.platform).toBe("darwin");

    const winBridge = createDesktopBridge("chisacode", {
      ipcRenderer: mockIpcRenderer(),
      platform: "win32",
      getPathForFile: vi.fn(),
    });
    expect(winBridge.platform).toBe("win32");
  });

  it("invoke delegates to ipcRenderer.invoke with prefixed channel", () => {
    ipc.invoke.mockResolvedValue("result");
    void bridge.invoke("my-command", { key: "value" });
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:invoke", "my-command", { key: "value" });
  });

  it("getPendingOpenProject delegates to the correct IPC channel", () => {
    ipc.invoke.mockResolvedValue("/path/to/project");
    void bridge.getPendingOpenProject();
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:get-pending-open-project");
  });
});

describe("events.on", () => {
  it("registers a listener and returns an unsubscribe function", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    const handler = vi.fn();
    void bridge.events.on("test-event", handler);

    expect(ipc.on).toHaveBeenCalledWith("chisacode:event:test-event", expect.any(Function));
  });

  it("unsubscribe removes the listener via ipcRenderer.removeListener", async () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    const handler = vi.fn();
    const unsubscribe = await bridge.events.on("test-event", handler);

    // The listener was registered
    expect(ipc.on).toHaveBeenCalledTimes(1);
    const registeredListener = ipc.on.mock.calls[0][1];

    // Unsubscribe
    unsubscribe();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      "chisacode:event:test-event",
      registeredListener,
    );
  });
});

describe("window.getCurrentWindow", () => {
  it("toggleMaximize delegates to the correct IPC channel", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "win32",
      getPathForFile: vi.fn(),
    });

    void bridge.window.getCurrentWindow().toggleMaximize();
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:window:toggleMaximize");
  });

  it("setBadgeCount delegates with the count value", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "win32",
      getPathForFile: vi.fn(),
    });

    void bridge.window.getCurrentWindow().setBadgeCount(5);
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:window:setBadgeCount", 5);
  });

  it("onResized returns a direct unsubscribe function (not wrapped in Promise)", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "win32",
      getPathForFile: vi.fn(),
    });

    const unsubscribe = bridge.window.getCurrentWindow().onResized(vi.fn());
    expect(typeof unsubscribe).toBe("function");
    // Should NOT be a Promise
    expect(unsubscribe.then).toBeUndefined();
  });
});

describe("webUtils", () => {
  it("delegates getPathForFile to the provided implementation", () => {
    const getPathForFile = vi.fn().mockReturnValue("/tmp/upload.png");
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: mockIpcRenderer(),
      platform: "darwin",
      getPathForFile,
    });

    const fakeFile = { name: "photo.png" } as File;
    expect(bridge.webUtils.getPathForFile(fakeFile)).toBe("/tmp/upload.png");
    expect(getPathForFile).toHaveBeenCalledWith(fakeFile);
  });
});

describe("dialog", () => {
  it("ask delegates with message and options", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    void bridge.dialog.ask("Are you sure?", { buttons: ["Yes", "No"] });
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:dialog:ask", "Are you sure?", {
      buttons: ["Yes", "No"],
    });
  });

  it("open delegates with options", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    void bridge.dialog.open({ filters: [{ name: "Images", extensions: ["png"] }] });
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:dialog:open", {
      filters: [{ name: "Images", extensions: ["png"] }],
    });
  });
});

describe("browser", () => {
  it("setWorkspaceActiveBrowser delegates with browserId", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    void bridge.browser.setWorkspaceActiveBrowser("browser-1");
    expect(ipc.invoke).toHaveBeenCalledWith(
      "chisacode:browser:set-workspace-active-browser",
      "browser-1",
    );
  });

  it("openDevTools delegates with browserId", () => {
    const ipc = mockIpcRenderer();
    const bridge = createDesktopBridge("chisacode", {
      ipcRenderer: ipc,
      platform: "darwin",
      getPathForFile: vi.fn(),
    });

    void bridge.browser.openDevTools("browser-1");
    expect(ipc.invoke).toHaveBeenCalledWith("chisacode:browser:open-devtools", "browser-1");
  });
});
