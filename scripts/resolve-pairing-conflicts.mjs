#!/usr/bin/env node
// Post-merge helper: for every `*.i18n.yaml` left with conflict markers,
// re-record the sidecar from the working-tree owner files when those merged
// cleanly; otherwise report the pair as needing a human. Prints the paths it
// resolved — `git add` them yourself.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { repoRoot, walk, rel, read } from './lib/gate.mjs'
import { writePair } from './verify-translation-pairing.mjs'

const root = repoRoot()
const hasMarkers = (p) => existsSync(p) && /^(<{7}|={7}|>{7})/m.test(readFileSync(p, 'utf8'))
let resolved = 0, blocked = 0
for (const p of walk(root)) {
  if (!p.endsWith('.i18n.yaml') || !hasMarkers(p)) continue
  const dir = dirname(p)
  const stem = basename(p).replace(/\.i18n\.yaml$/, '')
  const zh = join(dir, `${stem}.md`)
  const en = join(dir, `${stem}.en.md`)
  if (hasMarkers(zh) || hasMarkers(en) || !existsSync(zh) || !existsSync(en)) {
    console.error(`blocked  ${rel(root, p)} — owner files still conflicted`)
    blocked++
    continue
  }
  writePair(root, rel(root, dir), stem)
  resolved++
}
console.log(`resolve-pairing-conflicts: ${resolved} resolved, ${blocked} blocked`)
process.exit(blocked ? 1 : 0)
