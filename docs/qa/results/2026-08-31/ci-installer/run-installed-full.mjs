#!/usr/bin/env node
/**
 * Installed CI exe + real %APPDATA%: DSH_QA + composer + appendix + remote + shell.
 * Evidence for the production-acceptance table — not qa:packaged / win-unpacked.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_RUN, killProduct, productExe, SETUP_SHA256, sleep, userData } from './install-qa-lib.mjs'

const require = createRequire(import.meta.url)
const { assertReleaseQaResult } = require('../../../../../src/main/release-ui-walk.js')
const { assertComposerOfficialQaResult } = require('../../../../../src/main/composer-official-qa.js')
const { assertAppendixAQaResult } = require('../../../../../src/main/appendix-a-qa.js')
const { assertRemoteGateQaResult, REMOTE_GATE_PARKED_CASES } = require('../../../../../src/main/remote-gate-qa.js')

const outDir = path.dirname(fileURLToPath(import.meta.url))
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 1_200_000
const resultPath = path.join(userData, 'dshd-smoke.json')

function stopProcessTree() {
  spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore', windowsHide: true })
}

killProduct()
await sleep(2000)
if (existsSync(resultPath)) {
  try { unlinkSync(resultPath) } catch { /* */ }
}

const child = spawn(productExe, [], {
  cwd: path.dirname(productExe),
  env: {
    ...process.env,
    DSH_SMOKE: '1',
    DSH_QA: '1',
    DSH_QA_COMPOSER: '1',
    DSH_QA_APPENDIX: '1',
    DSH_QA_REMOTE: '1',
    DSH_QA_SHELL: '1',
    DSHD_ALLOW_PACKAGED_QA: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let log = ''
child.stdout.on('data', (chunk) => { log += String(chunk) })
child.stderr.on('data', (chunk) => { log += String(chunk) })

const exit = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    stopProcessTree()
    reject(new Error(`Installed full QA timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
  child.once('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
})

const report = {
  at: new Date().toISOString(),
  productExe,
  userData,
  ciRun: CI_RUN,
  setupSha256: SETUP_SHA256,
  exit,
  pass: false,
  suites: {},
}

try {
  if (!existsSync(resultPath)) {
    throw new Error(`missing ${resultPath} after exit ${exit.code}`)
  }
  const payload = JSON.parse(readFileSync(resultPath, 'utf8'))
  report.smokeOk = payload.ok === true
  const result = payload.result || {}
  report.suites.release = result.qa || result.releaseQa
  report.suites.composer = result.composerOfficialQa
  report.suites.appendix = result.appendixQa
  report.suites.remote = result.remoteGateQa
  report.suites.shell = result.shellP0Qa
  if (report.suites.release) assertReleaseQaResult({ qa: report.suites.release })
  if (report.suites.composer) assertComposerOfficialQaResult(report.suites.composer)
  if (report.suites.appendix) assertAppendixAQaResult(report.suites.appendix)
  if (report.suites.remote) {
    assertRemoteGateQaResult(report.suites.remote, {
      required: report.suites.remote.parked ? REMOTE_GATE_PARKED_CASES : undefined,
    })
  }
  report.pass = payload.ok === true
    && report.suites.release?.ok === true
    && report.suites.composer?.ok === true
    && report.suites.appendix?.ok === true
    && report.suites.remote?.ok === true
    && report.suites.shell?.ok === true
  if (!report.pass) {
    throw new Error(`Installed full QA failed: ${JSON.stringify({
      smoke: payload.ok,
      release: report.suites.release?.failed || report.suites.release?.ok,
      composer: report.suites.composer?.failed || report.suites.composer?.ok,
      appendix: report.suites.appendix?.failed || report.suites.appendix?.ok,
      remote: report.suites.remote?.failed || report.suites.remote?.ok,
      shell: report.suites.shell?.failed || report.suites.shell?.ok,
    })}`)
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.logTail = log.split(/\r?\n/).slice(-80)
}

writeFileSync(path.join(outDir, 'install-full-report.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(path.join(outDir, 'install-full-log.txt'), log)
console.log(JSON.stringify({
  pass: report.pass,
  error: report.error,
  exit,
  failed: {
    release: report.suites.release?.failed,
    composer: report.suites.composer?.failed,
    appendix: report.suites.appendix?.failed,
    remote: report.suites.remote?.failed,
    shell: report.suites.shell?.failed,
  },
}, null, 2))
if (!report.pass) process.exitCode = 1
