import { ipcMain, shell } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAllowedExternalUrl, isAllowedLocalPath, registerOpenerHandlers } from "./opener";

vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(async () => "") },
}));

vi.mock("../daemon/daemon-manager.js", () => ({
  isMainAppSenderUrl: (url: string) => url.startsWith("chisacode://app"),
}));

// opener.ts reads the configured language via getDesktopSettingsStore() to
// translate the "unsupported external URL" error. Mock the settings module so
// the test does not pull in `app.getPath("userData")` (which the electron mock
// above does not expose). Use English so the thrown message matches the
// assertion below.
vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => ({ language: "en" }),
  }),
}));

function getRegisteredOpenUrlHandler(): (_event: unknown, url: unknown) => Promise<void> {
  registerOpenerHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
    return channel === "chisacode:opener:openUrl";
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error("open URL handler was not registered");
  }
  return handler as (_event: unknown, url: unknown) => Promise<void>;
}

function getRegisteredOpenPathHandler(): (_event: unknown, path: unknown) => Promise<void> {
  registerOpenerHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
    return channel === "chisacode:opener:openPath";
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error("open path handler was not registered");
  }
  return handler as (_event: unknown, path: unknown) => Promise<void>;
}

describe("desktop opener", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(shell.openExternal).mockReset();
    vi.mocked(shell.openPath).mockReset();
    vi.mocked(shell.openPath).mockResolvedValue("");
  });

  it("accepts only absolute local paths", () => {
    expect(isAllowedLocalPath("C:\\Ai\\ChisaCode")).toBe(true);
    expect(isAllowedLocalPath("/tmp/project")).toBe(true);
    expect(isAllowedLocalPath("relative/project")).toBe(false);
    expect(isAllowedLocalPath("C:\\Ai\\bad\0path")).toBe(false);
  });

  it("allows only http and https external URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/path")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:8081")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("chisacode://settings")).toBe(false);
    expect(isAllowedExternalUrl("/relative/path")).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
  });

  it("opens allowed URLs through Electron shell", async () => {
    const handler = getRegisteredOpenUrlHandler();

    await handler({}, "https://example.com");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects blocked URLs before invoking Electron shell", async () => {
    const handler = getRegisteredOpenUrlHandler();

    await expect(handler({}, "file:///etc/passwd")).rejects.toThrow("Unsupported external URL");

    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens absolute paths from the trusted main app", async () => {
    const handler = getRegisteredOpenPathHandler();

    await handler({ senderFrame: { url: "chisacode://app/" } }, "C:\\Ai\\ChisaCode");

    expect(shell.openPath).toHaveBeenCalledWith("C:\\Ai\\ChisaCode");
  });

  it("rejects local path requests from untrusted frames", async () => {
    const handler = getRegisteredOpenPathHandler();

    await expect(
      handler({ senderFrame: { url: "https://example.com" } }, "C:\\Ai\\ChisaCode"),
    ).rejects.toThrow("not available from this context");

    expect(shell.openPath).not.toHaveBeenCalled();
  });
});
