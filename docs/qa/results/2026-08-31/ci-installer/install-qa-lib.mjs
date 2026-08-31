import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

function resolveInstallDir() {
  if (process.env.DSHD_INSTALL_DIR) return process.env.DSHD_INSTALL_DIR
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Deepseek-Harness-Desktop'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Deepseek-Harness-Desktop'),
  ]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'Deepseek-Harness-Desktop.exe'))) return dir
  }
  return candidates[0]
}

export const installDir = resolveInstallDir()
export const productExe = path.join(installDir, 'Deepseek-Harness-Desktop.exe')
export const userData = path.join(process.env.APPDATA || '', 'Deepseek-Harness-Desktop')
export const CI_RUN = process.env.DSHD_CI_RUN
  || 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33388661602'
export const SETUP_SHA256 = process.env.DSHD_SETUP_SHA256 || ''

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function httpJson(url) {
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

export class Cdp {
  constructor(url, timeoutMs = 20_000) {
    this.ws = new WebSocket(url)
    this.n = 0
    this.pending = new Map()
    this.timeoutMs = timeoutMs
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
      }, this.timeoutMs)
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

  async shot(outDir, name) {
    const png = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'))
  }

  close() {
    try { this.ws.close() } catch { /* */ }
  }
}

export function killProduct() {
  spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore', windowsHide: true })
}

export function loadConfig() {
  const file = path.join(userData, 'config.json')
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function saveConfigPatch(patch) {
  const file = path.join(userData, 'config.json')
  const next = { ...loadConfig(), ...patch }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function spawnInstalled(port, extraArgs = []) {
  return spawn(productExe, [
    ...(port ? [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'] : []),
    ...extraArgs,
  ], {
    cwd: installDir,
    env: process.env,
    stdio: 'ignore',
    detached: false,
  })
}

export async function attachLauncher(port, timeoutMs = 180_000) {
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

export async function attachHarness(port, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => [])
    const harness = targets.find((row) => /127\.0\.0\.1:\d+/i.test(row.url || ''))
    if (harness?.webSocketDebuggerUrl) {
      const cdp = new Cdp(harness.webSocketDebuggerUrl)
      await cdp.connect()
      await cdp.send('Runtime.enable')
      await cdp.send('Page.enable')
      return cdp
    }
    await sleep(400)
  }
  throw new Error('harness attach timeout')
}

export async function waitForHarnessUrl(port, timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const urls = await listUrls(port)
    const harness = urls.find((url) => /127\.0\.0\.1:\d+/i.test(url))
    if (harness) return { ok: true, urls, harness }
    await sleep(1000)
  }
  return { ok: false, urls: await listUrls(port) }
}

export async function listUrls(port) {
  return (await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []))
    .map((row) => row.url)
    .filter((url) => !/devtools/i.test(url))
}

export async function uiSample(cdp) {
  return cdp.eval(`Promise.resolve(window.shell?.launcherStatus?.()).then((status) => ({
    btnStart: (document.getElementById('btn-start')||{}).textContent||'',
    homeStatus: (document.getElementById('home-status')||{}).textContent||'',
    hint: (document.getElementById('hint')||{}).textContent||'',
    state: status?.desktop?.state || '',
    baseUrl: status?.desktop?.baseUrl || '',
    activeTab: (document.querySelector('.tab.is-active')||{}).dataset?.tab || '',
  }))`)
}

export async function waitFor(predicate, timeoutMs, intervalMs = 1000) {
  const until = Date.now() + timeoutMs
  let last = null
  while (Date.now() < until) {
    last = await predicate()
    if (last.ok) return last
    await sleep(intervalMs)
  }
  return last || { ok: false, reason: 'timeout' }
}

export const LAUNCHER_SAMPLE_JS = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  return {
    shell: document.documentElement.getAttribute('data-shell-theme'),
    boot: document.documentElement.hasAttribute('data-boot-theme'),
    dark: document.documentElement.hasAttribute('data-ds-dark-theme'),
    tokenBg: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
    htmlBg: cs.backgroundColor,
    bodyBg: body.backgroundColor,
  };
})()`

export const OFFICIAL = {
  light: { bg: 'rgb(255, 255, 255)' },
  dark: { bg: 'rgb(21, 21, 23)' },
}

export function sameRgb(actual, expected) {
  const norm = (value) => String(value || '').replace(/\s+/g, '').toLowerCase()
  return norm(actual) === norm(expected)
}

export function assertOfficialLauncherBg(sample, scheme) {
  const want = OFFICIAL[scheme].bg
  const fails = []
  if (sample.boot) fails.push('data-boot-theme present')
  if (sample.shell !== 'official') fails.push(`shell=${sample.shell}`)
  if (scheme === 'dark' && !sample.dark) fails.push('missing data-ds-dark-theme')
  if (scheme === 'light' && sample.dark) fails.push('data-ds-dark-theme on light')
  if (!sameRgb(sample.tokenBg, want) && !sameRgb(sample.htmlBg, want) && !sameRgb(sample.bodyBg, want)) {
    fails.push(`bg ${sample.tokenBg || sample.bodyBg} != ${want}`)
  }
  const blob = JSON.stringify(sample).toLowerCase()
  if (blob.includes('243, 250, 247') || blob.includes('#f3faf7') || blob.includes('7, 20, 17')) {
    fails.push('celadon wallpaper seed leaked')
  }
  return fails
}
