#!/usr/bin/env node

const { build } = require("electron-builder");
const { LinuxPackager, MacPackager, Platform, WinPackager } = require("app-builder-lib");
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
    case Platform.MAC:
      return new MacPackager(info);
    case Platform.LINUX:
      return new LinuxPackager(info);
    default:
      throw new Error(`Unsupported desktop build platform: ${platform.name}`);
  }
}

build({
  projectDir: packageRoot,
  config: path.join(packageRoot, "electron-builder.yml"),
  platformPackagerFactory,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
