#!/usr/bin/env node
// Gate: relative markdown links resolve — file existence plus `#fragment`
// anchors against GitHub-style heading slugs. Scope: docs/**, root *.md,
// .github/*.md (both .md and .en.md sides).
import { join, dirname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { repoRoot, runGate, fail, walk, isMain, read } from './lib/gate.mjs'

const SCOPE_DIRS = ['docs', '.github']
// Frozen historical/process docs are not link-maintained (they describe a
// point-in-time state; plans/QA results age like upstream archived notes).
const SKIP = /^(docs\/superpowers|docs\/qa\/results)\//
const LINK = /!?\[[^\]]*\]\(([^)\s]+)\)/g

function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-')
}

function anchorsOf(text) {
  const set = new Set()
  for (const line of text.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (m) set.add(slugify(m[1]))
  }
  return set
}

function stripFencesAndComments(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, ' ')
}

export function collect(root) {
  const violations = []
  const files = []
  for (const d of SCOPE_DIRS) for (const p of walk(join(root, d))) if (p.endsWith('.md')) files.push(p)
  for (const f of readdirSync(root)) if (f.endsWith('.md')) files.push(join(root, f))

  for (const p of files) {
    const rel = p.slice(root.length + 1).replace(/\\/g, '/')
    if (SKIP.test(rel)) continue
    const text = stripFencesAndComments(read(p))
    const selfAnchors = anchorsOf(read(p))
    for (const m of text.matchAll(LINK)) {
      const raw = m[1].replace(/<|>/g, '')
      if (/^[a-z]+:/i.test(raw) || raw.startsWith('//')) continue
      const [target, frag] = raw.split('#')
      if (target === '') {
        if (frag && !selfAnchors.has(slugify(decodeURIComponent(frag)))) {
          fail(violations, rel, `dead same-file anchor #${frag}`)
        }
        continue
      }
      const dest = join(dirname(p), decodeURIComponent(target))
      if (!existsSync(dest)) {
        fail(violations, rel, `dead link ${raw}`)
        continue
      }
      if (frag && target.endsWith('.md')) {
        const anchors = anchorsOf(read(dest))
        if (!anchors.has(slugify(decodeURIComponent(frag)))) {
          fail(violations, rel, `dead anchor ${raw}`)
        }
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-md-links', collect, repoRoot())
}
