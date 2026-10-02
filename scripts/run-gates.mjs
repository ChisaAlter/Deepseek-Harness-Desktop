#!/usr/bin/env node
// Aggregate gate runner for DSHD. package.json owns the public names
// (`doc-sync`, `check:governance`); this runner owns the leaf inventory and
// explicit manual execution. Stop after the first failed check to diagnose it.
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
  ],
  // Everything touching documentation, including links and pairing.
  'doc-sync': [
    'verify-decision-tree.mjs',
    'verify-decision-format.mjs',
    'verify-archived-decisions.mjs',
    'verify-feature-cards.mjs',
    'verify-rules-sync.mjs',
    'verify-md-links.mjs',
    'verify-translation-pairing.mjs',
  ],
}

const modes = process.argv.slice(2)
if (!modes.length || modes.some(mode => !MODES[mode])) {
  console.error(`run-gates: select known modes (have: ${Object.keys(MODES).join(', ')})`)
  process.exit(2)
}

const results = []
for (const leaf of new Set(modes.flatMap(mode => MODES[mode]))) {
  const r = spawnSync(process.execPath, [join(here, leaf)], { stdio: 'inherit', env: process.env })
  const status = r.status === 0 ? 'passed' : 'failed'
  results.push({ leaf, status })
  if (status === 'failed') break
}
const red = results.filter((r) => r.status === 'failed')
console.log(`run-gates ${modes.join('+')}: ${results.length - red.length}/${results.length} passed${red.length ? `; failed: ${red.map((r) => r.leaf).join(', ')}` : ''}`)
process.exit(red.length ? 1 : 0)
