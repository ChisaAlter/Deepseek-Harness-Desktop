#!/usr/bin/env node

// x64-only Windows packaged build for the desktop e2e gate.
//
// Mirrors scripts/build.js (custom asar-integrity-after-rcedit packager that
// re-embeds the asar hash after rcedit rewrites the exe) but restricts the
// electron-builder targets to win x64 (nsis + zip) and skips arm64, halving
// the build time for local packaged verification loops. Run from
// packages/desktop: `node scripts/build-x64.js`.
const { build, Arch, Platform } = require("electron-builder");
const { WinPackager } = require("app-builder-lib");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");

class WindowsAsarIntegrityAfterRceditPackager extends WinPackager {
  async doPack(packOptions) {
    return super.doPack({
      ...packOptions,
      options: {
        ...packOptions.options,
        disableAsarIntegrity: true,
      },
    });
  }
}

function platformPackagerFactory(info, platform) {
  switch (platform) {
    case Platform.WINDOWS:
      return new WindowsAsarIntegrityAfterRceditPackager(info);
    default:
      throw new Error(`Unsupported desktop build platform: ${platform.name}`);
  }
}

const winTargets = new Map();
winTargets.set(Platform.WINDOWS, new Map([[Arch.x64, ["nsis", "zip"]]]));

build({
  projectDir: packageRoot,
  config: path.join(packageRoot, "electron-builder.yml"),
  platformPackagerFactory,
  targets: winTargets,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
