#!/usr/bin/env node
// Installs DSHD git integrations: core.hooksPath → scripts/git-hooks and the
// dshd-translation-pairing merge driver. Runs from `npm run prepare` (which npm
// invokes after install); silently skips non-git checkouts (npm pack, CI
// tarballs). Zero dependencies — no lefthook/husky.
import { existsSync, chmodSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, '.git'))) {
  console.log('install-git-integrations: no .git — skipping')
  process.exit(0)
}
const git = (args) => {
  const r = spawnSync('git', ['config', ...args], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`install-git-integrations: git config ${args.join(' ')} failed`)
    process.exitCode = 1
  }
}
// POSIX checkouts need the exec bit; on Windows this is a no-op.
for (const h of readdirSync(join(root, 'scripts/git-hooks'))) {
  chmodSync(join(root, 'scripts/git-hooks', h), 0o755)
}
git(['core.hooksPath', 'scripts/git-hooks'])
git(['merge.dshd-translation-pairing.name', 'DSHD translation pairing record'])
git(['merge.dshd-translation-pairing.driver', 'node scripts/merge-driver-i18n.mjs %O %A %B %P'])
if (!process.exitCode) console.log('install-git-integrations: hooksPath + i18n merge driver installed')
