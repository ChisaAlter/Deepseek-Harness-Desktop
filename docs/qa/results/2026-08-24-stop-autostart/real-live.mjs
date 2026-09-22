#!/usr/bin/env node
/**
 * Real userData live probe: auto-start → stop desktop → verify idle.
 * Uses %APPDATA%/Deepseek-Harness-Desktop; kills other Electron first.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const userData = path.join(process.env.APPDATA || '', 'Deepseek-Harness-Desktop')
const port = Number(process.env.DSHD_QA_PORT || 9470)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.n = 0
    this.pending = new Map()
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id == null) return
      const job = this.pending.get(msg.id)
      if (!job) return
      this.pending.delete(msg.id)
      msg.error ? job.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : job.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.n
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails))
    }
    return result.result?.value
  }

  async shot(name) {
    const png = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'))
  }

  close() {
    try { this.ws.close() } catch { /* */ }
  }
}

function killElectron() {
  spawnSync('taskkill', ['/IM', 'electron.exe', '/F'], { stdio: 'ignore', windowsHide: true })
}

function loadConfig() {
  const configPath = path.join(userData, 'config.json')
  if (!existsSync(configPath)) return {}
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

function saveConfigPatch(patch) {
  const configPath = path.join(userData, 'config.json')
  const next = { ...loadConfig(), ...patch }
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

async function attachLauncher(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => [])
    const launcher = targets.find((row) => /launcher\.html/i.test(row.url || ''))
    if (launcher?.webSocketDebuggerUrl) {
      const cdp = new Cdp(launcher.webSocketDebuggerUrl)
      await cdp.connect()
      await cdp.send('Runtime.enable')
      await cdp.send('Page.enable')
      return cdp
    }
    await sleep(400)
  }
  throw new Error('launcher attach timeout')
}

async function launcherSample(cdp) {
  return cdp.eval(`Promise.all([
    window.shell?.launcherStatus?.(),
    Promise.resolve({
      homeStatus: (document.getElementById('home-status') || {}).textContent || '',
      btnStart: (document.getElementById('btn-start') || {}).textContent || '',
      hint: (document.getElementById('hint') || {}).textContent || '',
    }),
  ]).then(([status, ui]) => ({
    state: status?.desktop?.state || '',
    baseUrl: status?.desktop?.baseUrl || '',
    ...ui,
  }))`)
}

async function listUrls() {
  return (await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []))
    .map((row) => row.url)
    .filter((url) => !/devtools/i.test(url))
}

const report = {
  at: new Date().toISOString(),
  userData,
  pass: false,
  steps: [],
}

killElectron()
await sleep(1500)

const priorConfig = loadConfig()
saveConfigPatch({ autoStartDesktop: true, quitAfterStart: false, askOnUpdate: false })

const child = spawn(electronBin, [
  `--user-data-dir=${userData}`,
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  '.',
], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', (chunk) => { log += String(chunk) })
child.stderr.on('data', (chunk) => { log += String(chunk) })

try {
  const cdp = await attachLauncher()
  report.steps.push({ step: 'attached-launcher' })

  const readyUntil = Date.now() + 180_000
  let before = null
  while (Date.now() < readyUntil) {
    before = await launcherSample(cdp)
    if (before.state === 'ready' || /已就绪/.test(before.homeStatus) || /关闭桌面端/.test(before.btnStart)) {
      break
    }
    if (before.state === 'error') {
      throw new Error(`desktop error: ${before.homeStatus} hint=${before.hint}`)
    }
    await sleep(2000)
  }
  report.steps.push({ step: 'before-stop', sample: before, urls: await listUrls() })
  await cdp.shot('real-01-before-stop.png')

  if (before.state !== 'ready' && !/关闭桌面端/.test(before.btnStart)) {
    throw new Error(`never reached ready: ${JSON.stringify(before)}`)
  }

  await cdp.eval(`document.getElementById('btn-start').click()`)

  const stopUntil = Date.now() + 90_000
  let after = null
  while (Date.now() < stopUntil) {
    after = await launcherSample(cdp)
    const idle = after.state === 'idle' || after.state === 'stopped' || /未运行/.test(after.homeStatus)
    if (idle && /启动桌面端/.test(after.btnStart) && !/正在/.test(after.hint)) break
    await sleep(1000)
  }
  await sleep(1500)
  const urlsAfter = await listUrls()
  await cdp.shot('real-02-after-stop.png')
  report.steps.push({ step: 'after-stop', sample: after, urls: urlsAfter })

  const fails = []
  if (!after || (after.state !== 'idle' && after.state !== 'stopped' && !/未运行/.test(after.homeStatus))) {
    fails.push(`idle state missing: ${JSON.stringify(after)}`)
  }
  if (!after || !/启动桌面端/.test(after.btnStart)) {
    fails.push(`start button not restored: ${after?.btnStart}`)
  }
  if (/127\.0\.0\.1:\d+/i.test(urlsAfter.join(' '))) {
    fails.push(`harness URL still open: ${urlsAfter.join(' | ')}`)
  }

  report.pass = fails.length === 0
  report.fails = fails
  cdp.close()
} catch (error) {
  report.error = error.message || String(error)
  report.pass = false
} finally {
  killElectron()
  saveConfigPatch({
    autoStartDesktop: priorConfig.autoStartDesktop,
    quitAfterStart: priorConfig.quitAfterStart,
    askOnUpdate: priorConfig.askOnUpdate,
  })
  report.logTail = log.split(/\r?\n/).slice(-30)
}

writeFileSync(path.join(outDir, 'real-live-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ pass: report.pass, fails: report.fails, error: report.error }, null, 2))
if (!report.pass) process.exitCode = 1
