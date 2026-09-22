#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const officialHome = path.join(os.homedir(), '.dsh')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, acc)
    else if (entry.isFile()) acc.push(full)
  }
  return acc
}

function fingerprint(dir) {
  const files = walkFiles(dir).sort()
  const hash = createHash('sha256')
  let bytes = 0
  const jsonl = []
  for (const file of files) {
    const st = statSync(file)
    bytes += st.size
    const rel = path.relative(dir, file).split(path.sep).join('/')
    hash.update(`${rel}:${st.size}:${Math.floor(st.mtimeMs)}\n`)
    if (/session\.jsonl(\.zstd)?$/i.test(path.basename(file))) jsonl.push(rel)
  }
  return { files: files.length, bytes, jsonl: jsonl.length, digest: hash.digest('hex') }
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 2500 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject).on('timeout', function onTimeout() {
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
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, 180_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
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

function prepareUserData() {
  const userData = path.join(os.tmpdir(), `dshd-import-live-${Date.now()}`)
  const workspace = path.join(userData, 'workspace')
  const home = path.join(userData, 'dsh-home')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port: 3199,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: false,
    quitAfterStart: false,
    autoStartDesktop: false,
    askOnUpdate: false,
    locale: 'zh',
    theme: 'deepseek',
  }, null, 2))
  return { userData, home }
}

async function attach(port) {
  const until = Date.now() + 45_000
  while (Date.now() < until) {
    try {
      const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
      const launcher = (targets || []).find((row) => /launcher\.html/i.test(row.url || ''))
      if (launcher?.webSocketDebuggerUrl) {
        const cdp = new Cdp(launcher.webSocketDebuggerUrl)
        await cdp.connect()
        await cdp.send('Runtime.enable')
        await cdp.send('Page.enable')
        return cdp
      }
    } catch { /* retry */ }
    await sleep(300)
  }
  throw new Error('launcher CDP not ready')
}

async function screenshot(cdp, file) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(file, Buffer.from(png.data, 'base64'))
}

const before = fingerprint(officialHome)
const dirs = prepareUserData()
const env = { ...process.env }
delete env.DSH_HOME
delete env.DSHD_HOME
delete env.DSH_SMOKE
const child = spawn(electronBin, [
  `--user-data-dir=${dirs.userData}`,
  '--remote-debugging-port=9355',
  '--remote-allow-origins=*',
  '.',
], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
let log = ''
child.stdout.on('data', (chunk) => { log += String(chunk) })
child.stderr.on('data', (chunk) => { log += String(chunk) })

const report = {
  officialHome,
  destHome: dirs.home,
  userData: dirs.userData,
  before,
}

try {
  const cdp = await attach(9355)
  const readyUntil = Date.now() + 15_000
  while (Date.now() < readyUntil) {
    const ready = await cdp.eval(`typeof pageShell === 'function'`).catch(() => false)
    if (ready) break
    await sleep(300)
  }
  await cdp.eval(`document.querySelector('[data-tab="import"]').click()`)
  await sleep(2000)
  await screenshot(cdp, path.join(outDir, 'import-before.png'))
  const beforeUi = await cdp.eval(`({
    source: (document.getElementById('import-source') || {}).textContent,
    result: (document.getElementById('import-result') || {}).textContent,
  })`)
  report.beforeUi = beforeUi

  await cdp.eval(`document.getElementById('btn-import').click()`)
  const until = Date.now() + 300_000
  let afterUi = beforeUi
  while (Date.now() < until) {
    afterUi = await cdp.eval(`({
      source: (document.getElementById('import-source') || {}).textContent,
      result: (document.getElementById('import-result') || {}).textContent,
    })`)
    if (afterUi.result && afterUi.result !== beforeUi.result && /"sessions"|copied|failed|ok/.test(afterUi.result)) {
      break
    }
    await sleep(1000)
  }
  await screenshot(cdp, path.join(outDir, 'import-after.png'))
  cdp.close()
  report.afterUi = afterUi
} finally {
  if (child.exitCode === null) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  }
  await sleep(800)
}

const after = fingerprint(officialHome)
const dest = fingerprint(dirs.home)
let parsed = null
try { parsed = JSON.parse(report.afterUi?.result || 'null') } catch { parsed = null }
const copied = Array.isArray(parsed?.sessions?.sessions)
  ? parsed.sessions.sessions.filter((row) => row.status === 'copied').length
  : null
const failed = Array.isArray(parsed?.sessions?.sessions)
  ? parsed.sessions.sessions.filter((row) => row.status === 'failed').length
  : null

report.afterOfficial = after
report.dest = dest
report.parsed = parsed
report.copied = copied
report.failed = failed
report.officialUnchanged = before.digest === after.digest
  && before.files === after.files
  && before.bytes === after.bytes
report.ok = Boolean(parsed?.sessions?.ok) && report.officialUnchanged && dest.jsonl > 0
report.logTail = log.split(/\r?\n/).slice(-20)

writeFileSync(path.join(outDir, 'import-live.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  ok: report.ok,
  copied,
  failed,
  destJsonl: dest.jsonl,
  destFiles: dest.files,
  destBytes: dest.bytes,
  officialUnchanged: report.officialUnchanged,
  beforeUi: report.beforeUi,
  afterPreview: String(report.afterUi?.result || '').slice(0, 500),
}, null, 2))
if (!report.ok) process.exitCode = 1
