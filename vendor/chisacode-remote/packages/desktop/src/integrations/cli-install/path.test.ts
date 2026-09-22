import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
        shimPath: "/Applications/ChisaCode.app/Contents/Resources/bin/chisacode",
      }),
    ).toBe("/Applications/ChisaCode.app/Contents/Resources/bin/chisacode");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_chisacode123/chisacode",
        shimPath: "/tmp/.mount_chisacode123/resources/bin/chisacode",
        appImagePath: "/home/user/Applications/ChisaCode.AppImage",
      }),
    ).toBe("/home/user/Applications/ChisaCode.AppImage");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\ChisaCode\\ChisaCode.exe",
        shimPath:
          "C:\\Users\\user\\AppData\\Local\\Programs\\ChisaCode\\resources\\bin\\chisacode.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\ChisaCode\\resources\\bin\\chisacode.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/ChisaCode/chisacode",
        shimPath: "/opt/ChisaCode/resources/bin/chisacode",
      }),
    ).toBe("/opt/ChisaCode/resources/bin/chisacode");
  });
});
