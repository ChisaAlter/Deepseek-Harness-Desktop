// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

async function loadDownloadTextFile(input: {
  readonly isWeb: boolean;
  readonly share: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.doMock("@/constants/platform", () => ({ isWeb: input.isWeb }));
  vi.doMock("react-native", () => ({ Share: { share: input.share } }));
  return await import("./download-text-file");
}

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("triggers a real hidden anchor download on web", async () => {
    const share = vi.fn();
    const createObjectURL = vi.fn(() => "blob:qa-download");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.useFakeTimers();

    const appendedAnchors: HTMLAnchorElement[] = [];
    const originalAppend = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes: (Node | string)[]): void => {
      for (const node of nodes) {
        if (node instanceof HTMLAnchorElement) {
          appendedAnchors.push(node);
        }
      }
      originalAppend(...nodes);
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const remove = vi
      .spyOn(HTMLAnchorElement.prototype, "remove")
      .mockImplementation(() => undefined);

    const { downloadTextFile } = await loadDownloadTextFile({ isWeb: true, share });

    const result = await downloadTextFile("usage.json", '{"ok":true}', "application/json");

    expect(result).toBe(true);
    const anchor = appendedAnchors.at(0);
    expect(anchor).toBeDefined();
    expect(anchor?.href).toBe("blob:qa-download");
    expect(anchor?.download).toBe("usage.json");
    expect(anchor?.style.display).toBe("none");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:qa-download");
    vi.useRealTimers();
  });

  it("falls back to native share outside web", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { downloadTextFile } = await loadDownloadTextFile({ isWeb: false, share });

    const result = await downloadTextFile("daemon.log", "logs");

    expect(result).toBe(true);
    expect(share).toHaveBeenCalledWith({ title: "daemon.log", message: "logs" });
  });
});
