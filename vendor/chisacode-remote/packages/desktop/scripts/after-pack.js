const fs = require("fs");
const path = require("path");
const { rebuild } = require("@electron/rebuild");

const { smokePackagedDesktopApp } = require("./smoke-packaged-desktop-app.js");

const EXECUTABLE_NAME = "ChisaCode";
const ELECTRON_VERSION = require("electron/package.json").version;
const ELECTRON_REBUILT_MODULES = ["better-sqlite3"];

// electron-builder arch enum → Node.js arch string
const ARCH_MAP = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const RIPGREP_PLATFORM_DIR = {
  darwin: { arm64: "arm64-darwin", x64: "x64-darwin" },
  linux: { arm64: "arm64-linux", x64: "x64-linux" },
  win32: { arm64: "arm64-win32", x64: "x64-win32" },
};

function rmSafe(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function pruneChildrenExcept(parent, keep) {
  if (!fs.existsSync(parent)) return;
  for (const entry of fs.readdirSync(parent)) {
    if (!keep.has(entry)) {
      rmSafe(path.join(parent, entry));
    }
  }
}

function pruneClaudeAgentSdk(nodeModules, platform, arch) {
  const vendorRoot = path.join(nodeModules, "@anthropic-ai", "claude-agent-sdk", "vendor");
  const keepName = RIPGREP_PLATFORM_DIR[platform]?.[arch];
  if (keepName) {
    pruneChildrenExcept(path.join(vendorRoot, "ripgrep"), new Set(["COPYING", keepName]));
    pruneChildrenExcept(path.join(vendorRoot, "tree-sitter-bash"), new Set([keepName]));
  }

  // SDK ≥0.2.113 ships per-platform Claude Code binaries via optionalDependencies
  // (~210 MB each). ChisaCode requires user-installed `claude` on PATH, matching how
  // Codex/OpenCode are integrated, so drop every bundled copy.
  const anthropicDir = path.join(nodeModules, "@anthropic-ai");
  if (fs.existsSync(anthropicDir)) {
    for (const entry of fs.readdirSync(anthropicDir)) {
      if (entry.startsWith("claude-agent-sdk-")) {
        rmSafe(path.join(anthropicDir, entry));
      }
    }
  }
}

function pruneNodePty(nodeModules, platform, arch) {
  const prebuilds = path.join(nodeModules, "node-pty", "prebuilds");
  pruneChildrenExcept(prebuilds, new Set([`${platform}-${arch}`]));

  if (platform !== "win32") {
    rmSafe(path.join(nodeModules, "node-pty", "third_party"));
  }
}

function pruneSharpLibvips(nodeModules, platform, arch) {
  const prefix = `sharp-libvips-${platform}-${arch}`;
  const imgDir = path.join(nodeModules, "@img");
  if (!fs.existsSync(imgDir)) return;

  for (const entry of fs.readdirSync(imgDir)) {
    if (
      entry.startsWith("sharp-") &&
      entry !== prefix &&
      !entry.startsWith(`sharp-${platform}-${arch}`)
    ) {
      rmSafe(path.join(imgDir, entry));
    }
  }
}

function pruneNativeModules(appOutDir, platform, arch) {
  const resourcesDir = resolveResourcesDir(appOutDir, platform);

  const nodeModules = path.join(resourcesDir, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(nodeModules)) return;

  const before = dirSizeSync(nodeModules);

  pruneClaudeAgentSdk(nodeModules, platform, arch);
  pruneNodePty(nodeModules, platform, arch);
  pruneSharpLibvips(nodeModules, platform, arch);

  const after = dirSizeSync(nodeModules);
  const savedMB = ((before - after) / 1024 / 1024).toFixed(1);
  console.log(`Pruned native modules: ${savedMB} MB removed (${fmtMB(before)} → ${fmtMB(after)})`);
}

function resolveResourcesDir(appOutDir, platform) {
  return platform === "darwin"
    ? path.join(appOutDir, `${EXECUTABLE_NAME}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
}

async function rebuildElectronNativeModules(appOutDir, platform, arch) {
  const unpackedAppDir = path.join(resolveResourcesDir(appOutDir, platform), "app.asar.unpacked");
  const nodeModules = path.join(unpackedAppDir, "node_modules");
  const modulesToRebuild = ELECTRON_REBUILT_MODULES.filter((moduleName) =>
    fs.existsSync(path.join(nodeModules, moduleName)),
  );

  if (modulesToRebuild.length === 0) {
    return;
  }

  for (const moduleName of modulesToRebuild) {
    ensureNativeBuildInputs(moduleName, path.join(nodeModules, moduleName));
  }

  console.log(
    `Rebuilding Electron native modules for ${platform}-${arch}: ${modulesToRebuild.join(", ")}`,
  );
  const syntheticPackageJson = path.join(unpackedAppDir, "package.json");
  const shouldRemoveSyntheticPackageJson = !fs.existsSync(syntheticPackageJson);
  if (shouldRemoveSyntheticPackageJson) {
    fs.writeFileSync(
      syntheticPackageJson,
      `${JSON.stringify({ dependencies: Object.fromEntries(modulesToRebuild.map((name) => [name, "*"])) }, null, 2)}\n`,
    );
  }

  try {
    await rebuild({
      buildPath: unpackedAppDir,
      electronVersion: ELECTRON_VERSION,
      arch,
      platform,
      extraModules: modulesToRebuild,
      onlyModules: modulesToRebuild,
      force: true,
      mode: "sequential",
      types: ["prod", "optional"],
    });
    verifyElectronNativeModules(unpackedAppDir, modulesToRebuild, arch);
  } finally {
    if (shouldRemoveSyntheticPackageJson) {
      rmSafe(syntheticPackageJson);
    }
  }
}

function ensureNativeBuildInputs(moduleName, targetModuleDir) {
  const sourceEntry = require.resolve(moduleName);
  const sourceModuleDir = path.dirname(path.dirname(sourceEntry));
  for (const relativePath of ["binding.gyp", "src", "deps"]) {
    const sourcePath = path.join(sourceModuleDir, relativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing native build input for ${moduleName}: ${sourcePath}`);
    }
    fs.cpSync(sourcePath, path.join(targetModuleDir, relativePath), { recursive: true });
  }
}

