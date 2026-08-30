/**
 * Ensure runtime artifacts match latest source before Electron starts.
 * Stops shipping stale ui-settings-remote/lib or missing ChisaCode links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function newestMtime(dir, filter) {
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib') continue;
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

function run(command, args, cwd = root, { shell = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

// Absolute node paths with spaces break under shell:true on Windows.
run(process.execPath, ['scripts/prepare-chisacode-remote.mjs'], root, { shell: false });

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
if (text.includes('保存宿主令牌') && !text.includes('125.124.85.212:8411')) {
  console.error('[prestart] ui-settings-remote/lib is stale (host-token wall). Run: npm run bundle --prefix vendor/deepseek-harness/packages/client/ui-settings-remote');
  process.exit(1);
}

console.log('[prestart] ready');
