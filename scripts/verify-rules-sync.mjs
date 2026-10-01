#!/usr/bin/env node
// Gate: every .cursor/rules/*.mdc links at least one docs/features/<id>.md
// that exists (the "Full card:" contract). Checks Markdown destinations,
// not labels or bare text; this does NOT certify semantic agreement.
import { join, dirname, resolve, relative } from 'node:path'
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
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    let anchors = 0
    for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(m[1]) || m[1].startsWith('//')) continue
      let target
      try { target = decodeURIComponent(m[1].split('#')[0]) } catch { target = '' }
      const dest = resolve(dirname(join(root, rel)), target)
      const card = relative(join(root, 'docs/features'), dest).replaceAll('\\', '/')
      if (/^[A-Za-z0-9_-]+\.md$/.test(card) && !['README.md', '_template.md'].includes(card)) {
        anchors++
        if (!existsSync(dest)) fail(violations, rel, `links missing card docs/features/${card}`)
      } else if (!target || !existsSync(dest)) fail(violations, rel, `dead rule link ${m[1]}`)
    }
    if (name.endsWith('-product.mdc') && anchors === 0) {
      fail(violations, rel, 'no docs/features/<id>.md link (a *-product rule must anchor a card)')
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-rules-sync', collect, repoRoot())
}
