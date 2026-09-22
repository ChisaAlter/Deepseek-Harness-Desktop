import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePassthroughCliArgs,
  parsePassthroughCliArgsFromArgv,
  runPassthroughCli,
} from "./passthrough";

const originalDefaultApp = process.defaultApp;
const originalDesktopCli = process.env.CHISACODE_DESKTOP_CLI;

function setDefaultApp(value: boolean): void {
  Object.defineProperty(process, "defaultApp", {
    configurable: true,
    value,
  });
}

describe("passthrough CLI", () => {
  afterEach(() => {
    setDefaultApp(originalDefaultApp);
    if (originalDesktopCli === undefined) {
      delete process.env.CHISACODE_DESKTOP_CLI;
    } else {
      process.env.CHISACODE_DESKTOP_CLI = originalDesktopCli;
    }
  });

  it("returns null when no CLI args are provided", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/ChisaCode.app/Contents/MacOS/ChisaCode"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores macOS GUI launch arguments", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/ChisaCode.app/Contents/MacOS/ChisaCode", "-psn_0_12345"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores --no-sandbox injected by Linux wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/ChisaCode", "--no-sandbox", "status"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["status"]);
  });

  it("returns null when only --no-sandbox is present", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/ChisaCode", "--no-sandbox"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores Electron and shortcut metadata arguments used for GUI launches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "C:\\Program Files\\ChisaCode\\ChisaCode.exe",
          "--allow-file-access-from-files",
          "--secure-schemes=chisacode",
          "--fetch-schemes=chisacode",
          "--standard-schemes=chisacode",
          "--remote-debugging-port=9333",
          "--enable-logging",
          "--source-shortcut=C:\\Users\\me\\Desktop\\ChisaCode.lnk",
        ],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores Playwright Electron automation debug arguments used for GUI launches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "C:\\Program Files\\ChisaCode\\ChisaCode.exe",
          "--inspect=0",
          "--remote-debugging-port=0",
        ],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("preserves CLI flags for direct app invocations", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/ChisaCode.app/Contents/MacOS/ChisaCode", "--version"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--version"]);
  });

  it("passes --open-project through as a normal CLI arg", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
          "--open-project",
          "/tmp/project",
        ],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--open-project", "/tmp/project"]);
  });

  it("forces CLI mode for shim launches even without args", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/ChisaCode.app/Contents/MacOS/ChisaCode"],
        isDefaultApp: false,
        forceCli: true,
      }),
    ).toEqual([]);
  });

  it("parses terminal args for direct app CLI passthrough", () => {
    setDefaultApp(false);
    delete process.env.CHISACODE_DESKTOP_CLI;

    expect(
      parsePassthroughCliArgsFromArgv([
        "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
        "daemon",
        "set-password",
      ]),
    ).toEqual(["daemon", "set-password"]);
  });

  it("runs passthrough CLI through the programmatic entrypoint", async () => {
    const runCli = vi.fn(async () => 7);

    await expect(runPassthroughCli(["daemon", "set-password"], { runCli })).resolves.toBe(7);

    expect(runCli).toHaveBeenCalledWith(["daemon", "set-password"]);
  });
});
