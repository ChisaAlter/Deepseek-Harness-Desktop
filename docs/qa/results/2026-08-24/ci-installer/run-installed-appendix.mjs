#!/usr/bin/env node
/**
 * Appendix A on installed CI exe + real %APPDATA% (production evidence path).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_RUN, killProduct, productExe, SETUP_SHA256, sleep, userData } from './install-qa-lib.mjs'

const require = createRequire(import.meta.url)
const { assertAppendixAQaResult } = require('../../../../../src/main/appendix-a-qa.js')

const outDir = path.dirname(fileURLToPath(import.meta.url))
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 900_000
const resultPath = path.join(userData, 'dshd-smoke.json')

function stopProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return
  spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore', windowsHide: true })
}

killProduct()
await sleep(2000)

if (existsSync(resultPath)) {
  try { require('node:fs').unlinkSync(resultPath) } catch { /* */ }
}

const child = spawn(productExe, [], {
  cwd: path.dirname(productExe),
  env: {
    ...process.env,
    DSH_SMOKE: '1',
    DSH_QA_APPENDIX: '1',
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
    stopProcessTree(child)
    reject(new Error(`Appendix timed out after ${timeoutMs}ms`))
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
}

try {
  if (!existsSync(resultPath)) {
    throw new Error(`missing ${resultPath} after exit ${exit.code}`)
  }
  const payload = JSON.parse(readFileSync(resultPath, 'utf8'))
  const qa = payload.result?.appendixQa || payload.appendixQa
  report.smokeOk = payload.ok === true
  report.appendixQa = qa
  assertAppendixAQaResult(qa)
  report.pass = payload.ok === true && qa?.ok === true
  console.log('Appendix steps:')
  for (const step of qa?.steps || []) {
    console.log(`  ${step.ok ? 'PASS' : 'FAIL'}  ${step.name}${step.detail ? ` — ${step.detail}` : ''}`)
  }
} catch (error) {
  report.error = error.message || String(error)
  report.logTail = log.split(/\r?\n/).slice(-40)
  process.exitCode = 1
}

writeFileSync(path.join(outDir, 'install-appendix-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ pass: report.pass, smokeOk: report.smokeOk, error: report.error }, null, 2))
killProduct()
