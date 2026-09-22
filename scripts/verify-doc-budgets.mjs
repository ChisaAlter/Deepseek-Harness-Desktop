#!/usr/bin/env node
// Gate: word budgets for the authority documents listed in
// scripts/doc-budgets.manifest.json. Metric: CJK characters count as one
// word each; non-CJK runs count as words. Ceilings are guardrails — when red,
// relocate or condense first; raise only with PR justification.
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { repoRoot, runGate, fail, isMain, read } from './lib/gate.mjs'

export function wordsOf(text) {
  const stripped = text.replace(/```[\s\S]*?```/g, ' ')
  const cjk = (stripped.match(/[㐀-鿿豈-﫿]/g) || []).length
  const latin = (stripped.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[\p{L}\p{N}_'-]+/gu) || []).length
  return cjk + latin
}

export function collect(root) {
  const violations = []
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/doc-budgets.manifest.json'), 'utf8'))
  for (const [file, ceiling] of Object.entries(manifest)) {
    if (file.startsWith('$')) continue
    const p = join(root, file)
    if (!existsSync(p)) {
      fail(violations, file, 'listed in budgets manifest but missing on disk')
      continue
    }
    const n = wordsOf(read(p))
    if (n > ceiling) fail(violations, file, `${n} words over ceiling ${ceiling} (relocate or condense first; raise only with justification)`)
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-doc-budgets', collect, repoRoot())
}
