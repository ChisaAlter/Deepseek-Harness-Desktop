#!/usr/bin/env node
/**
 * P0 install probes on CI artifact Setup (real %APPDATA%, installed exe).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const installDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Deepseek-Harness-Desktop')
const productExe = path.join(installDir, 'Deepseek-Harness-Desktop.exe')
const userData = path.join(process.env.APPDATA || '', 'Deepseek-Harness-Desktop')
const port = Number(process.env.DSHD_QA_PORT || 9472)
const CDP_TIMEOUT_MS = 20_000

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
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, CDP_TIMEOUT_MS)
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

function killProduct() {
  spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore', windowsHide: true })
}

function loadConfig() {
  const file = path.join(userData, 'config.json')
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8'))
}

function saveConfigPatch(patch) {
  const file = path.join(userData, 'config.json')
  const next = { ...loadConfig(), ...patch }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

async function attachLauncher(timeoutMs = 90_000) {
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

async function listUrls() {
  return (await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []))
    .map((row) => row.url)
    .filter((url) => !/devtools/i.test(url))
}

async function uiSample(cdp) {
  return cdp.eval(`Promise.resolve(window.shell?.launcherStatus?.()).then((status) => ({
    btnStart: (document.getElementById('btn-start')||{}).textContent||'',
    homeStatus: (document.getElementById('home-status')||{}).textContent||'',
    hint: (document.getElementById('hint')||{}).textContent||'',
    state: status?.desktop?.state || '',
    baseUrl: status?.desktop?.baseUrl || '',
  }))`)
}

async function waitFor(predicate, timeoutMs, intervalMs = 1000) {
  const until = Date.now() + timeoutMs
  let last = null
  while (Date.now() < until) {
    last = await predicate()
    if (last.ok) return last
    await sleep(intervalMs)
  }
  return last || { ok: false, reason: 'timeout' }
}

const report = {
  at: new Date().toISOString(),
  productExe,
  userData,
  ciRun: 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/32727819174',
  setupSha256: '602DC9C01AADC87AE0928BD49B2DCCB0CB9E75218BFD73E9872B6BD0FEE12B27',
  setupBytes: 506442522,
  bundledNode: spawnSync(path.join(installDir, 'resources', 'node.exe'), ['-v'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim(),
  checks: [],
  pass: false,
}

if (!existsSync(productExe)) {
  console.error(`missing installed exe: ${productExe}`)
  process.exit(1)
}

const priorConfig = loadConfig()
killProduct()
await sleep(2000)
saveConfigPatch({ autoStartDesktop: false, quitAfterStart: false, askOnUpdate: false })

try {
  spawn(productExe, [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'], {
    cwd: installDir,
    stdio: 'ignore',
    detached: false,
  })

  const cdp = await attachLauncher()
  const urlsCold = await listUrls()
  report.checks.push({
    id: 'TC-LAUNCH-001',
    pass: urlsCold.some((url) => /launcher\.html/i.test(url))
      && !urlsCold.some((url) => /127\.0\.0\.1:\d+/i.test(url)),
    urls: urlsCold,
  })
  await cdp.shot('01-launcher-cold.png')

  await cdp.eval(`document.getElementById('btn-start')?.click()`)
  const ready = await waitFor(async () => {
    const sample = await uiSample(cdp)
    const urls = await listUrls()
    const ok = (sample.state === 'ready' || /关闭桌面端/.test(sample.btnStart))
      && urls.some((url) => /127\.0\.0\.1:\d+/i.test(url))
    return { ok, sample, urls }
  }, 240_000, 2000)
  report.checks.push({ id: 'TC-LAUNCH-002-manual-start', pass: ready.ok, ...ready })
  await cdp.shot('02-desktop-ready.png')

  await cdp.eval(`document.querySelector('[data-tab="versions"]')?.click()`)
  await sleep(800)
  const versionCard = await cdp.eval(`({
    installed: (document.getElementById('installed-card')||{}).textContent||'',
    about: (document.getElementById('about-version')||{}).textContent||'',
  })`)
  report.checks.push({
    id: 'TC-INST-001-version',
    pass: /0\.2\.7/.test(`${versionCard.installed}${versionCard.about}`),
    versionCard,
  })
  await cdp.shot('03-versions-tab.png')

  await cdp.eval(`document.getElementById('btn-start')?.click()`)
  const stopped = await waitFor(async () => {
    const sample = await uiSample(cdp)
    const urls = await listUrls()
    const ok = (/启动桌面端/.test(sample.btnStart))
      && (sample.state === 'idle' || sample.state === 'stopped' || /未运行/.test(sample.homeStatus))
      && !urls.some((url) => /127\.0\.0\.1:\d+/i.test(url))
    return { ok, sample, urls }
  }, 120_000, 1500)
  report.checks.push({ id: 'stop-desktop', pass: stopped.ok, ...stopped })
  await cdp.shot('04-after-stop.png')

  const remoteProbe = await cdp.eval(`({
    hasRemote: typeof window.shell?.getRemote === 'function',
    dshbotTab: !!document.querySelector('[data-tab="dshbot"]'),
  })`)
  report.checks.push({
    id: 'parked-remote-dshbot',
    pass: !remoteProbe.hasRemote && !remoteProbe.dshbotTab,
    remoteProbe,
  })

  report.checks.push({
    id: 'TC-INST-013-bundled-node',
    pass: report.bundledNode === 'v22.23.2',
    bundledNode: report.bundledNode,
  })

  cdp.close()
  report.pass = report.checks.every((row) => row.pass)
} catch (error) {
  report.error = error.message || String(error)
  report.pass = false
} finally {
  killProduct()
  saveConfigPatch({
    autoStartDesktop: priorConfig.autoStartDesktop,
    quitAfterStart: priorConfig.quitAfterStart,
    askOnUpdate: priorConfig.askOnUpdate,
  })
}

writeFileSync(path.join(outDir, 'install-p0-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  pass: report.pass,
  checks: report.checks.map((row) => ({ id: row.id, pass: row.pass })),
  error: report.error,
}, null, 2))
if (!report.pass) process.exitCode = 1
