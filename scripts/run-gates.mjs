#!/usr/bin/env node
// Aggregate gate runner for DSHD. package.json owns the public names
// (`doc-sync`, `check:governance`); this runner owns the leaf inventory and
// serial execution. DSHD_GATE_FAIL_FAST=1 stops after the first red gate.
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const MODES = {
  // Structural + contract gates that do not need a build.
  governance: [
    'verify-decision-tree.mjs',
    'verify-decision-format.mjs',
    'verify-archived-decisions.mjs',
    'verify-feature-cards.mjs',
    'verify-rules-sync.mjs',
    'check-remote-flag-not-committed.mjs',
  ],
  // Everything touching documentation, including pairing and budgets.
  'doc-sync': [
    'verify-decision-tree.mjs',
    'verify-decision-format.mjs',
    'verify-archived-decisions.mjs',
    'verify-feature-cards.mjs',
    'verify-rules-sync.mjs',
    'verify-md-links.mjs',
    'verify-translation-pairing.mjs',
    'verify-doc-budgets.mjs',
  ],
}

const mode = process.argv[2]
if (!MODES[mode]) {
  console.error(`run-gates: unknown mode \`${mode ?? ''}\` (have: ${Object.keys(MODES).join(', ')})`)
  process.exit(2)
}

const failFast = process.env.DSHD_GATE_FAIL_FAST === '1'
const results = []
for (const leaf of MODES[mode]) {
  const r = spawnSync(process.execPath, [join(here, leaf)], { stdio: 'inherit', env: process.env })
  const status = r.status === 0 ? 'passed' : 'failed'
  results.push({ leaf, status })
  if (status === 'failed' && failFast) break
}
const red = results.filter((r) => r.status === 'failed')
console.log(`run-gates ${mode}: ${results.length - red.length}/${results.length} passed${red.length ? `; failed: ${red.map((r) => r.leaf).join(', ')}` : ''}`)
process.exit(red.length ? 1 : 0)
