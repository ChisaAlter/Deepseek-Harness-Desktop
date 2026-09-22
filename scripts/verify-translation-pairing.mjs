#!/usr/bin/env node
// Gate: bilingual pairing. A pair is `foo.md` (Chinese source) + `foo.en.md`
// (English counterpart) + `foo.i18n.yaml` (record of git blob hashes and the
// shared structural signature). docs/decisions/** pairs are discovered by
// walking the tree; extra pairs register in scripts/i18n-pairs.manifest.json.
// A pair whose recorded hashes no longer match is stale: red unless the pair
// is registered in scripts/i18n-pending.manifest.json (a one-way ratchet —
// registered pairs that are fresh again must leave the list).
//   --list              report every pair's state without failing
//   --write <path>      re-record the sidecar for the pair containing <path>
import { join, dirname } from 'node:path'
import { existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { repoRoot, runGate, fail, walk, isMain, read, hasFlag, rel } from './lib/gate.mjs'

const PAIRS_MANIFEST = 'scripts/i18n-pairs.manifest.json'
const PENDING_MANIFEST = 'scripts/i18n-pending.manifest.json'

/** git blob hash of the EOL-normalized content — the committed blob, stable
 * across checkout line endings on the Windows/macOS gate matrix. */
export function blobHash(content) {
  const buf = Buffer.from(content.replace(/\r\n/g, '\n'), 'utf8')
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/**
 * Structural signature of a markdown side: heading depths, paragraph counts,
 * list kinds+counts, table shapes, byte-exact code fences, and normalized
 * relative links. Translation must preserve all of it.
 */
export function signature(text) {
  const sig = { h: [], lists: [], tables: [], fences: [], links: [] }
  const norm = text.replace(/\r\n/g, '\n')
  // Relative .md links, locale-normalized — scanned over prose with fences
  // removed (links inside list items and table rows count).
  const prose = norm.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ' ')
  for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s#]+)(#[^)\s]*)?\)/g)) {
    const t = m[1]
    if (/^[a-z]+:/i.test(t) || t.startsWith('//') || !t.endsWith('.md')) continue
    sig.links.push(t.replace(/\.en\.md$/, '.md'))
  }
  const lines = norm.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\S*)/)
    if (fence) {
      let body = ''
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { body += lines[i] + '\n'; i++ }
      // Shell fences: comments are prose — normalize them away so each locale
      // may annotate commands in its own language.
      if (/^(shell|bash|sh|zsh|ps1|console)$/.test(fence[1] ?? '')) {
        body = body.split('\n').map((l) => l.replace(/\s+#.*$/, '').replace(/\s+\/\/.*$/, '')).join('\n')
      }
      sig.fences.push([fence[1] ?? '', createHash('sha1').update(body).digest('hex')])
      i++
      continue
    }
    const h = line.match(/^(#{1,6})\s/)
    if (h) { sig.h.push(h[1].length); i++; continue }
    if (/^\|.*\|\s*$/.test(line)) {
      let rows = 0, cols = 0
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        if (rows === 0) cols = lines[i].split('|').length - 2
        rows++; i++
      }
      sig.tables.push([rows, cols])
      continue
    }
    if (/^\s*([-+*]|\d+\.)\s/.test(line)) {
      const kind = /^\s*\d+\./.test(line) ? 'ol' : 'ul'
      let n = 0
      // A block continues through indented continuation lines (wrapped items).
      while (i < lines.length) {
        const l = lines[i]
        if (/^\s*([-+*]|\d+\.)\s/.test(l)) n++
        else if (l.trim() === '' || !/^\s+\S/.test(l)) break
        i++
      }
      sig.lists.push([kind, n])
      continue
    }
    i++
  }
  return sig
}

export const sigHash = (text) => createHash('sha256').update(JSON.stringify(signature(text))).digest('hex')

function parseSidecar(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-z]+):\s*(\S+)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** All known pairs: [{dir, stem}] with dir relative to root, stem without ext. */
export function pairs(root) {
  const out = []
  const dec = join(root, 'docs/decisions')
  if (existsSync(dec)) {
    for (const top of ['README', '_template']) {
      if (existsSync(join(dec, `${top}.md`))) out.push({ dir: 'docs/decisions', stem: top })
    }
    for (const life of readdirSync(dec)) {
      const lp = join(dec, life)
      if (!statSync(lp).isDirectory()) continue
      for (const cls of readdirSync(lp)) {
        const cp = join(lp, cls)
        if (!statSync(cp).isDirectory()) continue
        for (const f of readdirSync(cp)) {
          if (f.endsWith('.md') && !f.endsWith('.en.md')) {
            out.push({ dir: `docs/decisions/${life}/${cls}`, stem: f.slice(0, -3) })
          }
        }
      }
    }
  }
  const pm = join(root, PAIRS_MANIFEST)
  if (existsSync(pm)) {
    for (const stem of JSON.parse(read(pm)).pairs || []) {
      const dir = dirname(stem)
      out.push({ dir: dir === '.' ? '' : dir, stem: stem.slice(dir === '.' ? 0 : dir.length + 1) })
    }
  }
  return out
}

