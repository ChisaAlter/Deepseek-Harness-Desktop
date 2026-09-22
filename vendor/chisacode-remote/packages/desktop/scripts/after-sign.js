const path = require("node:path");

const { restoreWinAsarIntegrityAfterRcedit } = require("./asar-integrity-resource.js");
const { smokePackagedDesktopApp } = require("./smoke-packaged-desktop-app.js");

const EXECUTABLE_NAME = "ChisaCode";

exports.default = async function afterSign(context) {
  await restoreWinAsarIntegrityAfterRcedit(context);

  if (process.env.CHISACODE_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
