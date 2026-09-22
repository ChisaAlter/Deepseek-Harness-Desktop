#!/usr/bin/env node
// Gate: docs/decisions/ tree shape — closed lifecycle/class sets, dated
// filenames, no orphan sidecars. Class/lifecycle canonical set lives in
// scripts/decision-tree.json; pairing completeness is verify-translation-pairing's job.
import { join } from 'node:path'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { repoRoot, runGate, fail, isMain } from './lib/gate.mjs'

const DATED = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/
const TOP_ALLOWED = new Set(['README.md', 'README.en.md', 'README.i18n.yaml', '_template.md', '_template.en.md', '_template.i18n.yaml'])

export function collect(root) {
  const violations = []
  const tree = JSON.parse(readFileSync(join(root, 'scripts/decision-tree.json'), 'utf8'))
  const dir = join(root, 'docs/decisions')
  if (!existsSync(dir)) return violations

  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isFile()) {
      if (!TOP_ALLOWED.has(name)) fail(violations, `docs/decisions/${name}`, 'unexpected top-level file')
      continue
    }
    if (!tree.lifecycle.includes(name)) {
      fail(violations, `docs/decisions/${name}/`, 'not a lifecycle directory')
      continue
    }
    for (const cls of readdirSync(p).sort()) {
      const cp = join(p, cls)
      if (statSync(cp).isFile()) {
        fail(violations, `docs/decisions/${name}/${cls}`, 'files live under a class directory, not lifecycle root')
        continue
      }
      if (!tree.class.includes(cls)) {
        fail(violations, `docs/decisions/${name}/${cls}/`, 'not a class directory (canonical set: scripts/decision-tree.json)')
        continue
      }
      const slugs = new Map()
      for (const f of readdirSync(cp).sort()) {
        let slug, kind
        if (f.endsWith('.en.md')) { slug = f.slice(0, -6); kind = 'en.md' }
        else if (f.endsWith('.i18n.yaml')) { slug = f.slice(0, -10); kind = 'i18n.yaml' }
        else if (f.endsWith('.md')) { slug = f.slice(0, -3); kind = 'md' }
        else {
          fail(violations, `docs/decisions/${name}/${cls}/${f}`, 'filename must be yyyy-mm-dd-slug.{md,en.md,i18n.yaml}')
          continue
        }
        if (!DATED.test(slug)) {
          fail(violations, `docs/decisions/${name}/${cls}/${f}`, 'filename must be yyyy-mm-dd-slug.{md,en.md,i18n.yaml}')
          continue
        }
        const set = slugs.get(slug) || new Set()
        set.add(kind)
        slugs.set(slug, set)
      }
      for (const [slug, parts] of slugs) {
        if (!parts.has('md')) fail(violations, `docs/decisions/${name}/${cls}/${slug}`, 'sidecar/translation without a Chinese source file')
        if (parts.has('i18n.yaml') && !parts.has('en.md')) fail(violations, `docs/decisions/${name}/${cls}/${slug}.i18n.yaml`, 'i18n record without English counterpart')
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-decision-tree', collect, repoRoot())
}
