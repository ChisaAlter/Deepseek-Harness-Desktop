const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { missingRuntimeFiles, missingDeclaredEntries } = require('../src/main/plugin-runtime-files');
const { DESKTOP_PACKAGES } = require('../src/shared/harness-desktop-forks');
const { runSkipComposeContract } = require('./check-skip-compose-contract');
const {
  ensureGhosttyAssetsInHarness,
  harnessHasGhosttyAssets,
  missingGhosttyAssetPaths,
} = require('../src/shared/ghostty-assets');

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.agents',
  '.artifacts',
  '.cache',
  '.sessions',
  '.storages',
  '.turbo',
  '.vite',
  '.vite-temp',
  '.worktrees',
  '__pycache__',
  'coverage',
  'docs',
  'examples',
  'python',
  'website',
  'worktrees',
]);

// 纯构建期工具，运行时不需要；按 pnpm 目录名（<name>@<version> 或 @scope+<name>@<version>）匹配
const DEV_ONLY_NAMES = new Set([
  'typescript',
  'tsx',
  'ts-node',
  'vite',
  'vitest',
  '@vitest',
  'eslint',
  '@eslint',
  '@typescript-eslint',
  'turbo',
  'rollup',
  'webpack',
  'jest',
  '@jest',
  'playwright',
  '@playwright',
  'storybook',
  '@storybook',
  'prettier',
  'knip',
  'oxlint',
  'typedoc',
  'eslint-plugin',
  'babel',
  '@babel',
  'swc',
  '@swc',
  'nx',
  'husky',
  'lint-staged',
]);

function missingPluginDependencies(packageDir) {
  return missingRuntimeFiles(packageDir);
}