function switcherOk(text, want, htmlRe) {
  const head = text.split('\n').filter((l) => l.trim() !== '').slice(0, 14)
  return head.some((l) => l === want || htmlRe.test(l))
}

export function pairState(root, dir, stem) {
  const zh = join(root, dir, `${stem}.md`)
  const en = join(root, dir, `${stem}.en.md`)
  const sc = join(root, dir, `${stem}.i18n.yaml`)
  const relBase = `${dir ? dir + '/' : ''}${stem}`
  const st = { pair: relBase, missing: [], violations: [], stale: false }
  if (!existsSync(zh)) st.missing.push(`${relBase}.md`)
  if (!existsSync(en)) st.missing.push(`${relBase}.en.md`)
  if (!existsSync(sc)) st.missing.push(`${relBase}.i18n.yaml`)
  if (st.missing.length) return st

  const zhRaw = read(zh)
  const enRaw = read(en)
  const zhText = zhRaw.replace(/\r\n/g, '\n')
  const enText = enRaw.replace(/\r\n/g, '\n')
  const zhHash = blobHash(zhRaw)
  const enHash = blobHash(enRaw)

  const wantZh = `中文 | [English](${stem}.en.md)`
  const wantEn = `[中文](${stem}.md) | English`
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const zhHtml = new RegExp(`<a href="${esc(stem)}\\.en\\.md"[^>]*>\\s*English\\s*</a>`)
  const enHtml = new RegExp(`<a href="${esc(stem)}\\.md"[^>]*>\\s*中文\\s*</a>`)
  if (!switcherOk(zhText, wantZh, zhHtml)) st.violations.push(`${relBase}.md: switcher line must be \`${wantZh}\` (or an <a> link to ${stem}.en.md labelled English)`)
  if (!switcherOk(enText, wantEn, enHtml)) st.violations.push(`${relBase}.en.md: switcher line must be \`${wantEn}\` (or an <a> link to ${stem}.md labelled 中文)`)

  // Same-locale link discipline: zh never links .en.md; en must link .en.md
  // when the target has an English counterpart on disk. The switcher line is
  // the legitimate cross-locale link; code samples are not links.
  const scrub = (t) => t
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n').filter((l) => l !== wantZh && l !== wantEn && !zhHtml.test(l) && !enHtml.test(l)).join('\n')
  const zhScan = scrub(zhText)
  const enScan = scrub(enText)
  for (const m of zhScan.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (m[1].endsWith('.en.md')) st.violations.push(`${relBase}.md: zh side must not link ${m[1]}`)
  }
  for (const m of enScan.matchAll(/\]\(([^)\s]+)\)/g)) {
    const t = m[1]
    if (t.endsWith('.md') && !t.endsWith('.en.md')) {
      const enTarget = join(root, dir, t.replace(/\.md$/, '.en.md'))
      if (existsSync(enTarget)) st.violations.push(`${relBase}.en.md: link ${t} should target the English side ${t.replace(/\.md$/, '.en.md')}`)
    }
  }

  const zhSig = signature(zhText)
  const enSig = signature(enText)
  if (JSON.stringify(zhSig) !== JSON.stringify(enSig)) {
    st.violations.push(`${relBase}: structural signature drift (heading/list/table/fence/link skeleton differs between sides)`)
  }

  const rec = parseSidecar(read(sc))
  st.stale = rec.zh !== zhHash || rec.en !== enHash || rec.signature !== sigHash(zhText)
  return st
}

