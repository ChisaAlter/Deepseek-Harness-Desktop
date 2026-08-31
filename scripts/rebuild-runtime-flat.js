// rebuild-runtime-flat.js — 部署开发树到运行时目录(默认排除 node_modules 复制)。
//
// 背景:运行时代码面 = node_modules/<pkg>(afterPack flat 拍平的解引用副本),
// packages/ 只是源码面;bin.js 非 bundle,运行时经 node_modules 解析工作区包。
//
// 默认模式(构建 + 代码同步,排除 node_modules):
//   0) pnpm run build(vendor 全量构建:build:lib + build:web)——保证部署的
//      lib/dist 始终最新;构建失败立即中止,绝不部署过期产物(--no-build 跳过)
//   1) robocopy /MIR 镜像代码目录(apps/assets/native/packages/patches/scripts/vendor,
//      /XD node_modules)+ 根配置文件 → node_modules 完全不碰
//   2) 把 node_modules 顶层的工作区包条目重绑为 junction → 运行时树内对应目录,
//      此后每次代码镜像即时生效,无需再复制 node_modules
//   3) 第三方依赖条目保持现状(首次由 --full 建立)
//
// --full:先执行官方 afterPack 全量拍平(collectFiles flat=true +
//         repairFlattenedVersionIsolation)重建 node_modules,再做 junction 重绑。
//         首次部署或 dev 依赖(pnpm-lock)变化时使用。
//
// 用法: node scripts/rebuild-runtime-flat.js [--full] [--no-build] [runtimeDir]
//   runtimeDir 默认 %APPDATA%\Deepseek-Harness-Desktop\runtime\0.2.7_dev
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { collectFiles, copyFiles, repairFlattenedVersionIsolation } = require('./after-pack');

const repoRoot = path.join(__dirname, '..');
const devRoot = path.join(repoRoot, 'vendor', 'deepseek-harness');

const args = process.argv.slice(2);
const full = args.includes('--full');
const noBuild = args.includes('--no-build') || args.includes('--skip-build');
const rt = path.resolve(args.find((a) => !a.startsWith('--'))
  || path.join(process.env.APPDATA || '', 'Deepseek-Harness-Desktop', 'runtime', '0.2.7_dev'));

// 与 pnpm-workspace.yaml 对齐;排除官方打包 SKIP_DIRS 覆盖的成员(examples/python)。
const MEMBER_GLOBS = [
  'vendor/*',
  'packages/*/*',
  'apps/*',
  'native/landlock-run',
  'native/landlock-run/packages/*',
  'website',
];

// 运行时保留的根配置文件(与官方打包保留面一致,不含 *.md 等文档)
const ROOT_FILES = [
  '.editorconfig', '.gitattributes', '.gitignore', '.gitlab-ci.yml',
  '.jscpd.json', '.oxlintrc.json', '.oxlintrc.staged.json', '.rgignore',
  'BRAND_GUIDELINES.i18n.yaml', 'knip.json', 'lefthook.yml', 'package.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'pytest.ini', 'README.i18n.yaml',
  'tsconfig.base.client.json', 'tsconfig.base.json', 'tsconfig.client.json',
  'tsconfig.host.json', 'tsconfig.json', 'tsdown.config.ts',
  'vitest.config.ts', 'vitest.e2e.config.ts', 'vitest.shared.ts',
  'vitest.snapshot.config.ts', 'vitest.web-stress.config.ts',
  'vitest.web.config.ts', 'vitest.web.perf.config.ts',
];

const MIRROR_DIRS = ['apps', 'assets', 'native', 'packages', 'patches', 'scripts', 'vendor'];

function expandGlob(g) {
  let current = [devRoot];
  for (const part of g.split('/')) {
    const next = [];
    for (const base of current) {
      if (part === '*') {
        if (!fs.existsSync(base)) continue;
        for (const n of fs.readdirSync(base, { withFileTypes: true })) {
          if (n.isDirectory()) next.push(path.join(base, n.name));
        }
      } else {
        const p = path.join(base, part);
        if (fs.existsSync(p)) next.push(p);
      }
    }
    current = next;
  }
  return current.filter((p) => p !== devRoot);
}

function workspaceMap() {
  const map = [];
  const seen = new Set();
  for (const g of MEMBER_GLOBS) {
    for (const dir of expandGlob(g)) {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pj.name && !seen.has(pj.name)) {
          seen.add(pj.name);
          map.push({ name: pj.name, rel: path.relative(devRoot, dir), dir });
        }
      } catch {
        // 非 package 目录,跳过
      }
    }
  }
  return map;
}

