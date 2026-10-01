#!/usr/bin/env node
// Preserve user-owned hooks/drivers. --check reports actual configuration.
import { existsSync, chmodSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { repoRoot, isMain } from './lib/gate.mjs'
const SETTINGS = {
  'core.hooksPath': 'scripts/git-hooks',
  'merge.dshd-translation-pairing.name': 'DSHD translation pairing record',
  'merge.dshd-translation-pairing.driver': 'node scripts/merge-driver-i18n.mjs %O %A %B %P',
}
export function integrate(root, { check = false } = {}) {
  if (!existsSync(join(root, '.git'))) {
    if (check) throw new Error('No .git checkout; hooks are not active here')
    return 'no .git — skipped (source archive)'
  }
  const git = args => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true })
    if (result.error || (result.status !== 0 && !(args[0] === 'config' && args.includes('--get') && result.status === 1))) throw new Error(result.error?.message || result.stderr.trim() || 'Git integration command failed')
    return result.stdout.trim()
  }
  const current = Object.fromEntries(Object.keys(SETTINGS).map(key => [key, git(['config', '--get', key])]))
  for (const name of ['pre-commit', 'pre-push']) if (!existsSync(join(root, 'scripts/git-hooks', name))) throw new Error(`Missing repository hook ${name}`)
  if (!existsSync(join(root, 'scripts/merge-driver-i18n.mjs'))) throw new Error('Missing i18n merge driver')
  if (check) {
    const missing = Object.entries(SETTINGS).filter(([key, value]) => current[key] !== value).map(([key]) => key)
    if (missing.length) throw new Error(`Git integrations are not active: ${missing.join(', ')}; run node scripts/install-git-integrations.mjs`)
    return 'hooksPath + i18n merge driver verified'
  }
  const foreign = Object.entries(SETTINGS).filter(([key, value]) => current[key] && current[key] !== value).map(([key]) => key)
  if (foreign.length) throw new Error(`Preserving existing Git configuration: ${foreign.join(', ')}. Integrate with the existing setup explicitly.`)
  const defaultHooks = git(['rev-parse', '--git-path', 'hooks'])
  if (!current['core.hooksPath'] && ['pre-commit', 'pre-push'].some(name => existsSync(resolve(root, defaultHooks, name)))) throw new Error('Preserving existing .git/hooks/pre-commit or pre-push; integrate them explicitly')
  for (const name of readdirSync(join(root, 'scripts/git-hooks'))) chmodSync(join(root, 'scripts/git-hooks', name), 0o755)
  for (const [key, value] of Object.entries(SETTINGS)) git(['config', '--local', key, value])
  return 'hooksPath + i18n merge driver installed'
}
if (isMain(import.meta.url)) {
  try { console.log(`install-git-integrations: ${integrate(repoRoot(), { check: process.argv.includes('--check') })}`) }
  catch (error) { console.error(`install-git-integrations: ${error.message}`); process.exitCode = 1 }
}
