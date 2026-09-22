#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_RUN, killProduct, productExe, SETUP_SHA256, sleep } from './install-qa-lib.mjs'
import { writeFileSync } from 'node:fs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const timeoutMs = Number(process.env.DSH_TRAY_QUIT_TIMEOUT_MS) || 420_000

killProduct()
await sleep(2000)

const child = spawn(productExe, [], {
  cwd: path.dirname(productExe),
  env: {
    ...process.env,
    DSH_SMOKE: '1',
    DSH_QA_SHELL: '1',
    DSH_QA_TRAY_QUIT: '1',
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
    reject(new Error(`Tray quit timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
  child.once('error', reject)
})

await sleep(2000)
const stillRunning = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Deepseek-Harness-Desktop.exe', '/NH'], {
  encoding: 'utf8',
  windowsHide: true,
}).stdout.split('\n').filter((line) => /Deepseek-Harness-Desktop\.exe/i.test(line)).length

const report = {
  at: new Date().toISOString(),
  productExe,
  ciRun: CI_RUN,
  setupSha256: SETUP_SHA256,
  exit,
  processCount: stillRunning,
  pass: exit.code === 0 && stillRunning === 0,
  logTail: log.split(/\r?\n/).slice(-30),
}

writeFileSync(path.join(outDir, 'install-tray-quit-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ pass: report.pass, exit, processCount: stillRunning }, null, 2))
if (!report.pass) process.exitCode = 1
