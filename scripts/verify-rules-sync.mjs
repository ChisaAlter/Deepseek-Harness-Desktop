#!/usr/bin/env node
// Gate: every .cursor/rules/*.mdc links at least one docs/features/<id>.md
// that exists (the "Full card:" contract); every linked path resolves.
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { repoRoot, runGate, fail, isMain, read } from './lib/gate.mjs'

export function collect(root) {
  const violations = []
  const dir = join(root, '.cursor/rules')
  if (!existsSync(dir)) return violations
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.mdc')) continue
    const rel = `.cursor/rules/${name}`
    const text = read(join(dir, name))
    const bare = [...text.matchAll(/docs\/features\/([A-Za-z0-9_-]+)\.md/g)]
    if (name.endsWith('-product.mdc') && bare.length === 0) {
      fail(violations, rel, 'no docs/features/<id>.md link (a *-product rule must anchor a card)')
    }
    for (const m of bare) {
      if (!existsSync(join(root, 'docs/features', `${m[1]}.md`))) {
        fail(violations, rel, `links missing card docs/features/${m[1]}.md`)
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-rules-sync', collect, repoRoot())
}
