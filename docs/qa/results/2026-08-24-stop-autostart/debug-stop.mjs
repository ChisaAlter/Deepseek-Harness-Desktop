#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const userData = path.join(os.tmpdir(), `dshd-stop-debug-${Date.now()}`)
const workspace = path.join(userData, 'workspace')
const home = path.join(userData, 'dsh-home')
mkdirSync(workspace, { recursive: true })
mkdirSync(home, { recursive: true })
mkdirSync(path.join(home, 'sessions', 'live-probe'), { recursive: true })
writeFileSync(path.join(home, 'sessions', 'live-probe', 'session.jsonl'), `${JSON.stringify({ type: 'session/header', id: 'live-probe' })}\n`)
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
}, null, 2))
writeFileSync(path.join(home, 'settings.yaml'), 'ui-theme:\n  preference: light\n')

const port = 9460

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

  close() {
    try { this.ws.close() } catch { /* */ }
  }
}

const child = spawn(electronBin, [
  `--user-data-dir=${userData}`,
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  '.',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', (chunk) => { log += String(chunk) })
child.stderr.on('data', (chunk) => { log += String(chunk) })

try {
  await sleep(5000)
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
  const launcher = targets.find((row) => /launcher\.html/i.test(row.url || ''))
  if (!launcher?.webSocketDebuggerUrl) {
    console.log('no launcher', targets)
    process.exit(1)
  }
  const cdp = new Cdp(launcher.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Runtime.enable')

  for (let i = 0; i < 20; i += 1) {
    const status = await cdp.eval(`(document.getElementById('home-status') || {}).textContent || ''`)
    if (status && !/正在读取/.test(status)) break
    await sleep(500)
  }

  console.log('before click', await cdp.eval(`({
    home: (document.getElementById('home-status') || {}).textContent,
    btn: (document.getElementById('btn-start') || {}).textContent,
    hint: (document.getElementById('hint') || {}).textContent,
    tab: document.querySelector('.tab.active')?.dataset?.tab,
  })`))

  await cdp.eval(`document.getElementById('btn-start').click()`)

  for (let i = 0; i < 40; i += 1) {
    await sleep(3000)
    const urls = (await httpJson(`http://127.0.0.1:${port}/json/list`)).map((row) => row.url)
    const sample = await cdp.eval(`Promise.all([
      window.shell?.launcherStatus?.(),
      Promise.resolve({
        home: (document.getElementById('home-status') || {}).textContent,
        btn: (document.getElementById('btn-start') || {}).textContent,
        hint: (document.getElementById('hint') || {}).textContent,
        disabled: (document.getElementById('btn-start') || {}).disabled,
      }),
    ]).then(([st, ui]) => ({
      state: st?.desktop?.state,
      port: st?.desktop?.port,
      baseUrl: st?.desktop?.baseUrl,
      ...ui,
    }))`)
    console.log(`t+${i * 3}s`, JSON.stringify(sample))
    console.log('  urls', urls.filter((url) => !/devtools/i.test(url)).join(' | '))
    if (sample.state === 'ready' || /关闭/.test(sample.btn)) break
  }

  console.log('\nlog tail:\n', log.split(/\r?\n/).slice(-40).join('\n'))
  cdp.close()
} finally {
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}
