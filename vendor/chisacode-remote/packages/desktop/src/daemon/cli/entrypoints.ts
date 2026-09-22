import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import type { NodeEntrypointSpec } from "../node-entrypoint-launcher.js";
import {
  assertPathExists,
  findPackageRootFromResolvedPath,
  resolvePackagedAsarPath,
} from "../package-paths.js";

const CLI_PACKAGE_NAME = "@chisacode/cli";
const CLI_BIN_ENTRY = `${CLI_PACKAGE_NAME}/bin/chisacode`;
const CLI_RUN_ENTRY = `${CLI_PACKAGE_NAME}/dist/run.js`;

const esmRequire = createRequire(__filename);

function resolveCliPackageRoot(): string {
  return findPackageRootFromResolvedPath({
    resolvedPath: esmRequire.resolve(CLI_BIN_ENTRY),
    packageName: CLI_PACKAGE_NAME,
  }).root;
}

export function resolveExternalCliEntrypoint(): NodeEntrypointSpec {
  if (app.isPackaged) {
    return {
      entryPath: assertPathExists({
        label: "内置外部 CLI 入口",
        filePath: path.join(
          resolvePackagedAsarPath(),
          "node_modules",
          "@chisacode",
          "cli",
          "dist",
          "index.js",
        ),
      }),
      execArgv: [],
    };
  }

  const cliRoot = resolveCliPackageRoot();
  const distEntry = path.join(cliRoot, "dist", "index.js");
  if (existsSync(distEntry)) {
    return {
      entryPath: distEntry,
      execArgv: [],
    };
  }

  return {
    entryPath: assertPathExists({
      label: "外部 CLI 源码入口",
      filePath: path.join(cliRoot, "src", "index.ts"),
    }),
    execArgv: ["--import", "tsx"],
  };
}

export function resolvePassthroughCliEntrypoint(): string {
  if (app.isPackaged) {
    return assertPathExists({
      label: "内置透传 CLI 入口",
      filePath: path.join(
        resolvePackagedAsarPath(),
        "node_modules",
        "@chisacode",
        "cli",
        "dist",
        "run.js",
      ),
    });
  }

  return assertPathExists({
    label: "透传 CLI 入口",
    filePath: esmRequire.resolve(CLI_RUN_ENTRY),
  });
}
