#!/usr/bin/env node
// Validate the complete archive operation and restore originals on failure.
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname, basename, relative, sep } from 'node:path'
import { repoRoot, walk, rel, read, isMain } from './lib/gate.mjs'
import { writeManifest, collect as sealedViolations } from './verify-archived-decisions.mjs'
import { writePair, pairs } from './verify-translation-pairing.mjs'
const stemOf = p => p.replace(/\.en\.md$|\.i18n\.yaml$|\.md$/, '')
const RECORD = /^docs\/decisions\/implemented\/[a-z-]+\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/
function members(root, stem) {
  if (!existsSync(join(root, `${stem}.md`))) throw new Error(`missing record ${stem}.md`)
  const paired = ['.en.md', '.i18n.yaml'].some(ext => existsSync(join(root, stem + ext))) || read(join(root, `${stem}.md`)).includes(`${basename(stem)}.en.md`)
  const extensions = paired ? ['.md', '.en.md', '.i18n.yaml'] : ['.md']
  for (const ext of extensions) if (!existsSync(join(root, stem + ext))) throw new Error(`missing triplet member ${stem}${ext}`)
  return extensions
}
export function archive(root, targetRel, { supersededBy } = {}) {
  const source = stemOf(targetRel.replaceAll('\\', '/'))
  if (!RECORD.test(source)) throw new Error(`not an archivable record path: ${targetRel} (implemented only; rejected records keep their verdict)`)
  const destination = source.replace('/implemented/', '/archived/')
  const extensions = members(root, source)
  const successor = supersededBy && stemOf(supersededBy.replaceAll('\\', '/'))
  if (successor && (!RECORD.test(successor) || successor === source)) throw new Error('Invalid --superseded-by record')
  const successorExtensions = successor ? members(root, successor) : []
  if (sealedViolations(root).length) throw new Error('Existing archive seal is invalid; refusing to reseal changed history')
  for (const ext of extensions) if (existsSync(join(root, destination + ext))) throw new Error(`already exists: ${destination}${ext}`)
  const edits = new Map()
  const moved = extensions.map(ext => destination + ext)
  for (const ext of extensions) {
    let content = read(join(root, source + ext))
    if (ext.endsWith('.md')) {
      const lines = content.replace(/\r\n/g, '\n').split('\n')
      if (lines[2] !== 'Status: implemented') throw new Error(`${source}${ext}: expected Status: implemented`)
      lines.splice(3, 0, '', `Archived: ${new Date().toISOString().slice(0, 10)}`)
      content = lines.join('\n')
    }
    edits.set(source + ext, null)
    edits.set(destination + ext, content)
  }
  let rewired = 0
  const oldSeg = source.slice('docs/decisions/'.length)
  const newSeg = destination.slice('docs/decisions/'.length)
  const rootMds = readdirSync(root).filter(f => f.endsWith('.md')).map(f => join(root, f))
  const files = [...walk(join(root, 'docs')), ...walk(join(root, '.cursor')), ...walk(join(root, '.devin/skills')), ...rootMds]
  for (const p of files) {
    const file = rel(root, p)
    if (!/\.(md|mdc)$/.test(file) || /^docs\/(decisions\/archived|superpowers|qa\/results)\//.test(file) || edits.has(file)) continue
    const content = read(p)
    if (content.includes(oldSeg)) { edits.set(file, content.replaceAll(oldSeg, newSeg)); rewired++ }
  }
  for (const file of ['scripts/i18n-pairs.manifest.json', 'scripts/i18n-pending.manifest.json']) {
    if (!existsSync(join(root, file))) continue
    const content = read(join(root, file))
    if (content.includes(source)) edits.set(file, content.replaceAll(source, destination))
  }
  for (const ext of successorExtensions.filter(ext => ext.endsWith('.md'))) {
    const file = successor + ext
    const targetExt = ext === '.en.md' && extensions.includes(ext) ? ext : '.md'
    const link = relative(dirname(successor), destination + targetExt).split(sep).join('/')
    const pointer = `> Supersedes [${basename(source)}](${link})`
    const content = edits.get(file) ?? read(join(root, file))
    if (!content.includes(pointer)) edits.set(file, content.replace(/\n## Problem/, `\n${pointer}\n\n## Problem`))
  }
  const originals = new Map()
  const remember = file => { if (!originals.has(file)) originals.set(file, existsSync(join(root, file)) ? read(join(root, file)) : null) }
  const put = (file, content) => {
    const path = join(root, file)
    if (content === null) { if (existsSync(path)) unlinkSync(path) }
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  }
  try {
    for (const [file, content] of edits) { remember(file); put(file, content) }
    for (const { dir, stem } of pairs(root)) {
      const base = `${dir ? dir + '/' : ''}${stem}`
      if (!edits.has(`${base}.md`) && !edits.has(`${base}.en.md`)) continue
      remember(`${base}.i18n.yaml`)
      writePair(root, dir, stem)
    }
    remember('scripts/archived-decisions.manifest.json')
    writeManifest(root)
  } catch (error) {
    for (const [file, content] of [...originals].reverse()) put(file, content)
    throw error
  }
  return { moved, rewired }
}
if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const option = name => { const i = args.indexOf(name); if (i < 0) return; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} needs a value`); return args[i + 1] }
    option('--root')
    const root = repoRoot()
    const supersededBy = option('--superseded-by')
    const target = args.find((arg, i) => !arg.startsWith('--') && !['--root', '--superseded-by'].includes(args[i - 1]))
    if (!target) throw new Error('usage: archive-decision.mjs <record path> [--superseded-by <record>] [--root <dir>]')
    const { moved, rewired } = archive(root, rel(root, join(root, target)), { supersededBy })
    for (const file of moved) console.log(`moved    ${file}`)
    console.log(`rewired  ${rewired} file(s); archive sealed — run npm run doc-sync`)
  } catch (error) { console.error(`archive-decision: ${error.message}`); process.exitCode = 1 }
}
