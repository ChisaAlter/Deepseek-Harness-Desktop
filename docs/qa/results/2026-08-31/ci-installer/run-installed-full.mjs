#!/usr/bin/env node
/**
 * Installed CI exe + real %APPDATA%: DSH_QA + composer + appendix + remote + shell
 * then a second boot for persist (SESS-003 / NEG-005).
 * Evidence for the production-acceptance table — not qa:packaged / win-unpacked.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CI_RUN,
  killProduct,
  loadConfig,
  productExe,
  saveConfigPatch,
  SETUP_SHA256,
  sleep,
  userData,
} from './install-qa-lib.mjs'

const require = createRequire(import.meta.url)
const { assertReleaseQaResult } = require('../../../../../src/main/release-ui-walk.js')
const { assertComposerOfficialQaResult } = require('../../../../../src/main/composer-official-qa.js')
const { assertAppendixAQaResult } = require('../../../../../src/main/appendix-a-qa.js')
const { assertRemoteGateQaResult, REMOTE_GATE_PARKED_CASES } = require('../../../../../src/main/remote-gate-qa.js')
const { assertPersistQaResult } = require('../../../../../src/main/shell-p0-qa.js')

const outDir = path.dirname(fileURLToPath(import.meta.url))
const timeoutMs = Math.max(1_800_000, Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 0)
const persistTimeoutMs = Math.max(420_000, Number(process.env.DSH_QA_PERSIST_TIMEOUT_MS) || 0)
const resultPath = path.join(userData, 'dshd-smoke.json')
const siblingPath = (process.env.DSH_SMOKE_SIBLING || 'C:\\Ai\\ChisaTerminal').trim()
const prior = loadConfig()
const priorWorkspace = prior.workspace
const priorTheme = prior.theme

function restoreLiveConfig() {
  const patch = {}
  if (priorWorkspace) patch.workspace = priorWorkspace
  if (priorTheme) patch.theme = priorTheme
  else patch.theme = 'deepseek'
  if (Object.keys(patch).length) saveConfigPatch(patch)
}

async function spawnProduct(env, limitMs, label) {
  killProduct()
  await sleep(2000)
  if (existsSync(resultPath)) {
    try { unlinkSync(resultPath) } catch { /* */ }
  }
  const child = spawn(productExe, [], {
    cwd: path.dirname(productExe),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += String(chunk) })
  child.stderr.on('data', (chunk) => { log += String(chunk) })
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      killProduct()
      reject(new Error(`Installed ${label} QA timed out after ${limitMs}ms`))
    }, limitMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return { exit, log }
}

function failFast(error, log, extra = {}) {
  restoreLiveConfig()
  killProduct()
  const failed = {
    at: new Date().toISOString(),
    productExe,
    userData,
    ciRun: CI_RUN,
    setupSha256: SETUP_SHA256,
    siblingPath: siblingPath && existsSync(siblingPath) ? siblingPath : '',
    priorWorkspace,
    pass: false,
    error: error instanceof Error ? error.message : String(error),
    logTail: String(log || '').split(/\r?\n/).slice(-80),
    ...extra,
  }
  writeFileSync(path.join(outDir, 'install-full-report.json'), `${JSON.stringify(failed, null, 2)}\n`)
  writeFileSync(path.join(outDir, 'install-full-log.txt'), String(log || ''))
  console.log(JSON.stringify({ pass: false, error: failed.error }, null, 2))
  process.exit(1)
}

killProduct()
await sleep(2000)
if (siblingPath && existsSync(siblingPath)) {
  saveConfigPatch({ workspace: siblingPath })
  writeFileSync(path.join(siblingPath, 'note.md'), 'composer official qa\nline-two\n')
}

