#!/usr/bin/env node
/**
 * Silent overlay-install of a CI Setup.exe onto the live product path.
 * Does not bump package.json / does not create a GitHub Release.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installCandidates, killProduct, resolveInstallDir, sleep, userData } from './install-qa-lib.mjs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const setup = process.argv[2]
if (!setup || !existsSync(setup)) {
  console.error('usage: node silent-install.mjs <Setup.exe>')
  process.exit(1)
}

killProduct()
await sleep(2000)

const install = spawnSync(setup, ['/S'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 900_000,
})
if (install.status !== 0) {
  console.error(JSON.stringify({ ok: false, status: install.status, error: install.error, stderr: install.stderr }, null, 2))
  process.exit(1)
}

const until = Date.now() + 60_000
let installDir = resolveInstallDir()
let productExe = path.join(installDir, 'Deepseek-Harness-Desktop.exe')
while (Date.now() < until && !existsSync(productExe)) {
  await sleep(500)
  installDir = resolveInstallDir()
  productExe = path.join(installDir, 'Deepseek-Harness-Desktop.exe')
}
if (!existsSync(productExe)) {
  console.error(JSON.stringify({
    ok: false,
    error: `missing product exe`,
    searched: installCandidates().map((dir) => path.join(dir, 'Deepseek-Harness-Desktop.exe')),
  }))
  process.exit(1)
}

const nodeExe = path.join(installDir, 'resources', 'node.exe')
const nodeVer = existsSync(nodeExe)
  ? spawnSync(nodeExe, ['-v'], { encoding: 'utf8', windowsHide: true }).stdout.trim()
  : ''
const pinPath = path.join(installDir, 'resources', 'vendor', 'harness-upstream.json')
let pin = null
try {
  pin = JSON.parse(readFileSync(pinPath, 'utf8'))
} catch {
  pin = null
}

const runtimeRoot = path.join(userData, 'runtime')
const report = {
  at: new Date().toISOString(),
  setup,
  installDir,
  productExe,
  nodeExe,
  nodeVer,
  pin,
  runtimeRootExists: existsSync(runtimeRoot),
  ok: Boolean(nodeVer.startsWith('v22')),
}
writeFileSync(path.join(outDir, 'silent-install-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
