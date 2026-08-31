#!/usr/bin/env node
// Publish preflight for the standalone dshbot repository (package at the
// repo root). Mirrors scripts/check-dshbot-publish.mjs in
// ChisaAlter/Deepseek-Harness-Desktop, adapted to the root layout and the
// `v<semver>` tag shape.
//
// Usage:
//   node scripts/check-publish.mjs          # manifest integrity only
//   node scripts/check-publish.mjs v0.2.0   # + tag/version match
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))

const errors = []

if (pkg.private) errors.push('package must not be private')
if (pkg.publishConfig?.access !== 'public') {
  errors.push('publishConfig.access must be "public" (unscoped-safe, explicit)')
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(pkg.version || ''))) {
  errors.push(`version "${pkg.version}" is not a valid semver`)
}
if (pkg.license !== 'MIT') errors.push(`license must be MIT, got "${pkg.license}"`)

// npm provenance requires the manifest repository to be the repo the
// workflow actually builds in; this also stops accidental publishes from a
// monorepo checkout.
const repoUrl = String(pkg.repository?.url || '')
if (!/github\.com\/ChisaAlter\/dshbot(\.git)?$/i.test(repoUrl)) {
  errors.push(`repository.url must point at github.com/ChisaAlter/dshbot, got "${repoUrl}"`)
}
if (pkg.repository?.directory) {
  errors.push('repository.directory must be absent (package lives at the repo root)')
}

for (const file of ['LICENSE', 'README.md', 'cordis.patch.yml']) {
  if (!existsSync(path.join(pkgDir, file))) errors.push(`missing ${file}`)
}

const filesList = Array.isArray(pkg.files) ? pkg.files : []
for (const entry of ['lib', 'client', 'presets', 'cordis.patch.yml']) {
  if (!filesList.includes(entry)) errors.push(`"files" must include "${entry}"`)
}

// Every export target must exist on disk and be covered by the pack manifest
// ("files" entries, or a root file npm always includes).
const alwaysPacked = new Set(['package.json', 'README.md', 'LICENSE'])
const coveredByFiles = (relPath) =>
  alwaysPacked.has(relPath)
  || filesList.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`))

for (const [key, target] of Object.entries(pkg.exports || {})) {
  if (typeof target !== 'string') {
    errors.push(`exports["${key}"] must be a plain path string`)
    continue
  }
  const relPath = target.replace(/^\.\//, '')
  if (!existsSync(path.join(pkgDir, relPath))) {
    errors.push(`exports["${key}"] points at missing file ${target}`)
  } else if (!coveredByFiles(relPath)) {
    errors.push(`exports["${key}"] target ${target} is not covered by "files"`)
  }
}

if (pkg.main && !existsSync(path.join(pkgDir, pkg.main.replace(/^\.\//, '')))) {
  errors.push(`main points at missing file ${pkg.main}`)
}

if (!existsSync(path.join(pkgDir, 'presets', 'dshbot-room'))) {
  errors.push('presets/dshbot-room is missing (room preset self-provisioning would break)')
}

const tag = String(process.argv[2] || '').trim()
if (tag) {
  const expected = `v${pkg.version}`
  if (tag !== expected) {
    errors.push(`tag ${tag} does not match package version ${pkg.version}; expected ${expected}`)
  }
}

if (errors.length > 0) {
  console.error('dshbot publish preflight failed:')
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`dshbot publish preflight passed (dshbot@${pkg.version}${tag ? `, tag ${tag}` : ''})`)