function buildVendor() {
  console.log('构建 vendor(pnpm run build:lib + build:web)...');
  const env = { ...process.env };
  // Windows 环境块中路径变量以 `Path`(注册表拼写)存在时,`process.env.PATH` 为 undefined;
  // 直接写 env.PATH 会产生大小写不同的重复键,短值覆盖完整 PATH,子进程便找不到 node/git
  // (`'node' is not recognized`)。统一键名,并保证含 node 与 .bin 目录后重建。
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  for (const key of Object.keys(env)) {
    if (key !== pathKey && key.toLowerCase() === 'path') delete env[key];
  }
  const bin = path.join(repoRoot, 'node_modules', '.bin');
  const nodeDir = path.dirname(process.execPath);
  env[pathKey] = [
    ...(fs.existsSync(bin) ? [bin] : []),
    nodeDir,
    ...(env[pathKey] ? [env[pathKey]] : []),
  ].join(path.delimiter);
  const pnpmCjs = path.join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  const invocation = fs.existsSync(pnpmCjs)
    ? { command: process.execPath, args: [pnpmCjs, 'run', 'build'], shell: false }
    : { command: 'pnpm', args: ['run', 'build'], shell: true };
  const res = spawnSync(invocation.command, invocation.args, {
    cwd: devRoot,
    env,
    stdio: 'inherit',
    shell: invocation.shell,
  });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(`构建启动失败: ${res.error.message}`);
  }
  if ((res.status ?? 1) !== 0) {
    throw new Error(`构建失败(exit ${res.status ?? res.signal});已中止部署,避免上线过期产物`);
  }
  // 与 setup-harness 相同的兜底:确保终端 Ghostty 资源就位
  const { ensureGhosttyAssetsInHarness, harnessHasGhosttyAssets, missingGhosttyAssetPaths } = require('../src/shared/ghostty-assets');
  ensureGhosttyAssetsInHarness(devRoot);
  if (!harnessHasGhosttyAssets(devRoot)) {
    throw new Error(`构建后缺少终端 Ghostty 资源:${missingGhosttyAssetPaths(devRoot).join(', ')}`);
  }
}

function robocopyMirror() {
  for (const dir of MIRROR_DIRS) {
    const src = path.join(devRoot, dir);
    const dest = path.join(rt, dir);
    if (!fs.existsSync(src)) continue;
    const res = spawnSync('robocopy', [src, dest, '/MIR', '/MT:32', '/R:1', '/W:1', '/XD', 'node_modules', '/NFL', '/NDL', '/NP', '/NJH'], {
      encoding: 'utf8',
      shell: false,
    });
    // robocopy 0-7 为成功(位标志),>=8 为失败
    if ((res.status ?? 0) >= 8) {
      throw new Error(`robocopy ${dir} 失败(exit ${res.status})`);
    }
  }
  fs.mkdirSync(rt, { recursive: true });
  for (const name of ROOT_FILES) {
    const src = path.join(devRoot, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(rt, name));
    }
  }
}

function isJunctionTo(entry, target) {
  let st;
  try {
    st = fs.lstatSync(entry);
  } catch {
    return false;
  }
  if (!st.isSymbolicLink()) return false;
  try {
    return path.resolve(fs.readlinkSync(entry)) === path.resolve(target);
  } catch {
    return false;
  }
}

function rebindWorkspaceJunctions() {
  const map = workspaceMap();
  const nm = path.join(rt, 'node_modules');
  if (!fs.existsSync(nm)) {
    throw new Error(`缺少 ${nm};首次部署请加 --full`);
  }
  let bound = 0;
  let kept = 0;
  let skipped = 0;
  for (const { name, rel } of map) {
    const entry = path.join(nm, ...name.split('/'));
    const target = path.join(rt, rel);
    if (!fs.existsSync(target)) {
      // 运行时树没有该目录(如 website):保留现有实体副本
      skipped += 1;
      continue;
    }
    if (isJunctionTo(entry, target)) {
      kept += 1;
      continue;
    }
    fs.rmSync(entry, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.symlinkSync(target, entry, 'junction');
    bound += 1;
  }
  console.log(`junction 重绑: 新建 ${bound},已一致 ${kept},无目标保留 ${skipped} / 共 ${map.length}`);
}

(async () => {
  console.log(`vendor 源: ${devRoot}`);
  console.log(`运行时目标: ${rt}${full ? '  [mode: --full]' : '  [mode: code-sync]'}`);
  const started = Date.now();
  if (noBuild) {
    console.log('--no-build:跳过构建,直接部署现有产物');
  } else {
    buildVendor();
  }
  if (full) {
    console.log('官方 afterPack 全量拍平重建 node_modules...');
    const files = collectFiles(devRoot, rt, false, true);
    console.log(`待复制 ${files.length} 个文件,收集耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await copyFiles(files, 32);
    const repaired = await repairFlattenedVersionIsolation(devRoot, rt);
    console.log(`版本隔离补全 ${repaired} 个文件`);
  }
  console.log('robocopy 镜像代码目录(排除 node_modules)...');
  robocopyMirror();
  rebindWorkspaceJunctions();
  console.log(`完成,总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
})().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
