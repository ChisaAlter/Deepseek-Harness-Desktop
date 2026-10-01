#!/usr/bin/env node
// Resolve known pairing sidecars only; never scan dependencies or user data.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, read, isMain } from './lib/gate.mjs'
import { writePair, pairs } from './verify-translation-pairing.mjs'
export function resolveConflicts(root) {
  const hasMarkers = p => existsSync(p) && /^(<{7}|={7}|>{7})/m.test(read(p))
  let resolved = 0
  const blocked = []
  for (const { dir, stem } of pairs(root)) {
    const base = `${dir ? dir + '/' : ''}${stem}`
    if (!hasMarkers(join(root, `${base}.i18n.yaml`))) continue
    if (dir.startsWith('docs/decisions/archived/')) { blocked.push(`${base}: sealed history requires explicit conflict resolution`); continue }
    if (['.md', '.en.md'].some(ext => !existsSync(join(root, base + ext)) || hasMarkers(join(root, base + ext)))) {
      blocked.push(`${base}: owner files missing or conflicted`)
      continue
    }
    try { writePair(root, dir, stem); resolved++ }
    catch (error) { blocked.push(error.message) }
  }
  return { resolved, blocked }
}
if (isMain(import.meta.url)) {
  const result = resolveConflicts(repoRoot())
  for (const error of result.blocked) console.error(`blocked  ${error}`)
  console.log(`resolve-pairing-conflicts: ${result.resolved} resolved, ${result.blocked.length} blocked; review content before staging`)
  process.exitCode = result.blocked.length ? 1 : 0
}