function defaultNpmInstall(packageDir) {
  const nm = path.join(packageDir, 'node_modules');
  if (fs.existsSync(nm)) {
    fs.rmSync(nm, { recursive: true, force: true });
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const lockFile = path.join(packageDir, 'package-lock.json');
  const args = fs.existsSync(lockFile)
    ? ['ci', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-fund', '--no-audit']
    : ['install', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-fund', '--no-audit'];
  const result = spawnSync(npmCmd, args, {
    cwd: packageDir,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${npmCmd} ${args.join(' ')} failed in ${packageDir} (status ${result.status})`);
  }
}

/**
 * extraResources from a plugin directory drops that directory's node_modules.
 * Copy vendor/<name>/node_modules into the packaged tree when a declared
 * dependency or its export file is still missing.
 */
function restoreVendoredPluginNodeModules(projectDir, resources, packageName) {
  const srcNm = path.join(projectDir, 'vendor', packageName, 'node_modules');
  const destPkg = path.join(resources, 'vendor', packageName);
  if (!fs.existsSync(path.join(destPkg, 'package.json'))) {
    return { restored: false, reason: 'missing-dest-package' };
  }
  if (!fs.existsSync(srcNm)) {
    return { restored: false, reason: 'missing-source-node-modules' };
  }
  const missing = missingPluginDependencies(destPkg);
  if (missing.length === 0) {
    return { restored: false, reason: 'already-present' };
  }
  fs.cpSync(srcNm, path.join(destPkg, 'node_modules'), { recursive: true, force: true });
  return { restored: true, missing };
}

/**
 * Git-tracked plugin node_modules can omit export files (repo dist/ ignore).
 * Wipe and npm-install from package.json when the packaged tree is incomplete.
 * @param {string} packageDir
 * @param {{ run?: (dir: string) => void, skipIfComplete?: boolean }} [options]
 */
function installPluginRuntimeDeps(packageDir, options = {}) {
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
    return { installed: false, reason: 'missing-package' };
  }
  const missing = missingPluginDependencies(packageDir);
  if (options.skipIfComplete && missing.length === 0) {
    return { installed: false, reason: 'already-present' };
  }
  const run = options.run || defaultNpmInstall;
  run(packageDir);
  return { installed: true, missing };
}

function assertVendoredPluginRuntimeDeps(resources, packageName) {
  const destPkg = path.join(resources, 'vendor', packageName);
  const missing = missingPluginDependencies(destPkg);
  if (missing.length) {
    throw new Error(`packaged ${packageName} is missing node_modules: ${missing.join(', ')}`);
  }
}

async function assertChisaCodeRuntime(resources) {
  const root = path.join(resources, 'vendor', 'chisacode-remote');
  const serverExport = path.join(root, 'packages', 'server', 'dist', 'server', 'server', 'exports.js');
  const required = [
    serverExport,
    path.join(root, 'node_modules', '@chisacode', 'protocol', 'dist', 'connection-offer.js'),
    path.join(root, 'node_modules', '@chisacode', 'relay', 'dist', 'e2ee.js'),
    path.join(root, 'node_modules', 'pino', 'package.json'),
    path.join(root, 'node_modules', 'ws', 'package.json'),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `安装包缺少 ChisaCode 远程运行时：${missing.map((file) => path.relative(root, file)).join(', ')}`,
    );
  }
  const api = await import(pathToFileURL(serverExport).href);
  for (const name of [
    'createChisaCodeDaemon',
    'createRootLogger',
    'generateLocalPairingOffer',
    'RelayDeviceCredentialStore',
  ]) {
    if (typeof api[name] !== 'function') {
      throw new Error(`安装包 ChisaCode server 缺少导出：${name}`);
    }
  }
}

function longPath(target) {
  const abs = path.resolve(target);
  if (process.platform !== 'win32' || abs.length < 240) {
    return abs;
  }
  if (abs.startsWith('\\\\?\\')) {
    return abs;
  }
  if (abs.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${abs.slice(2)}`;
  }
  return `\\\\?\\${abs}`;
}

function isDevOnlyPnpmEntry(name) {
  // pnpm 条目名: typescript@5.6.3 | @types+node@22.5.0 | @eslint+eslintrc@3.1.0
  const parts = name.split('+');
  const scope = parts.length > 1 ? parts[0] : null; // 带 @ 前缀
  const base = parts[parts.length - 1].split('@')[0];
  if (scope && scope.startsWith('@types')) {
    return true;
  }
  if (DEV_ONLY_NAMES.has(base) || (scope && DEV_ONLY_NAMES.has(scope))) {
    return true;
  }
  return false;
}

function shouldSkip(src, root, expandNested = false, skipStore = false) {
  const rel = path.relative(root, src);
  if (!rel || rel.startsWith('..')) {
    return false;
  }
  const parts = rel.split(path.sep);
  let nodeModulesSeen = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (SKIP_DIRS.has(part)) {
      return true;
    }
    if (skipStore && part === '.pnpm') {
      // deploy 目录：顶层链接已解引用覆盖全部运行时包，.pnpm store 是硬链接重复，
      // 跳过可避免 10 倍展开（体积与内存）
      return true;
    }
    if (part === 'node_modules') {
      nodeModulesSeen += 1;
      if (nodeModulesSeen >= 3 && !expandNested) {
        // .pnpm 条目内的二级以上嵌套 node_modules：对完整 workspace 是冗余链接；
        // 对 deploy 目录（expandNested）是版本隔离依赖，必须保留
        return true;
      }
      if (i + 1 < parts.length && isDevOnlyPnpmEntry(parts[i + 1])) {
        return true; // node_modules 下的 dev-only 包
      }
    }
    if ((part === 'src' || part === 'tests' || part === '__tests__') && /^(packages|apps)(\\|\/)/.test(parts.slice(0, i).join(path.sep))) {
      // 只跳过 packages/ apps/ 下的源码与测试目录（node_modules 内的不动）
      return true;
    }
  }
  return false;
}

function realOf(target) {
  try {
    return fs.realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/** Runtime skill files under shipped agent presets are Markdown (`SKILL.md`). */
function isShippedPresetMarkdown(src, root, base) {
  if (!/\.md$/i.test(base)) {
    return false;
  }
  const rel = path.relative(path.resolve(root), path.resolve(src)).split(path.sep);
  return rel.includes('agent-presets');
}

/**
 * 收集需要复制的文件：
 * - 递归 + 回溯维护祖先链（防符号链接环），复用同一个 Set，避免 O(n²) 内存
 * - 复制时由 fs.copyFile 解引用链接（复制目标内容）
 * - flat: 拍平模式——.pnpm store 条目提升到 node_modules/<pkg>（短路径，避免 NSIS
 *   长路径失败），全部内容保留（不丢包）
 */
function collectFiles(root, destRoot, expandNested = false, flat = false) {
  const files = [];
  const ancestors = new Set();
  const visitedDirectories = new Set();
  const topNodeModules = path.join(path.resolve(destRoot), 'node_modules');

  function walk(src, dest) {
    if (shouldSkip(src, root, expandNested)) {
      return;
    }
    if (flat && src.endsWith(`${path.sep}node_modules`) && dest !== topNodeModules) {
      // 任意 node_modules 目录（根 / .pnpm 条目 / 包内嵌套）都提升到顶层，
      // 避免超长路径触发 NSIS 260 字符限制
      dest = topNodeModules;
    }
    let lstat;
    try {
      lstat = fs.lstatSync(src);
    } catch {
      return;
    }

    if (lstat.isSymbolicLink() || lstat.isDirectory()) {
      const real = realOf(src);
      if (ancestors.has(real)) {
        return; // 环
      }
      const visitKey = `${real}\0${path.resolve(dest)}`;
      if (visitedDirectories.has(visitKey)) {
        return;
      }
      visitedDirectories.add(visitKey);
      let realStat;
      try {
        realStat = fs.statSync(real);
      } catch {
        return;
      }
      if (realStat.isFile()) {
        files.push({ src: real, dest });
        return;
      }
      ancestors.add(real);
      let names;
      try {
        names = fs.readdirSync(src);
      } catch {
        ancestors.delete(real);
        return;
      }
      for (const name of names) {
        walk(path.join(src, name), path.join(dest, name));
      }
      ancestors.delete(real);
      return;
    }

    if (lstat.isFile()) {
      const base = path.basename(src);
      if (/\.(map|tsbuildinfo|md|d\.ts)$/i.test(base) && !isShippedPresetMarkdown(src, root, base)) {
        return;
      }
      if (/^(license|licence|changelog|changes|authors|contributing)(\.|$)/i.test(base)) {
        return;
      }
      files.push({ src, dest });
    }
  }

  walk(path.resolve(root), path.resolve(destRoot));
  return files;
}

/** 并发复制（fs.copyFile 总是解引用链接，复制目标内容；EBUSY 重试以对抗杀软扫描） */
async function copyFiles(files, limit = 32) {
  let idx = 0;
  let retried = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < files.length) {
      const item = files[idx];
      idx += 1;
      fs.mkdirSync(longPath(path.dirname(item.dest)), { recursive: true });
      for (let attempt = 0; ; attempt += 1) {
        try {
          await fs.promises.copyFile(longPath(item.src), longPath(item.dest));
          break;
        } catch (error) {
          if (error.code === 'EBUSY' && attempt < 3) {
            retried += 1;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
    }
  });
  await Promise.all(workers);
  if (retried) {
    console.log(`（EBUSY 重试 ${retried} 次）`);
  }
  return files.length;
}

function deployCliEntries(deployDir) {
  return fs.readdirSync(deployDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor');
}

function packageJsonVersion(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

function destForPackageName(root, name) {
  return path.join(root, ...String(name).split('/'));
}

function listNodeModulesPackages(nodeModulesDir) {
  const packages = [];
  if (!fs.existsSync(nodeModulesDir)) {
    return packages;
  }
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }
  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) {
      continue;
    }
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      let scoped;
      try {
        scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (!child.isDirectory() && !child.isSymbolicLink()) {
          continue;
        }
        const pkgDir = path.join(scopeDir, child.name);
        if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
          packages.push({ name: `${entry.name}/${child.name}`, dir: pkgDir });
        }
      }
      continue;
    }
    const pkgDir = path.join(nodeModulesDir, entry.name);
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      packages.push({ name: entry.name, dir: pkgDir });
    }
  }
  return packages;
}

function hostPackageFromPnpmEntry(entryName) {
  const parts = entryName.split('+');
  const scope = parts.length > 1 ? parts[0] : null;
  const bare = (parts.length > 1 ? parts[1] : parts[0]).split('@')[0].split('_')[0];
  return { scope, bare, name: scope ? `${scope}/${bare}` : bare };
}

/**
 * Flatten `.pnpm` store entries to top-level node_modules, then nest siblings
 * whose version differs from the already-copied top-level package under the
 * host package (so MCP SDK keeps ajv@8 when the tree also has ajv@6).
 * @param {string} storeDir - deploy `node_modules/.pnpm`
 * @param {string} nmDest - packaged `node_modules`
 * @returns {{ src: string, dest: string }[]}
 */
function collectPnpmFlattenFiles(storeDir, nmDest) {
  const flattened = [];
  const seen = new Set();
  const flattenPkg = (pkgDir, destDir) => {
    if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
      return;
    }
    if (seen.has(destDir) || fs.existsSync(path.join(destDir, 'package.json'))) {
      return;
    }
    seen.add(destDir);
    const files = collectFiles(pkgDir, destDir, false, false);
    for (const f of files) {
      flattened.push(f);
    }
  };
  if (!fs.existsSync(storeDir)) {
    return flattened;
  }
  for (const entry of fs.readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryNm = path.join(storeDir, entry.name, 'node_modules');
    if (!fs.existsSync(entryNm)) {
      continue;
    }
    const host = hostPackageFromPnpmEntry(entry.name);
    flattenPkg(
      destForPackageName(entryNm, host.name),
      destForPackageName(nmDest, host.name),
    );
  }
  const sharedDir = path.join(storeDir, 'node_modules');
  if (fs.existsSync(sharedDir)) {
    for (const n of fs.readdirSync(sharedDir, { withFileTypes: true })) {
      if (!n.isDirectory() && !n.isSymbolicLink()) {
        continue;
      }
      const sharedPkg = path.join(sharedDir, n.name);
      if (n.name.startsWith('@')) {
        for (const s of fs.readdirSync(sharedPkg, { withFileTypes: true })) {
          if (s.isDirectory() || s.isSymbolicLink()) {
            flattenPkg(path.join(sharedPkg, s.name), path.join(nmDest, n.name, s.name));
          }
        }
      } else {
        flattenPkg(sharedPkg, path.join(nmDest, n.name));
      }
    }
  }
  const seenNested = new Set();
  for (const entry of fs.readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') {
      continue;
    }
    const entryNm = path.join(storeDir, entry.name, 'node_modules');
    if (!fs.existsSync(entryNm)) {
      continue;
    }
    const host = hostPackageFromPnpmEntry(entry.name);
    const hostDest = destForPackageName(nmDest, host.name);
    for (const sibling of listNodeModulesPackages(entryNm)) {
      if (sibling.name === host.name) {
        continue;
      }
      const topVersion = packageJsonVersion(destForPackageName(nmDest, sibling.name));
      const siblingVersion = packageJsonVersion(sibling.dir);
      if (!topVersion || !siblingVersion || topVersion === siblingVersion) {
        continue;
      }
      const nestedDest = path.join(hostDest, 'node_modules', ...sibling.name.split('/'));
      if (seenNested.has(nestedDest) || fs.existsSync(path.join(nestedDest, 'package.json'))) {
        continue;
      }
      seenNested.add(nestedDest);
      const files = collectFiles(sibling.dir, nestedDest, false, false);
      for (const f of files) {
        flattened.push(f);
      }
    }
  }
  return flattened;
}

