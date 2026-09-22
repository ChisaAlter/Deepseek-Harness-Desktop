#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 2500 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject).on('timeout', function timeout() {
      this.destroy()
      reject(new Error('timeout'))
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
      msg.error ? job.reject(new Error(msg.error.message)) : job.resolve(msg.result)
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'eval')
    return result.result?.value
  }

  close() { try { this.ws.close() } catch { /* */ } }
}

function prepare(name, configExtra = {}, { seedSession = false } = {}) {
  const userData = path.join(os.tmpdir(), `dshd-probe-${name}-${Date.now()}`)
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
    const sessionDir = path.join(home, 'sessions', 'probe-session')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(path.join(sessionDir, 'session.jsonl'), `${JSON.stringify({ type: 'session/header', id: 'probe' })}\n`)
  }
  return userData
}

function spawnApp(userData, port) {
  const env = { ...process.env }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  delete env.DSH_SMOKE
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

async function attach(port) {
  const until = Date.now() + 40_000
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
    await sleep(300)
  }
  throw new Error(`no launcher on ${port}`)
}

async function shot(cdp, file) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(file, Buffer.from(png.data, 'base64'))
}

async function probeHoldForImport() {
  const userData = prepare('hold', { autoStartDesktop: true })
  const child = spawnApp(userData, 9341)
  try {
    const { cdp, targets } = await attach(9341)
    await sleep(4000)
    const sample = await cdp.eval(`({
      tab: (document.querySelector('.tab.is-active') || {}).dataset.tab,
      status: (document.getElementById('home-status') || {}).textContent,
      import: (document.getElementById('import-source') || {}).textContent,
      urls: ${JSON.stringify((targets || []).map((row) => row.url))},
    })`)
    const later = await httpJson('http://127.0.0.1:9341/json/list').catch(() => [])
    await shot(cdp, path.join(outDir, 'probe-hold-import.png'))
    cdp.close()
    const urls = (later || []).map((row) => row.url)
    return {
      name: 'hold-for-import',
      sample,
      urls,
      startedDesktop: urls.some((url) => /boot\.html|127\.0\.0\.1:\d+/i.test(url)),
    }
  } finally {
    kill(child)
    await sleep(600)
  }
}

async function probeSettingsToggle() {
  const userData = prepare('toggle', { autoStartDesktop: false })
  const child = spawnApp(userData, 9342)
  try {
    const { cdp } = await attach(9342)
    await sleep(2500)
    await cdp.eval(`document.querySelector('[data-tab="settings"]').click()`)
    await sleep(400)
    await cdp.eval(`document.getElementById('opt-quit').click()`)
    await sleep(800)
    const checked = await cdp.eval(`document.getElementById('opt-quit').checked`)
    const config = JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf8'))
    await shot(cdp, path.join(outDir, 'probe-settings-toggle.png'))
    cdp.close()
    return {
      name: 'settings-toggle',
      checked,
      quitAfterStart: config.quitAfterStart === true,
    }
  } finally {
    kill(child)
    await sleep(600)
  }
}

async function probeStartDesktop() {
  const userData = prepare('start', { autoStartDesktop: false, quitAfterStart: false }, { seedSession: true })
  const child = spawnApp(userData, 9343)
  try {
    const { cdp } = await attach(9343)
    const bootWait = Date.now() + 12_000
    while (Date.now() < bootWait) {
      const status = await cdp.eval(`(document.getElementById('home-status') || {}).textContent || ''`)
      if (status && !/正在读取状态/.test(status)) break
      await sleep(400)
    }
    await cdp.eval(`document.getElementById('btn-start').click()`)
    const until = Date.now() + 90_000
    let urls = []
    while (Date.now() < until) {
      urls = (await httpJson('http://127.0.0.1:9343/json/list').catch(() => [])).map((row) => row.url)
      if (urls.some((url) => /boot\.html|127\.0\.0\.1:\d+/i.test(String(url)))) break
      await sleep(1500)
    }
    await shot(cdp, path.join(outDir, 'probe-start-desktop-launcher.png'))
    const bootTarget = (await httpJson('http://127.0.0.1:9343/json/list').catch(() => []))
      .find((row) => /boot\.html/i.test(row.url || ''))
    if (bootTarget?.webSocketDebuggerUrl) {
      const boot = new Cdp(bootTarget.webSocketDebuggerUrl)
      await boot.connect()
      await boot.send('Page.enable')
      await shot(boot, path.join(outDir, 'probe-start-desktop-boot.png'))
      boot.close()
    }
    const hint = await cdp.eval(`(document.getElementById('hint') || {}).textContent || ''`)
    const status = await cdp.eval(`(document.getElementById('home-status') || {}).textContent || ''`)
    cdp.close()
    return {
      name: 'start-desktop',
      urls,
      hint,
      status,
      startedBoot: urls.some((url) => /boot\.html/i.test(String(url))),
      logTail: child.log().split(/\r?\n/).slice(-30),
    }
  } finally {
    kill(child)
    await sleep(800)
  }
}

const report = {
  hold: await probeHoldForImport(),
  toggle: await probeSettingsToggle(),
  start: await probeStartDesktop(),
}
writeFileSync(path.join(outDir, 'extra-probes.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  holdTab: report.hold.sample?.tab,
  holdStartedDesktop: report.hold.startedDesktop,
  toggleChecked: report.toggle.checked,
  toggleSaved: report.toggle.quitAfterStart,
  startedBoot: report.start.startedBoot,
  startStatus: report.start.status,
  startHint: report.start.hint,
}, null, 2))
