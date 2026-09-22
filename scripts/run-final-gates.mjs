#!/usr/bin/env node
'use strict'
/**
 * Final delivery gate matrix. Runs every gate sequentially in its own cwd and
 * records the TRUE exit code — no shell pipes anywhere, so a failure can never
 * be masked the way `pnpm run typecheck | tail` hides exit 2. The script exits
 * non-zero unless every selected gate reports 0.
 *
 * Usage: node scripts/run-final-gates.mjs [--only name,name] [--skip name,name]
 * Logs land in .final-gates/<name>.log (also streamed live for progress).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = path.join(ROOT, 'vendor', 'deepseek-harness')
const LOGDIR = path.join(ROOT, '.final-gates')

/** Vendor .ts/.tsx files this changeset touches (tracked-modified + untracked). */
function changedVendorFiles() {
  const out = []
  const push = line => {
    const rel = line.replace(/^[ADRM?]+\s+/, '').replace(/"/g, '')
    if (rel.startsWith('vendor/deepseek-harness/') && /\.(ts|tsx)$/.test(rel)) {
      out.push(rel.replace('vendor/deepseek-harness/', ''))
    }
  }
  for (const line of spawnSync('git', ['-C', ROOT, 'status', '--porcelain=v1'], { encoding: 'utf8' }).stdout.split('\n')) {
    if (line.trim()) push(line)
  }
  return out
}

const CHANGED_VENDOR_FILES = changedVendorFiles()

const GATES = [
  { name: 'desktop-tests', cwd: ROOT, cmd: 'npm', args: ['test'] },
  { name: 'typecheck', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'typecheck'] },
  // Blocking: this changeset's own files must lint clean (the repo carries a
  // pre-existing baseline of lint errors that this delivery must not extend).
  {
    name: 'lint-changed',
    cwd: VENDOR,
    cmd: 'node',
    args: ['node_modules/oxlint/bin/oxlint', '-c', '.oxlintrc.json', ...CHANGED_VENDOR_FILES],
    skipReason: CHANGED_VENDOR_FILES.length === 0 ? 'no changed vendor TypeScript files' : '',
  },
  // Observational: full-repo oxlint for the baseline record; failures here are
  // pre-existing debt outside this changeset and do not block delivery.
  { name: 'lint-full-baseline', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'lint'], observational: true },
  { name: 'test-gui-1', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:gui'] },
  { name: 'test-gui-2', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:gui'] },
  { name: 'test-gui-3', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:gui'] },
  { name: 'agent-note-format', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'verify-agent-note-format'] },
  { name: 'translation-pairing', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'verify-translation-pairing'] },
  { name: 'md-wrap', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'verify-md-wrap'] },
  { name: 'cordis-config', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'verify-cordis-config'] },
  { name: 'test-web', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:web'] },
  { name: 'pack', cwd: ROOT, cmd: 'npm', args: ['run', 'dist'] },
  { name: 'packaged-smoke', cwd: ROOT, cmd: 'npm', args: ['run', 'smoke:packaged'] },
]

function parseArgv(argv) {
  const only = []
  const skip = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) { only.push(...argv[i + 1].split(',')); i++ }
    else if (argv[i] === '--skip' && argv[i + 1]) { skip.push(...argv[i + 1].split(',')); i++ }
  }
  return { only, skip }
}

const { only, skip } = parseArgv(process.argv.slice(2))
const selected = GATES.filter(g => (only.length === 0 || only.includes(g.name)) && !skip.includes(g.name))

// cmd.exe PATH resolution can pick a corepack-shimmed pnpm that refuses the
// vendor pin; pin the shell to the desktop dependency's direct pnpm binary and
// keep vendor packageManager aligned with it (both 11.8.0).
const PNPM_DIR = path.join(ROOT, 'node_modules', '.bin')
const gateEnv = extraPath => ({
  ...process.env,
  PATH: extraPath ? `${extraPath}${path.delimiter}${process.env.PATH}` : process.env.PATH,
})

mkdirSync(LOGDIR, { recursive: true })
console.log(`final gates: ${selected.map(g => g.name).join(', ')}`)

const results = []
for (const gate of selected) {
  const logPath = path.join(LOGDIR, `${gate.name}.log`)
  const fd = openSync(logPath, 'w')
  if (gate.skipReason) {
    closeSync(fd)
    console.log(`[gate] SKIP ${gate.name} (${gate.skipReason})`)
    results.push({ ...gate, code: 0, ms: 0, skipped: true })
    continue
  }
  const started = Date.now()
  console.log(`[gate] START ${gate.name}`)
  const child = spawnSync(gate.cmd, gate.args, {
    cwd: gate.cwd,
    shell: true,
    stdio: ['ignore', fd, fd],
    env: gate.cmd === 'pnpm' ? gateEnv(PNPM_DIR) : gateEnv(),
  })
  closeSync(fd)
  // spawnSync preserves the child's real exit code in `status` (shell:true does
  // NOT mask it to 1); status is null only on signal/spawn error, then use -1/1.
  const code = child.status ?? (child.error ? -1 : 1)
  const ms = Date.now() - started
  console.log(`[gate] ${gate.name} EXIT=${code} (${(ms / 1000).toFixed(1)}s)`)
  results.push({ ...gate, code, ms })
}

console.log('\n===== FINAL GATE MATRIX =====')
let failed = 0
for (const r of results) {
  const mark = r.skipped ? 'SKIP' : (r.code === 0 ? 'PASS' : (r.observational ? 'BASE' : 'FAIL'))
  if (r.code !== 0 && !r.observational) failed++
  console.log(`${mark}  ${r.name.padEnd(20)} exit=${r.code}  ${(r.ms / 1000).toFixed(1)}s`)
}
console.log(`===== ${results.length - failed}/${results.length} gates passed =====`)
if (existsSync(path.join(ROOT, 'dist'))) {
  console.log('pack artifact: dist/ present')
}
process.exit(failed === 0 ? 0 : 1)
