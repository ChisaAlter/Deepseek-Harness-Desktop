#!/usr/bin/env node
// Archive a decision record in one command:
//   node scripts/archive-decision.mjs docs/decisions/implemented/<class>/<slug>.md [--superseded-by <new record>]
// Steps: move the triplet to archived/<class>/, insert `Archived: <today>`
// below Status in both md sides, rewrite inbound links across docs/.cursor/
// root md, re-record the i18n sidecars and the sealed manifest. With
// --superseded-by, inserts a `Supersedes:` pointer line into BOTH sides of
// the replacement record (archived notes stay frozen — the pointer lives in
// the successor, per contract) and re-records that pair too.
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, dirname, basename, relative, sep } from 'node:path'
import { repoRoot, walk, rel, read, isMain } from './lib/gate.mjs'
import { writeManifest } from './verify-archived-decisions.mjs'
import { writePair } from './verify-translation-pairing.mjs'

const TODAY = new Date().toISOString().slice(0, 10)

function stemOf(p) {
  return p.replace(/\.en\.md$/, '').replace(/\.i18n\.yaml$/, '').replace(/\.md$/, '')
}

export function archive(root, targetRel, { supersededBy } = {}) {
  const norm = targetRel.replace(/\\/g, '/')
  const m = norm.match(/^docs\/decisions\/(implemented|rejected)\/([^/]+)\/(.+)$/)
  if (!m) throw new Error(`not an archivable record path: ${targetRel} (needs docs/decisions/{implemented|rejected}/<class>/<slug>.*)`)
  const [, life, cls, file] = m
  const slug = stemOf(file)
  const srcDir = `docs/decisions/${life}/${cls}`
  const dstDir = `docs/decisions/archived/${cls}`
  const moved = []

  for (const ext of ['.md', '.en.md', '.i18n.yaml']) {
    const src = join(root, srcDir, slug + ext)
    if (!existsSync(src)) throw new Error(`missing triplet member ${srcDir}/${slug}${ext}`)
    mkdirSync(join(root, dstDir), { recursive: true })
    const dst = join(root, dstDir, slug + ext)
    if (existsSync(dst)) throw new Error(`already exists: ${dstDir}/${slug}${ext}`)
    renameSync(src, dst)
    moved.push(`${dstDir}/${slug}${ext}`)
  }

  for (const ext of ['.md', '.en.md']) {
    const p = join(root, dstDir, slug + ext)
    const lines = read(p).replace(/\r\n/g, '\n').split('\n')
    const si = lines.findIndex((l) => l.startsWith('Status: '))
    if (si === -1) throw new Error(`${dstDir}/${slug}${ext}: no Status line`)
    if (!/^Archived: /.test(lines[si + 1] ?? '')) lines.splice(si + 1, 0, '', `Archived: ${TODAY}`)
    writeFileSync(p, lines.join('\n'))
  }

  // Inbound links: rewrite `implemented|rejected/<class>/<slug>` targets to
  // `archived/<class>/<slug>` in every markdown file outside the moved files.
  let rewired = 0
  const oldSeg = `${life}/${cls}/${slug}`
  const newSeg = `archived/${cls}/${slug}`
  const rootMds = readdirSync(root).filter((f) => f.endsWith('.md')).map((f) => join(root, f))
  for (const p of [...walk(join(root, 'docs')), ...walk(join(root, '.cursor')), ...rootMds]) {
    if (!p.endsWith('.md') && !p.endsWith('.mdc')) continue
    const text = read(p)
    if (!text.includes(oldSeg)) continue
    writeFileSync(p, text.replaceAll(oldSeg, newSeg))
    rewired++
  }

  if (supersededBy) {
    const supNorm = supersededBy.replace(/\\/g, '/')
    for (const ext of ['.md', '.en.md']) {
      const p = join(root, stemOf(supNorm) + ext)
      if (!existsSync(p)) throw new Error(`--superseded-by triplet member missing: ${stemOf(supNorm)}${ext}`)
      const text = read(p)
      const pointer = `> Supersedes [${slug}](${relative(dirname(stemOf(supNorm)), `${dstDir}/${slug}`).split(sep).join('/')}${ext})`
      if (!text.includes('> Supersedes ')) {
        const lines = text.split('\n')
        const sw = lines.findIndex((l) => /^\[?中文.*\||.*\| English$/.test(l.trim()) && l.includes('|'))
        lines.splice(sw > -1 ? sw + 1 : 4, 0, '', pointer)
        writeFileSync(p, lines.join('\n'))
      }
    }
    writePair(root, dirname(stemOf(supNorm)).split(sep).join('/'), basename(stemOf(supNorm)))
  }

  writePair(root, dstDir, slug)
  writeManifest(root)
  return { moved, rewired }
}

if (isMain(import.meta.url)) {
  try {
    const root = repoRoot()
    const args = process.argv.slice(2).filter((a) => a !== '--root' && a !== root)
    const supIdx = args.indexOf('--superseded-by')
    const supersededBy = supIdx > -1 ? args[supIdx + 1] : undefined
    const target = args.find((a, i) => !a.startsWith('--') && i !== supIdx + 1)
    if (!target) {
      console.error('usage: archive-decision.mjs <record path> [--superseded-by <new record>]')
      process.exit(2)
    }
    const relTarget = rel(root, join(root, target))
    const { moved, rewired } = archive(root, relTarget, { supersededBy })
    for (const f of moved) console.log(`moved    ${f}`)
    console.log(`rewired  ${rewired} file(s) pointing at the record`)
    console.log('sealed   scripts/archived-decisions.manifest.json — run npm run doc-sync')
  } catch (e) {
    console.error(`archive-decision: ${e.message}`)
    process.exit(1)
  }
}