function isNestedIsolationDest(nmDest, dest) {
  const rel = path.relative(nmDest, dest).split(path.sep);
  const nmIdx = rel.indexOf('node_modules');
  return nmIdx > 0;
}

async function repairFlattenedVersionIsolation(harnessSrc, harnessDest) {
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  const nmDest = path.join(harnessDest, 'node_modules');
  if (!fs.existsSync(storeDir) || !fs.existsSync(nmDest)) {
    return 0;
  }
  const flattened = collectPnpmFlattenFiles(storeDir, nmDest);
  const nested = flattened.filter((item) => isNestedIsolationDest(nmDest, item.dest));
  if (nested.length === 0) {
    return 0;
  }
  console.log(`补全拍平缺失的版本隔离嵌套: ${nested.length} 个文件`);
  return copyFiles(nested, 32);
}

function resolvePackageFrom(fromDir, packageName, stopDir) {
  let current = path.resolve(fromDir);
  const stop = path.resolve(stopDir);
  const segments = String(packageName).split('/');
  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    if (current === stop) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function assertMcpSdkAjv(harnessDest) {
  const sdkDir = path.join(harnessDest, 'node_modules', '@modelcontextprotocol', 'sdk');
  if (!fs.existsSync(path.join(sdkDir, 'package.json'))) {
    throw new Error('安装包缺少 @modelcontextprotocol/sdk');
  }
  const ajvDir = resolvePackageFrom(sdkDir, 'ajv', harnessDest);
  const version = ajvDir ? packageJsonVersion(ajvDir) : '';
  const major = Number.parseInt(String(version).split('.')[0], 10);
  if (!Number.isInteger(major) || major < 8) {
    throw new Error(
      `拍平丢掉了 SDK 嵌套 ajv@8（MCP SDK 解析到 ajv@${version || 'missing'}）`,
    );
  }
}

/**
 * 用精简 deploy 目录组装 resources/vendor/deepseek-harness：
 *   apps/cli     <- deploy 根内容（lib/ config/ package.json，不含 node_modules）
 *   apps/web/dist<- vendor 源码构建产物
 *   node_modules <- deploy/node_modules（扁平依赖，完整展开以保留版本隔离嵌套）
 *   vendor       <- deploy/vendor（本地 cordis 插件包源）
 * 该结构已被验证可完整启动 dsh web（scripts/patch-deploy.js 迭代补齐）。
 */
async function assembleFromDeploy(projectDir, deployDir, harnessDest) {
  const vendorSrc = path.join(projectDir, 'vendor', 'deepseek-harness');
  // 1) apps/cli <- deploy 根内容（排除 node_modules 与 vendor，它们单独复制）
  const cliDest = path.join(harnessDest, 'apps', 'cli');
  let total = 0;
  for (const n of deployCliEntries(deployDir)) {
    const files = collectFiles(path.join(deployDir, n.name), path.join(cliDest, n.name), true);
    total += await copyFiles(files, 32);
  }
  // 2) node_modules：
  //    a) 顶层条目逐个收集（链接解引用后以真实路径为根）
  //    b) 拍平 .pnpm store：每个条目的包内容复制到顶层（目标已存在则跳过），
  //       使顶层覆盖全部运行时包，同时避免硬链接重复展开
  const nmSrc = path.join(deployDir, 'node_modules');
  const nmDest = path.join(harnessDest, 'node_modules');
  for (const n of fs.readdirSync(nmSrc, { withFileTypes: true })) {
    if (n.name === '.pnpm') {
      continue;
    }
    const s = path.join(nmSrc, n.name);
    const d = path.join(nmDest, n.name);
    const root = n.isSymbolicLink() ? realOf(s) : s;
    const files = collectFiles(root, d, false, false);
    total += await copyFiles(files, 32);
  }
  const storeDir = path.join(nmSrc, '.pnpm');
  if (fs.existsSync(storeDir)) {
    const flattened = collectPnpmFlattenFiles(storeDir, nmDest);
    console.log(`拍平 .pnpm store: ${flattened.length} 个文件`);
    total += await copyFiles(flattened, 32);
  }
  const jobs = [
    [path.join(deployDir, 'vendor'), path.join(harnessDest, 'vendor')],
    [path.join(vendorSrc, 'apps', 'web', 'dist'), path.join(harnessDest, 'apps', 'web', 'dist')],
  ];
  for (const [src, dest] of jobs) {
    if (!fs.existsSync(src)) {
      throw new Error(`精简目录缺少 ${src}`);
    }
    const files = collectFiles(src, dest, false, false);
    total += await copyFiles(files, 32);
  }
  return total;
}

function resolveResourcesDir(context) {
  if (context?.packager && typeof context.packager.getResourcesDir === 'function') {
    return context.packager.getResourcesDir(context.appOutDir);
  }
  if (context?.electronPlatformName === 'darwin') {
    const product = context.packager?.appInfo?.productFilename || 'Deepseek-Harness-Desktop';
    return path.join(context.appOutDir, `${product}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

function copyBundledNode(destDir) {
  const src = [
    process.env.NODE_BINARY,
    process.execPath,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ].find((candidate) => candidate && fs.existsSync(candidate) && !/electron/i.test(candidate));
  if (!src) {
    throw new Error('打包时未找到 Node.js 可执行文件，安装包将无法启动官方 Web UI');
  }
  const dest = path.join(destDir, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  return dest;
}

function copyBundledPnpm(projectDir, destDir) {
  const src = path.join(projectDir, 'node_modules', 'pnpm');
  if (!fs.existsSync(path.join(src, 'bin', 'pnpm.cjs'))) {
    throw new Error('打包时未找到 pnpm，请先 npm install');
  }
  const dest = path.join(destDir, 'pnpm');
  fs.cpSync(src, dest, { recursive: true, dereference: true });
  return dest;
}

function resolveDeployDir(deployEnv) {
  if (!deployEnv || deployEnv === 'off') {
    return null;
  }
  return path.resolve(deployEnv);
}

function nodePtyPrebuildRelative(platform = process.platform, arch = process.arch) {
  const folder = `${platform}-${arch}`;
  if (platform === 'win32') {
    return path.join('prebuilds', folder, 'conpty.node');
  }
  return path.join('prebuilds', folder, 'pty.node');
}

function resolveNodePtyRoot(harnessDest) {
  const direct = path.join(harnessDest, 'node_modules', 'node-pty');
  if (fs.existsSync(path.join(direct, 'package.json'))) {
    return direct;
  }
  throw new Error('安装包缺少 node-pty');
}

function assertHarnessVersions(harnessDest, pin) {
  if (!pin || typeof pin.npm !== 'string' || pin.npm.trim() === '') {
    throw new Error('assertHarnessRuntime requires pin.npm');
  }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(harnessDest, 'package.json'), 'utf8'));
  const cliPkg = JSON.parse(fs.readFileSync(path.join(harnessDest, 'apps', 'cli', 'package.json'), 'utf8'));
  if (rootPkg.version !== pin.npm || cliPkg.version !== pin.npm) {
    throw new Error(
      `安装包 Harness 版本 ${rootPkg.version}/${cliPkg.version} 与 pin.npm ${pin.npm} 不一致`,
    );
  }
}

function assertNodePtyPrebuild(harnessDest, platform = process.platform, arch = process.arch) {
  const relative = nodePtyPrebuildRelative(platform, arch);
  const native = path.join(resolveNodePtyRoot(harnessDest), relative);
  if (!fs.existsSync(native)) {
    throw new Error(`安装包缺少 node-pty prebuild：${relative}`);
  }
}

/**
 * Every registered desktop fork package must ship resolvable in the packaged
 * runtime with its declared runtime entries on disk. The shipped web
 * composition mounts these rows unconditionally (skip-user-plugins included),
 * so a runtime missing one dies on every start with an ESM
 * `ERR_MODULE_NOT_FOUND … imported from …profiles/web/` that no recovery
 * path can fix — a stale deploy dir must fail the build here instead.
 * @param {string} harnessDest
 */
function assertDesktopForkRuntime(harnessDest) {
  const problems = [];
  for (const pkg of DESKTOP_PACKAGES) {
    const dir = path.join(harnessDest, 'node_modules', ...pkg.name.split('/'));
    const manifestFile = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestFile)) {
      problems.push(pkg.name);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      problems.push(`${pkg.name}/package.json`);
      continue;
    }
    for (const rel of missingDeclaredEntries(dir, manifest)) {
      problems.push(`${pkg.name}/${rel}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`安装包缺少桌面组件包运行时：${problems.join(', ')}`);
  }
}

function assertHarnessRuntime(harnessDest, pin) {
  const requiredFiles = [
    path.join('apps', 'cli', 'lib', 'bin.js'),
    path.join('apps', 'web', 'dist', 'index.html'),
    path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-mcp-servers-file', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-host-mcp-servers', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-host-skill-inventory', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'client.js'),
  ];
  const missing = requiredFiles.filter((relative) => !fs.existsSync(path.join(harnessDest, relative)));
  if (missing.length > 0) {
    throw new Error(`安装包缺少 Harness 运行时产物：${missing.join(', ')}`);
  }
  assertDesktopForkRuntime(harnessDest);

  // Root client tsdown does not run copy-ghostty-assets; fill lib/assets before the gate.
  ensureGhosttyAssetsInHarness(harnessDest);
  if (!harnessHasGhosttyAssets(harnessDest)) {
    throw new Error(
      `安装包缺少终端 Ghostty 资源（dirname(client.js)/assets）：${missingGhosttyAssetPaths(harnessDest).join(', ')}`,
    );
  }

  const chat = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
    'utf8',
  );
  const messageEdit = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
    'utf8',
  );
  const sessionCtl = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
    'utf8',
  );
  if (!chat.includes('conversation.chat.user-actions')) {
    throw new Error('安装包的 Chat UI 缺少用户消息 action slot');
  }
  if (!messageEdit.includes('conversation.chat.user-actions')) {
    throw new Error('安装包缺少消息编辑用户 action');
  }
  if (!sessionCtl.includes('beforeSeq') || !/fork/i.test(sessionCtl)) {
    throw new Error('安装包的 session Remote 缺少 fork beforeSeq');
  }
  assertHarnessVersions(harnessDest, pin);
  assertNodePtyPrebuild(harnessDest);
  assertMcpSdkAjv(harnessDest);
}

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const resources = resolveResourcesDir(context);
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-usage-panel');
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-usage-panel'), { skipIfComplete: true });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-usage-panel');
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-im');
  // Force install when any runtime export is missing (skipIfComplete can leave
  // a half-broken tree that silently drops Settings → Remote → Channels).
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-im'), { skipIfComplete: false });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-im');
  await assertChisaCodeRuntime(resources);
  const harnessDest = path.join(resources, 'vendor', 'deepseek-harness');
  const deployDir = resolveDeployDir(process.env.DSH_DEPLOY_DIR);
  const started = Date.now();

  let copied;
  if (deployDir) {
    console.log(`使用精简目录 ${deployDir} 组装 resources/vendor`);
    copied = await assembleFromDeploy(projectDir, deployDir, harnessDest);
  } else {
    console.log('使用当前 vendored Harness 全量复制（拍平 .pnpm 到顶层，避免超长路径）');
    const harnessSrc = path.join(projectDir, 'vendor', 'deepseek-harness');
    console.log('收集文件清单（解引用 pnpm 链接，跳过循环与 dev-only 包）...');
    const files = collectFiles(harnessSrc, harnessDest, false, true);
    console.log(`待复制 ${files.length} 个文件，收集耗时 ${((Date.now() - started) / 1000).toFixed(1)}s（并发复制中）`);
    copied = await copyFiles(files, 32);
    copied += await repairFlattenedVersionIsolation(harnessSrc, harnessDest);
  }

  const nodeDest = copyBundledNode(resources);
  const pnpmDest = copyBundledPnpm(projectDir, resources);
  const pin = JSON.parse(fs.readFileSync(path.join(projectDir, 'vendor', 'harness-upstream.json'), 'utf8'));
  fs.mkdirSync(path.join(resources, 'vendor'), { recursive: true });
  fs.writeFileSync(
    path.join(resources, 'vendor', 'harness-upstream.json'),
    `${JSON.stringify(pin, null, 2)}\n`,
  );
  assertHarnessRuntime(harnessDest, pin);
  // Skip compose contract against the REAL packaged CLI: unit tests mock
  // dsh.start, so this dist-path gate is the only automated place where the
  // shipped runtime proves `--skip-user-plugins` drops the user layer while
  // the desktop-owned `--patch` overlay still mounts the install plugin.
  console.log('校验 skip compose 契约（真实 CLI dump-config，skip + full 双轮）…');
  runSkipComposeContract(harnessDest, { log: (line) => console.log(line) });

  const archive = path.join(resources, 'vendor', 'deepseek-harness.tar');
  console.log('打包运行时为单个 tar，减少 NSIS 解压文件数…');
  execFileSync('tar', ['-cf', path.basename(archive), '-C', path.basename(harnessDest), '.'], {
    cwd: path.dirname(harnessDest),
    stdio: 'inherit',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (!fs.existsSync(archive) || fs.statSync(archive).size < 1024) {
    throw new Error('运行时 tar 生成失败');
  }
  fs.rmSync(longPath(harnessDest), { recursive: true, force: true });

  console.log(`已复制 ${copied} 个文件，写入 ${nodeDest} 与 ${pnpmDest}`);
  console.log(`运行时归档 ${((fs.statSync(archive).size / 1048576).toFixed(1))} MB`);
  console.log(`afterPack 完成 ${((Date.now() - started) / 1000).toFixed(1)}s`);
};

module.exports.collectFiles = collectFiles;
module.exports.collectPnpmFlattenFiles = collectPnpmFlattenFiles;
module.exports.repairFlattenedVersionIsolation = repairFlattenedVersionIsolation;
module.exports.copyFiles = copyFiles;
module.exports.deployCliEntries = deployCliEntries;
module.exports.resolveDeployDir = resolveDeployDir;
module.exports.resolveResourcesDir = resolveResourcesDir;
module.exports.assertDesktopForkRuntime = assertDesktopForkRuntime;
module.exports.assertHarnessRuntime = assertHarnessRuntime;
module.exports.assertHarnessVersions = assertHarnessVersions;
module.exports.assertNodePtyPrebuild = assertNodePtyPrebuild;
module.exports.assertVendoredPluginRuntimeDeps = assertVendoredPluginRuntimeDeps;
module.exports.assertChisaCodeRuntime = assertChisaCodeRuntime;
module.exports.installPluginRuntimeDeps = installPluginRuntimeDeps;
module.exports.nodePtyPrebuildRelative = nodePtyPrebuildRelative;
module.exports.restoreVendoredPluginNodeModules = restoreVendoredPluginNodeModules;
module.exports.ensureGhosttyAssetsInHarness = ensureGhosttyAssetsInHarness;
