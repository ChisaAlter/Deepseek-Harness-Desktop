import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor', 'chisacode-remote');
const force = process.argv.includes('--force');
const buildRuntime = process.argv.includes('--runtime');
const serverExport = path.join(vendor, 'packages', 'server', 'dist', 'server', 'server', 'exports.js');
const mobileBundle = path.join(root, 'mobile', 'web', 'chisacode', 'daemon-client.bundle.js');
const runtimeRoot = path.join(vendor, '.tmp', 'desktop-runtime');

function run(command, args, cwd, { shell = process.platform === 'win32' } = {}) {
  // Absolute node paths with spaces break under shell:true on Windows.
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.tmp') continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const typescript = path.join(vendor, 'node_modules', 'typescript', 'package.json');
if (!fs.existsSync(typescript)) {
  console.log('[chisacode] installing vendored workspace dependencies');
  run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], vendor);
}

const serverSourceMtime = Math.max(
  newestMtime(path.join(vendor, 'packages', 'server', 'src')),
  newestMtime(path.join(vendor, 'packages', 'relay', 'src')),
  newestMtime(path.join(vendor, 'packages', 'protocol', 'src')),
  newestMtime(path.join(vendor, 'packages', 'client', 'src')),
);
const serverBuildMtime = fs.existsSync(serverExport) ? fs.statSync(serverExport).mtimeMs : 0;
if (force || serverSourceMtime > serverBuildMtime) {
  console.log('[chisacode] building server dependency stack');
  run(npm, ['run', 'build:server'], vendor);
}

const mobileSourceMtime = Math.max(
  newestMtime(path.join(root, 'mobile', 'web', 'chisacode', 'entry.mjs')),
  newestMtime(path.join(vendor, 'packages', 'protocol', 'src')),
  newestMtime(path.join(vendor, 'packages', 'client', 'src')),
);
const mobileBuildMtime = fs.existsSync(mobileBundle) ? fs.statSync(mobileBundle).mtimeMs : 0;
if (force || mobileSourceMtime > mobileBuildMtime) {
  console.log('[chisacode] bundling browser DaemonClient');
  run(process.execPath, ['scripts/bundle-chisacode-mobile-client.mjs'], root, { shell: false });
}

if (buildRuntime) {
  // npm otherwise represents local file dependencies as symlinks back into packages/.
  // electron-builder does not preserve those links under extraResources, and npm does
  // not assemble their transitive production dependencies in this standalone tree.
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const manifest = {
    private: true,
    dependencies: {
      '@chisacode/client': 'file:../../packages/client',
      '@chisacode/highlight': 'file:../../packages/highlight',
      '@chisacode/protocol': 'file:../../packages/protocol',
      '@chisacode/relay': 'file:../../packages/relay',
      '@chisacode/server': 'file:../../packages/server',
    },
  };
  fs.writeFileSync(
    path.join(runtimeRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log('[chisacode] assembling production daemon dependencies');
  run(
    npm,
    ['install', '--install-links', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    runtimeRoot,
  );
}

console.log('[chisacode] ready');
