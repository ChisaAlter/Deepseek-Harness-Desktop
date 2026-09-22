#!/usr/bin/env node
// Hard gate for `npm publish`: the tarball must NEVER contain the README's
// static assets (assets/*.gif/png/...). The repo keeps assets/ so GitHub can
// render them; README images point at GitHub raw URLs, so the npm page still
// renders without shipping the bytes. Runs in `prepublishOnly` and in CI.
import { execFileSync } from 'node:child_process'

// Windows: npm is a .cmd shim and needs a shell; Git Bash PATH also varies.
const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  shell: process.platform === 'win32',
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const parsed = JSON.parse(raw)
const pack = Array.isArray(parsed) ? parsed[0] : parsed
const files = pack.files.map((f) => f.path)
const offenders = files.filter(
  (p) => p.startsWith('assets/') || /\.(png|jpe?g|gif|webp|svg|mp4|mov|woff2?)$/i.test(p),
)
if (offenders.length) {
  console.error('[check-pack] npm tarball must not include README static assets. Offending files:')
  for (const p of offenders) console.error('  - ' + p)
  process.exit(1)
}
console.log('[check-pack] OK — tarball has no static assets (' + files.length + ' files)')
