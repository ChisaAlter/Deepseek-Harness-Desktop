// One-off migration helper: replace hard-coded cache-bust checks with assertFreshApp().
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const touched = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.mjs') || ['lib.mjs', 'run.mjs', 'report.mjs', '_patch-fresh.mjs'].includes(f)) continue;
  const file = path.join(dir, f);
  let s = readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(/if \(!\/[a-z0-9-]+\/\.test\(appSrc\)\) throw new Error\(`stale[^`]*`\);/g, 'assertFreshApp(appSrc);');
  s = s.replace(/assert\(\/[0-9a-z-]+\/\.test\(appSrc\), `stale app\.js: \$\{appSrc\}`\);/g, 'assertFreshApp(appSrc);');
  if (s !== before) {
    if (!/assertFreshApp,/.test(s)) s = s.replace(/import \{\s*/, 'import { assertFreshApp, ');
    writeFileSync(file, s);
    touched.push(f);
  }
}
console.log('patched:', touched.join(', ') || 'none');
const rest = [];
for (const f of readdirSync(dir)) {
  const s = readFileSync(path.join(dir, f), 'utf8');
  if (/stale app/.test(s) && !/assertFreshApp/.test(s)) rest.push(f);
}
console.log('still hardcoded:', rest.join(', ') || 'none');