export function collect(root) {
  const violations = []
  const pendingPath = join(root, PENDING_MANIFEST)
  const pending = new Set(existsSync(pendingPath) ? JSON.parse(read(pendingPath)).pairs || [] : [])
  const seen = new Set()
  for (const { dir, stem } of pairs(root)) {
    const st = pairState(root, dir, stem)
    seen.add(st.pair)
    for (const v of st.violations) violations.push(v)
    if (st.missing.length) {
      fail(violations, st.pair, `incomplete pair: missing ${st.missing.join(', ')}`)
    } else if (st.stale && !pending.has(st.pair)) {
      fail(violations, st.pair, 'stale: content drifted from recorded hashes — translate, then `verify-translation-pairing --write` (or register in i18n-pending manifest)')
    }
  }
  for (const p of pending) {
    if (!seen.has(p)) fail(violations, p, 'pending manifest lists an unknown pair')
    else if (!pairState(root, dirname(p) === '.' ? '' : dirname(p), p.slice(dirname(p) === '.' ? 0 : dirname(p).length + 1)).stale) {
      fail(violations, p, 'pending manifest entry is no longer stale — remove it (ratchet is one-way)')
    }
  }
  // Orphan English sides / sidecars outside registered pairs.
  const candidates = []
  for (const f of readdirSync(root)) if (f.endsWith('.en.md') || f.endsWith('.i18n.yaml')) candidates.push(join(root, f))
  const dirs = ['docs', '.github']
  for (const p of candidates.concat(dirs.flatMap((d) => [...walk(join(root, d))]))) {
    const r = rel(root, p)
    if (/^docs\/(superpowers|qa\/results|decisions)\//.test(r)) continue
    const base = r.replace(/\.en\.md$/, '').replace(/\.i18n\.yaml$/, '')
    if ((r.endsWith('.en.md') || r.endsWith('.i18n.yaml')) && !seen.has(base)) {
      fail(violations, r, 'English side / sidecar outside a registered pair')
    }
  }
  return violations
}

export function writePair(root, dir, stem) {
  const zh = join(root, dir, `${stem}.md`)
  const en = join(root, dir, `${stem}.en.md`)
  const sc = join(root, dir, `${stem}.i18n.yaml`)
  for (const p of [zh, en]) {
    if (!existsSync(p)) { console.error(`verify-translation-pairing: cannot write — missing ${rel(root, p)}`); process.exitCode = 1; return }
  }
  const body =
    `# pairing confirmation record — regenerated by verify-translation-pairing --write\n` +
    `zh: ${blobHash(read(zh))}\n` +
    `en: ${blobHash(read(en))}\n` +
    `signature: ${sigHash(read(zh))}\n`
  mkdirSync(dirname(sc), { recursive: true })
  writeFileSync(sc, body)
  console.log(`${rel(root, sc)}: recorded`)
}

if (isMain(import.meta.url)) {
  const root = repoRoot()
  const argv = process.argv.slice(2).filter((a) => a !== '--root')
  if (hasFlag(argv, '--write')) {
    const target = argv[argv.indexOf('--write') + 1]
    if (!target) { console.error('--write needs a path inside the pair'); process.exit(2) }
    const relTarget = rel(root, join(root, target))
    const stem = relTarget.replace(/\.en\.md$/, '').replace(/\.i18n\.yaml$/, '').replace(/\.md$/, '')
    writePair(root, dirname(stem) === '.' ? '' : dirname(stem), stem.slice(dirname(stem) === '.' ? 0 : dirname(stem).length + 1))
  } else if (hasFlag(argv, '--list')) {
    const pendingPath = join(root, PENDING_MANIFEST)
    const pending = new Set(existsSync(pendingPath) ? JSON.parse(read(pendingPath)).pairs || [] : [])
    for (const { dir, stem } of pairs(root)) {
      const st = pairState(root, dir, stem)
      const state = st.missing.length ? 'incomplete' : st.violations.length ? 'violations' : st.stale ? (pending.has(st.pair) ? 'pending' : 'stale') : 'ok'
      console.log(`${state.padEnd(11)} ${st.pair}`)
    }
  } else {
    runGate('verify-translation-pairing', collect, root)
  }
}
