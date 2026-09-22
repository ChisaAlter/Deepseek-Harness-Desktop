#!/usr/bin/env node
// Gate: docs/decisions/archived/ is a frozen zone. Every file's sha256 is
// recorded in scripts/archived-decisions.manifest.json; any content change,
// missing file, or unrecorded new file fails. `--write` regenerates the
// manifest — run it inside the same change that archives a triplet.
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { repoRoot, runGate, fail, walk, isMain, read, hasFlag } from './lib/gate.mjs'

const MANIFEST = 'scripts/archived-decisions.manifest.json'

export function collect(root) {
  const violations = []
  const dir = join(root, 'docs/decisions/archived')
  const manifestPath = join(root, MANIFEST)
  const manifest = existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : { files: {} }
  const onDisk = new Map()
  for (const p of walk(dir)) {
    const rel = p.slice(root.length + 1).replace(/\\/g, '/')
    onDisk.set(rel, createHash('sha256').update(read(p)).digest('hex'))
    if (/\.md$/.test(rel)) {
      const lines = read(p).split('\n')
      if (lines[2] !== 'Status: implemented') fail(violations, rel, 'archived record must keep `Status: implemented`')
      if (!lines.slice(3, 6).some((l) => /^Archived: \d{4}-\d{2}-\d{2}$/.test(l))) {
        fail(violations, rel, 'missing `Archived: YYYY-MM-DD` below Status')
      }
    }
  }
  // Triplet completeness inside the frozen tree (pairing gate skips archived).
  const slugs = new Map()
  for (const rel of onDisk.keys()) {
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    let slug, kind
    if (base.endsWith('.en.md')) { slug = base.slice(0, -6); kind = 'en.md' }
    else if (base.endsWith('.i18n.yaml')) { slug = base.slice(0, -10); kind = 'i18n.yaml' }
    else if (base.endsWith('.md')) { slug = base.slice(0, -3); kind = 'md' }
    else continue
    const s = slugs.get(slug) || new Set()
    s.add(kind)
    slugs.set(slug, s)
  }
  for (const [slug, parts] of slugs) {
    for (const need of ['md', 'en.md', 'i18n.yaml']) {
      if (!parts.has(need)) fail(violations, `docs/decisions/archived/**/${slug}.${need}`, 'incomplete archived triplet')
    }
  }
  for (const [rel, hash] of onDisk) {
    if (manifest.files[rel] !== hash) fail(violations, rel, 'content differs from sealed manifest (or is unrecorded)')
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!onDisk.has(rel)) fail(violations, rel, 'sealed file missing from disk')
  }
  return violations
}

export function writeManifest(root) {
  const dir = join(root, 'docs/decisions/archived')
  const files = {}
  for (const p of walk(dir)) {
    const rel = p.slice(root.length + 1).replace(/\\/g, '/')
    files[rel] = createHash('sha256').update(read(p)).digest('hex')
  }
  mkdirSync(dirname(join(root, MANIFEST)), { recursive: true })
  writeFileSync(join(root, MANIFEST), JSON.stringify({ files }, null, 2) + '\n')
  console.log(`${MANIFEST}: recorded ${Object.keys(files).length} sealed file(s)`)
}

if (isMain(import.meta.url)) {
  const root = repoRoot()
  if (hasFlag(process.argv.slice(2), '--write')) writeManifest(root)
  else runGate('verify-archived-decisions', collect, root)
}
