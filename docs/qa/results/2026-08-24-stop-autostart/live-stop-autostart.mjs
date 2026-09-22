#!/usr/bin/env node
/**
 * Live probes: autoStartDesktop cold start, stop-desktop, post-stop targets.
 * Isolated temp userData; does not touch %APPDATA% profile.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 4000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject).on('timeout', function onTimeout() {
      this.destroy()
      reject(new Error(`timeout ${url}`))
    })
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
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, 25_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'eval failed')
    }
    return result.result?.value
  }

  close() {
    try { this.ws.close() } catch { /* */ }
  }
}

function prepare(name, configExtra = {}, { seedSession = false } = {}) {
  const userData = path.join(os.tmpdir(), `dshd-live-${name}-${Date.now()}`)
  const workspace = path.join(userData, 'workspace')
  const home = path.join(userData, 'dsh-home')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port: 0,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: false,
    quitAfterStart: false,
    autoStartDesktop: false,
    askOnUpdate: false,
    locale: 'zh',
    theme: 'celadon',
    ...configExtra,
  }, null, 2))
  writeFileSync(path.join(home, 'settings.yaml'), [
    'ui-theme:',
    '  preference: light',
    '  activeLightThemeId: celadon',
    '  activeDarkThemeId: celadon',
    '',
  ].join('\n'))
  if (seedSession) {
    const sessionDir = path.join(home, 'sessions', 'live-probe')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(path.join(sessionDir, 'session.jsonl'), `${JSON.stringify({ type: 'session/header', id: 'live-probe' })}\n`)
  }
  return userData
}

function spawnApp(userData, port) {
  const env = { ...process.env }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  delete env.DSH_SMOKE
  delete env.DSH_QA
  const child = spawn(electronBin, [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '.',
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
  let log = ''
  child.stdout.on('data', (chunk) => { log += String(chunk) })
  child.stderr.on('data', (chunk) => { log += String(chunk) })
  child.log = () => log
  return child
}

function kill(child) {
  if (!child || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}

async function listUrls(port) {
  return (await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []))
    .map((row) => row.url)
}

function hasHarness(urls) {
  return urls.some((url) => /boot\.html|127\.0\.0\.1:\d+/i.test(String(url)))
}

async function attachLauncher(port, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
      const launcher = (targets || []).find((row) => /launcher\.html/i.test(row.url || ''))
      if (launcher?.webSocketDebuggerUrl) {
        const cdp = new Cdp(launcher.webSocketDebuggerUrl)
        await cdp.connect()
        await cdp.send('Runtime.enable')
        await cdp.send('Page.enable')
        return { cdp, targets }
      }
    } catch { /* retry */ }
    await sleep(350)
  }
  throw new Error(`launcher not ready on port ${port}`)
}

async function waitHomeStatus(cdp, predicate, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const status = await cdp.eval(`(document.getElementById('home-status') || {}).textContent || ''`)
    if (predicate(status)) return status
    await sleep(500)
  }
  throw new Error('home-status timeout')
}

async function waitDesktopReady(cdp, port, timeoutMs = 120_000, { requireReady = false } = {}) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const sample = await cdp.eval(`Promise.all([
      window.shell?.launcherStatus?.(),
      Promise.resolve({
        homeStatus: (document.getElementById('home-status') || {}).textContent || '',
        btnStart: (document.getElementById('btn-start') || {}).textContent || '',
      }),
    ]).then(([status, ui]) => ({
      state: status?.desktop?.state || '',
      homeStatus: ui.homeStatus,
      btnStart: ui.btnStart,
    }))`)
    const urls = await listUrls(port)
    const running = sample.state === 'ready'
      || (!requireReady && sample.state === 'starting')
      || /关闭桌面端/.test(sample.btnStart)
      || /已就绪|启动中/.test(sample.homeStatus)
    if (running && (!requireReady || sample.state === 'ready' || /已就绪/.test(sample.homeStatus))) {
      return sample
    }
    if (sample.state === 'error') {
      throw new Error(`desktop error before ready: ${sample.homeStatus}`)
    }
    if (hasHarness(urls) && sample.state === 'starting') {
      await sleep(1500)
      continue
    }
    await sleep(1500)
  }
  throw new Error('desktop-ready timeout')
}

async function shot(cdp, name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'))
}

async function probeLauncherFirst() {
  const userData = prepare('launcher-first', { autoStartDesktop: false }, { seedSession: true })
  const port = 9451
  const child = spawnApp(userData, port)
  try {
    const { cdp } = await attachLauncher(port)
    await sleep(3500)
    const urls = await listUrls(port)
    const sample = await cdp.eval(`({
      homeStatus: (document.getElementById('home-status') || {}).textContent || '',
      btnStart: (document.getElementById('btn-start') || {}).textContent || '',
      visible: document.visibilityState,
    })`)
    await shot(cdp, '01-launcher-first.png')
    cdp.close()
    return {
      name: 'launcher-first',
      pass: !hasHarness(urls) && /启动桌面端/.test(sample.btnStart) && /未运行/.test(sample.homeStatus),
      sample,
      urls,
    }
  } finally {
    kill(child)
    await sleep(700)
  }
}

