import { describe, expect, it } from "vitest";
import {
  createNodeEntrypointInvocation,
  type NodeEntrypointSpec,
} from "./node-entrypoint-launcher";

const CLI_ENTRYPOINT: NodeEntrypointSpec = {
  entryPath: "/tmp/chisacode-cli.js",
  execArgv: ["--import", "tsx"],
};

describe("node-entrypoint-launcher", () => {
  describe("createNodeEntrypointInvocation", () => {
    it("uses the packaged runner when the desktop app is packaged", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/ChisaCode.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["ls", "--json"],
          baseEnv: { PATH: "/usr/bin" },
        }),
      ).toEqual({
        command: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
        args: [
          "--disable-warning=DEP0040",
          "/Applications/ChisaCode.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          "node-script",
          "/tmp/chisacode-cli.js",
          "ls",
          "--json",
        ],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
          CHISACODE_NODE_ENV: "production",
        },
      });
    });

    it("uses the entrypoint directly in development", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/opt/homebrew/bin/electron",
          isPackaged: false,
          packagedRunnerPath: null,
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["ls"],
          baseEnv: { PATH: "/usr/bin" },
        }),
      ).toEqual({
        command: "/opt/homebrew/bin/electron",
        args: ["--import", "tsx", "/tmp/chisacode-cli.js", "ls"],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
        },
      });
    });

    it("forces packaged launches to production even when NODE_ENV is inherited as development", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/ChisaCode.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: [],
          baseEnv: { PATH: "/usr/bin", NODE_ENV: "development" },
        }).env,
      ).toMatchObject({
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "development",
        CHISACODE_NODE_ENV: "production",
      });
    });

    it("keeps node-style argv for packaged script entrypoints", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/ChisaCode.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["--dev"],
          baseEnv: { PATH: "/usr/bin" },
        }),
      ).toEqual({
        command: "/Applications/ChisaCode.app/Contents/MacOS/ChisaCode",
        args: [
          "--disable-warning=DEP0040",
          "/Applications/ChisaCode.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          "node-script",
          "/tmp/chisacode-cli.js",
          "--dev",
        ],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
          CHISACODE_NODE_ENV: "production",
        },
      });
    });
  });
});
