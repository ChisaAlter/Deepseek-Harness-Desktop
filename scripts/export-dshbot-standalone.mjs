#!/usr/bin/env node
// Assembles the standalone dshbot repository tree (root = the plugin
// package) from vendor/dshbot plus the templates in scripts/dshbot-standalone/.
//
// Usage:
//   node scripts/export-dshbot-standalone.mjs <output-dir>
//
// The output is the exact content of the ChisaAlter/dshbot repository:
//   git init && git add -A && git commit   inside <output-dir>, then push.
// Re-run after vendor/dshbot changes to refresh the standalone tree; the
// desktop unit suite (src/main/dshbot-publish-manifest.test.js) locks the
// exported tree against scripts/dshbot-standalone/check-publish.mjs.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = path.join(root, 'vendor', 'dshbot')
const templateDir = path.join(root, 'scripts', 'dshbot-standalone')

const outDir = path.resolve(String(process.argv[2] || '').trim() || '')
if (!process.argv[2]) {
  console.error('usage: node scripts/export-dshbot-standalone.mjs <output-dir>')
  process.exit(1)
}
if (existsSync(outDir)) {
  console.error(`output dir ${outDir} already exists; refusing to overwrite`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

try {
  // Package payload: everything npm packs (plus the manifest itself).
  for (const entry of ['lib', 'client', 'presets', 'cordis.patch.yml', 'LICENSE']) {
    cpSync(path.join(pkgDir, entry), path.join(outDir, entry), { recursive: true })
  }

  // Manifest: same package, repository/homepage moved to the standalone repo.
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  pkg.repository = { type: 'git', url: 'git+https://github.com/ChisaAlter/dshbot.git' }
  pkg.homepage = 'https://github.com/ChisaAlter/dshbot#readme'
  writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  // Standalone-repo scaffolding from templates.
  cpSync(path.join(templateDir, 'README.md'), path.join(outDir, 'README.md'))
  cpSync(path.join(templateDir, 'check-publish.mjs'), path.join(outDir, 'scripts', 'check-publish.mjs'))
  cpSync(path.join(templateDir, 'publish.yml'), path.join(outDir, '.github', 'workflows', 'publish.yml'))
  cpSync(path.join(root, '.nvmrc'), path.join(outDir, '.nvmrc'))
  writeFileSync(path.join(outDir, '.gitignore'), 'node_modules/\n*.tgz\n')

  console.log(`standalone dshbot tree exported to ${outDir} (dshbot@${pkg.version})`)
} catch (error) {
  rmSync(outDir, { recursive: true, force: true })
  throw error
}
