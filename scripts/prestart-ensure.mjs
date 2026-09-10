/**
 * Ensure runtime artifacts match latest source before Electron starts.
 * Stops shipping stale ui-settings-remote/lib or missing dshd remote links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'vendor', 'deepseek-harness');
const clientBuildRecord = path.join(harness, '.dsh-build', 'client-build-environment.json');

function newestMtime(dir, filter) {
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'lib', 'dist', '.dsh-build', '.git', 'coverage', '.artifacts'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (filter && !filter(full)) continue;
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function clientSourceMtime() {
  return newestMtime(harness, (file) => {
    const normalized = file.replaceAll(path.sep, '/');
    if (!/(\/packages\/client\/|\/apps\/web\/|\/scripts\/)/.test(normalized)) return false;
    return /\.(?:tsx?|css|html|json|ya?ml)$/i.test(file);
  });
}

function officialBuildReason() {
  if (!fs.existsSync(clientBuildRecord)) return 'official client build record is missing';
  let record;
  try {
    record = JSON.parse(fs.readFileSync(clientBuildRecord, 'utf8'));
  } catch {
    return 'official client build record is invalid';
  }
  const environment = record?.environment;
  if (environment?.DSH_CLIENT_BUILD_PROFILE !== 'official') return 'client build is not official';
  if (environment?.DSH_CLIENT_TITLE !== 'DeepSeek Harness') return 'client build title is not official';
  const commit = currentCommit();
  if (commit && environment?.DSH_CLIENT_COMMIT_HASH !== commit) return 'client build belongs to an older desktop commit';
  const recordMtime = fs.statSync(clientBuildRecord).mtimeMs;
  if (clientSourceMtime() > recordMtime + 500) return 'client sources are newer than the official build';
  return '';
}

function run(command, args, cwd = root, { shell = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const buildReason = officialBuildReason();
if (buildReason) {
  console.log(`[prestart] ${buildReason}; rebuilding official client`);
  const pnpm = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  run(process.execPath, [pnpm, '--dir', harness, 'run', 'build:official'], root, { shell: false });
}

// Absolute node paths with spaces break under shell:true on Windows.
run(process.execPath, ['scripts/prepare-dshd-remote.mjs'], root, { shell: false });

const remotePkg = path.join(root, 'vendor', 'deepseek-harness', 'packages', 'client', 'ui-settings-remote');
const remoteSrc = path.join(remotePkg, 'src');
const remoteLib = path.join(remotePkg, 'lib', 'client.js');
const srcNewest = newestMtime(remoteSrc, (f) => /\.(tsx?|css)$/.test(f));
const libMtime = fs.existsSync(remoteLib) ? fs.statSync(remoteLib).mtimeMs : 0;
if (srcNewest > libMtime + 500) {
  console.log('[prestart] rebuilding ui-settings-remote (src newer than lib)');
  run('npm', ['run', 'bundle'], remotePkg);
} else {
  console.log('[prestart] ui-settings-remote lib is current');
}

if (!fs.existsSync(remoteLib)) {
  console.error('[prestart] ui-settings-remote/lib/client.js missing. Run: pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle');
  process.exit(1);
}
const text = fs.readFileSync(remoteLib, 'utf8');
if (!text.includes('copyLink') || !text.includes('data-dsh-remote-copy-link')) {
  console.error('[prestart] ui-settings-remote/lib is stale (missing copyLink / data-dsh-remote-copy-link). Run: pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle');
  process.exit(1);
}
if (text.includes('保存宿主令牌') && !text.includes('ayase.cn:443')) {
  console.error('[prestart] ui-settings-remote/lib is stale (host-token wall). Run: npm run bundle --prefix vendor/deepseek-harness/packages/client/ui-settings-remote');
  process.exit(1);
}

console.log('[prestart] ready');