function verifyElectronNativeModules(unpackedAppDir, modules, arch) {
  const expectedAbi = require("node-abi").getAbi(ELECTRON_VERSION, "electron");
  const expectedMetadata = `${arch}--${expectedAbi}`;
  for (const moduleName of modules) {
    const metadataPath = path.join(
      unpackedAppDir,
      "node_modules",
      moduleName,
      "build",
      "Release",
      ".forge-meta",
    );
    const actualMetadata = fs.existsSync(metadataPath)
      ? fs.readFileSync(metadataPath, "utf8").trim()
      : null;
    if (actualMetadata !== expectedMetadata) {
      throw new Error(
        `Electron native rebuild verification failed for ${moduleName}: ` +
          `expected ${expectedMetadata}, got ${actualMetadata ?? "<missing>"}`,
      );
    }
  }
}

function dirSizeSync(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      try {
        total += fs.statSync(path.join(entry.parentPath || entry.path, entry.name)).size;
      } catch {}
    }
  }
  return total;
}

function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_MAP[context.arch] || process.arch;

  await rebuildElectronNativeModules(context.appOutDir, platform, arch);
  pruneNativeModules(context.appOutDir, platform, arch);

  if (platform === "linux" || platform === "win32") {
    if (arch !== process.arch) {
      console.log(
        `Skipping packaged-app smoke: build arch ${arch} differs from host ${process.arch}.`,
      );
    } else {
      await smokeUnpackedAppIfRequested(context.appOutDir);
    }
  }
};

async function smokeUnpackedAppIfRequested(appOutDir) {
  if (process.env.CHISACODE_DESKTOP_SMOKE !== "1") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: appOutDir,
  });
}