async function probeDirectStart() {
  const userData = prepare('direct-start', { autoStartDesktop: true, quitAfterStart: false }, { seedSession: true })
  const port = 9452
  const child = spawnApp(userData, port)
  try {
    const until = Date.now() + 120_000
    let urls = []
    let launcherCdp = null
    while (Date.now() < until) {
      urls = await listUrls(port)
      if (hasHarness(urls)) break
      await sleep(1200)
    }
    try {
      const attached = await attachLauncher(port, 5000)
      launcherCdp = attached.cdp
    } catch {
      launcherCdp = null
    }
    let sample = null
    if (launcherCdp) {
      sample = await launcherCdp.eval(`({
        homeStatus: (document.getElementById('home-status') || {}).textContent || '',
        btnStart: (document.getElementById('btn-start') || {}).textContent || '',
      })`)
      await shot(launcherCdp, '02-direct-start-launcher.png')
    }
    const bootTarget = (await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []))
      .find((row) => /boot\.html|127\.0\.0\.1:\d+/i.test(row.url || ''))
    if (bootTarget?.webSocketDebuggerUrl) {
      const boot = new Cdp(bootTarget.webSocketDebuggerUrl)
      await boot.connect()
      await boot.send('Page.enable')
      await shot(boot, '02-direct-start-desktop.png')
      boot.close()
    }
    launcherCdp?.close()
    return {
      name: 'direct-start',
      pass: hasHarness(urls),
      startedHarness: hasHarness(urls),
      sample,
      urls,
      logTail: child.log().split(/\r?\n/).slice(-20),
    }
  } finally {
    kill(child)
    await sleep(800)
  }
}

async function probeStopDesktop() {
  // Use auto-start path (reliable in isolated userData); stop is launcher-only either way.
  const userData = prepare('stop-desktop', { autoStartDesktop: true, quitAfterStart: false }, { seedSession: true })
  const port = 9453
  const child = spawnApp(userData, port)
  const fails = []
  let after = null
  let urlsAfter = []
  try {
    const { cdp } = await attachLauncher(port)
    await waitHomeStatus(cdp, (s) => s && !/正在读取状态/.test(s), 30_000)
    const beforeStop = await waitDesktopReady(cdp, port, 180_000, { requireReady: true })
    const btnBefore = beforeStop.btnStart
    if (!/关闭桌面端/.test(btnBefore) && beforeStop.state !== 'ready' && beforeStop.state !== 'starting') {
      fails.push(`desktop not ready before stop: ${JSON.stringify(beforeStop)}`)
    } else {
      await shot(cdp, '03-before-stop.png')
      await cdp.eval(`document.getElementById('btn-start').click()`)
      const stopUntil = Date.now() + 60_000
      while (Date.now() < stopUntil) {
        after = await cdp.eval(`Promise.all([
          window.shell?.launcherStatus?.(),
          Promise.resolve({
            homeStatus: (document.getElementById('home-status') || {}).textContent || '',
            btnStart: (document.getElementById('btn-start') || {}).textContent || '',
            hint: (document.getElementById('hint') || {}).textContent || '',
          }),
        ]).then(([status, ui]) => ({
          state: status?.desktop?.state || '',
          ...ui,
        }))`)
        const idle = after.state === 'idle' || after.state === 'stopped' || /未运行/.test(after.homeStatus)
        if (idle && /启动桌面端/.test(after.btnStart) && !/正在/.test(after.hint)) break
        await sleep(800)
      }
      urlsAfter = await listUrls(port)
      await sleep(1200)
      urlsAfter = await listUrls(port)
      await shot(cdp, '04-after-stop.png')
      if (/boot\.html/i.test(urlsAfter.join(' '))) fails.push('boot.html still in CDP targets after stop')
      if (!after || !/未运行/.test(after.homeStatus)) fails.push(`status after stop: ${after?.homeStatus}`)
      if (!after || !/启动桌面端/.test(after.btnStart)) fails.push(`button after stop: ${after?.btnStart}`)
    }

    cdp.close()
    return {
      name: 'stop-desktop',
      pass: fails.length === 0,
      fails,
      beforeStop,
      after,
      urlsAfter,
      logTail: child.log().split(/\r?\n/).slice(-25),
    }
  } finally {
    kill(child)
    await sleep(800)
  }
}

async function probeConfigSync() {
  const userData = prepare('config-sync', { autoStartDesktop: true })
  const port = 9454
  const child = spawnApp(userData, port)
  try {
    const { cdp } = await attachLauncher(port)
    await sleep(2500)
    await cdp.eval(`document.querySelector('[data-tab="settings"]').click()`)
    await sleep(400)
    const before = await cdp.eval(`document.getElementById('opt-auto').checked`)
    await cdp.eval(`document.getElementById('opt-auto').click()`)
    await sleep(900)
    const afterChecked = await cdp.eval(`document.getElementById('opt-auto').checked`)
    const config = JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf8'))
    await shot(cdp, '05-config-sync.png')
    cdp.close()
    return {
      name: 'config-sync',
      pass: before === true && afterChecked === false && config.autoStartDesktop === false,
      before,
      afterChecked,
      saved: config.autoStartDesktop,
    }
  } finally {
    kill(child)
    await sleep(600)
  }
}

const report = {
  at: new Date().toISOString(),
  probes: [],
  pass: true,
}

for (const fn of [probeLauncherFirst, probeDirectStart, probeStopDesktop, probeConfigSync]) {
  try {
    const result = await fn()
    report.probes.push(result)
    if (!result.pass) report.pass = false
  } catch (error) {
    report.probes.push({ name: fn.name, pass: false, error: error.message || String(error) })
    report.pass = false
  }
}

writeFileSync(path.join(outDir, 'live-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  pass: report.pass,
  probes: report.probes.map((p) => ({ name: p.name, pass: p.pass, fails: p.fails, error: p.error })),
}, null, 2))
if (!report.pass) process.exitCode = 1
