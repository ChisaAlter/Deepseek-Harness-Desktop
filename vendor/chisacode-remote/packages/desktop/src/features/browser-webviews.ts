import { webContents as allWebContents, type WebContents } from "electron";

const browserIdsByWebContentsId = new Map<number, string>();
let workspaceActiveBrowserId: string | null = null;

export function listRegisteredChisaCodeBrowserIds(): string[] {
  return Array.from(new Set(browserIdsByWebContentsId.values())).sort();
}

export function registerChisaCodeBrowserWebContents(
  contents: WebContents,
  browserId: string,
): void {
  browserIdsByWebContentsId.set(contents.id, browserId);
  contents.once("destroyed", () => {
    browserIdsByWebContentsId.delete(contents.id);
    if (workspaceActiveBrowserId === browserId) {
      workspaceActiveBrowserId = null;
    }
  });
}

export function getChisaCodeBrowserIdForWebContents(contents: WebContents | null): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserIdsByWebContentsId.get(contents.id) ?? null;
}

export function setWorkspaceActiveChisaCodeBrowserId(browserId: string | null): void {
  workspaceActiveBrowserId = browserId;
}

export function getChisaCodeBrowserWebContents(browserId: string): WebContents | null {
  for (const [contentsId, registeredBrowserId] of browserIdsByWebContentsId) {
    if (registeredBrowserId !== browserId) continue;
    const contents = allWebContents.fromId(contentsId);
    if (contents && !contents.isDestroyed()) {
      return contents;
    }
  }
  return null;
}

export function getWorkspaceActiveChisaCodeBrowserWebContents(): WebContents | null {
  if (!workspaceActiveBrowserId) {
    return null;
  }
  return getChisaCodeBrowserWebContents(workspaceActiveBrowserId);
}
