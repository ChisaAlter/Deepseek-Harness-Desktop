#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_RUN, killProduct, productExe, SETUP_SHA256, sleep, userData } from './install-qa-lib.mjs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 600_000
const resultPath = path.join(userData, 'dshd-smoke.json')

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
    spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore', windowsHide: true })
    reject(new Error(`Shell P0 timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
  child.once('error', reject)
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
  const qa = payload.result?.shellP0Qa
  report.shellP0Qa = qa
  report.pass = payload.ok === true && qa?.ok === true
  if (!report.pass) {
    throw new Error(`Shell P0 failed: ${(qa?.failed || []).join(', ') || payload.result?.shellP0Qa?.error || 'unknown'}`)
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.logTail = log.split(/\r?\n/).slice(-40)
}

writeFileSync(path.join(outDir, 'install-shell-p0-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ pass: report.pass, error: report.error, failed: report.shellP0Qa?.failed || [] }, null, 2))
if (!report.pass) process.exitCode = 1
