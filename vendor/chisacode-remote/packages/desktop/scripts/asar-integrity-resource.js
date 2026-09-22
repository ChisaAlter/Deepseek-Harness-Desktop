const fs = require("node:fs");
const path = require("node:path");

const { computeData } = require("app-builder-lib/out/asar/integrity");
const { addWinAsarIntegrity } = require("app-builder-lib/out/electron/electronWin");

const EXECUTABLE_NAME = "ChisaCode";

async function restoreWinAsarIntegrityAfterRcedit(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const resourcesPath = path.join(context.appOutDir, "resources");
  const appAsarPath = path.join(resourcesPath, "app.asar");
  if (!fs.existsSync(appAsarPath)) {
    return;
  }

  const asarIntegrity = await computeData({
    resourcesPath,
    resourcesRelativePath: "resources",
    resourcesDestinationPath: resourcesPath,
    extraResourceMatchers: [],
  });

  await addWinAsarIntegrity(path.join(context.appOutDir, `${EXECUTABLE_NAME}.exe`), asarIntegrity);
}

module.exports = {
  restoreWinAsarIntegrityAfterRcedit,
};