let log = ''
let exit
try {
  const full = await spawnProduct({
    DSH_SMOKE: '1',
    DSH_QA: '1',
    DSH_QA_COMPOSER: '1',
    DSH_QA_APPENDIX: '1',
    DSH_QA_REMOTE: '1',
    DSH_QA_SHELL: '1',
    DSHD_ALLOW_PACKAGED_QA: '1',
    ...(siblingPath && existsSync(siblingPath) ? { DSH_SMOKE_SIBLING: siblingPath } : {}),
  }, timeoutMs, 'full')
  log = full.log
  exit = full.exit
} catch (error) {
  failFast(error, log)
}

const report = {
  at: new Date().toISOString(),
  productExe,
  userData,
  ciRun: CI_RUN,
  setupSha256: SETUP_SHA256,
  siblingPath: siblingPath && existsSync(siblingPath) ? siblingPath : '',
  priorWorkspace,
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
  report.suites.packagedP0 = payload.packagedP0 || result.packagedP0
  if (report.suites.release) assertReleaseQaResult({ qa: report.suites.release })
  if (report.suites.composer) assertComposerOfficialQaResult(report.suites.composer)
  if (report.suites.appendix) assertAppendixAQaResult(report.suites.appendix)
  if (report.suites.remote) {
    assertRemoteGateQaResult(report.suites.remote, {
      required: report.suites.remote.parked ? REMOTE_GATE_PARKED_CASES : undefined,
    })
  }
  const siblingRequired = Boolean(report.siblingPath)
  report.pass = payload.ok === true
    && report.suites.release?.ok === true
    && report.suites.composer?.ok === true
    && report.suites.appendix?.ok === true
    && report.suites.remote?.ok === true
    && report.suites.shell?.ok === true
    && (!siblingRequired || report.suites.packagedP0?.ok === true)
  if (!report.pass) {
    throw new Error(`Installed full QA failed: ${JSON.stringify({
      smoke: payload.ok,
      release: report.suites.release?.failed || report.suites.release?.ok,
      composer: report.suites.composer?.failed || report.suites.composer?.ok,
      appendix: report.suites.appendix?.failed || report.suites.appendix?.ok,
      remote: report.suites.remote?.failed || report.suites.remote?.ok,
      shell: report.suites.shell?.failed || report.suites.shell?.ok,
      packagedP0: report.suites.packagedP0?.ok,
    })}`)
  }

  const persistRun = await spawnProduct({
    DSH_SMOKE: '1',
    DSH_QA_PERSIST: '1',
    DSHD_ALLOW_PACKAGED_QA: '1',
  }, persistTimeoutMs, 'persist')
  log += `\n--- persist ---\n${persistRun.log}`
  report.persistExit = persistRun.exit
  if (!existsSync(resultPath)) {
    throw new Error(`missing ${resultPath} after persist exit ${persistRun.exit.code}`)
  }
  const persistPayload = JSON.parse(readFileSync(resultPath, 'utf8'))
  report.suites.persist = persistPayload.result?.persistQa
  if (report.suites.persist) assertPersistQaResult(report.suites.persist)
  report.pass = persistPayload.ok === true && report.suites.persist?.ok === true
  if (!report.pass) {
    throw new Error(`Installed persist QA failed: ${JSON.stringify({
      smoke: persistPayload.ok,
      persist: report.suites.persist?.failed || report.suites.persist?.ok,
    })}`)
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.logTail = log.split(/\r?\n/).slice(-80)
  report.pass = false
} finally {
  restoreLiveConfig()
  killProduct()
}

writeFileSync(path.join(outDir, 'install-full-report.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(path.join(outDir, 'install-full-log.txt'), log)
console.log(JSON.stringify({
  pass: report.pass,
  error: report.error,
  siblingPath: report.siblingPath,
  exit,
  persistExit: report.persistExit,
  failed: {
    release: report.suites.release?.failed,
    composer: report.suites.composer?.failed,
    appendix: report.suites.appendix?.failed,
    remote: report.suites.remote?.failed,
    shell: report.suites.shell?.failed,
    persist: report.suites.persist?.failed,
    packagedP0: report.suites.packagedP0?.ok,
  },
}, null, 2))
if (!report.pass) process.exitCode = 1
