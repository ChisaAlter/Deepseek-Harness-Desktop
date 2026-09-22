#!/usr/bin/env node
/**
 * Isolated live drive of the desktop launcher (light + dark).
 * Does not touch %APPDATA%\Deepseek-Harness-Desktop.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const TABS = ['home', 'import', 'versions', 'plugins', 'settings']
const OFFICIAL = {
  light: {
    bg: 'rgb(255, 255, 255)',
    sidebar: 'rgb(249, 250, 251)',
    primary: 'rgb(15, 17, 21)',
  },
  dark: {
    bg: 'rgb(21, 21, 23)',
    sidebar: 'rgb(27, 27, 28)',
    primary: 'rgb(249, 250, 251)',
  },
}
const CELADON = {
  lightBg: '#f3faf7',
  darkBg: '#071411',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(new Error(`JSON parse failed for ${url}: ${body.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`timeout ${url}`))
    })
  })
}

class Cdp {
  constructor(url) {
    this.url = url
    this.ws = null
    this.seq = 0
    this.pending = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.url)
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
      if (msg.error) job.reject(new Error(`${msg.error.message || JSON.stringify(msg.error)}`))
      else job.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, 20_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text
        || result.exceptionDetails.exception?.description
        || 'eval failed'
      throw new Error(text)
    }
    return result.result?.value
  }

  close() {
    try { this.ws?.close() } catch { /* already gone */ }
  }
}

function prepareUserData(scheme) {
  const userData = path.join(os.tmpdir(), `dshd-launcher-live-${scheme}-${Date.now()}`)
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
  }, null, 2))
  writeFileSync(path.join(home, 'settings.yaml'), [
    'ui-theme:',
    `  preference: ${scheme}`,
    '  activeLightThemeId: celadon',
    '  activeDarkThemeId: celadon',
    '',
  ].join('\n'))
  return { userData, home }
}

function spawnElectron(userData, debugPort) {
  const env = { ...process.env }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  delete env.DSH_SMOKE
  delete env.DSH_QA
  env.ELECTRON_ENABLE_LOGGING = '1'
  const child = spawn(electronBin, [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*',
    '.',
  ], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
  let log = ''
  const onChunk = (chunk) => { log += String(chunk) }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)
  child.log = () => log
  return child
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function waitForLauncher(debugPort, timeoutMs = 45_000) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
      const launcher = (Array.isArray(targets) ? targets : []).find((row) => (
        /launcher\.html/i.test(String(row.url || '')) && row.webSocketDebuggerUrl
      ))
      if (launcher) return { launcher, targets }
    } catch (error) {
      lastError = error.message || String(error)
    }
    await sleep(400)
  }
  throw new Error(`launcher CDP not ready: ${lastError}`)
}

const SAMPLE_JS = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const rail = document.querySelector('.rail');
  const primary = document.querySelector('.primary');
  const active = document.querySelector('.tab.is-active');
  const panel = document.querySelector('.panel.is-active');
  return {
    title: document.title,
    shell: document.documentElement.getAttribute('data-shell-theme'),
    boot: document.documentElement.hasAttribute('data-boot-theme'),
    dark: document.documentElement.hasAttribute('data-ds-dark-theme'),
    inlineBg: document.documentElement.style.getPropertyValue('--dsw-alias-bg-base'),
    inlineBodyBg: document.body.style.getPropertyValue('background') || document.body.style.background || '',
    tokenBg: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
    tokenSidebar: cs.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
    tokenPrimary: cs.getPropertyValue('--dsw-alias-button-primary-fill').trim(),
    htmlBg: cs.backgroundColor,
    bodyBg: body.backgroundColor,
    railBg: rail ? getComputedStyle(rail).backgroundColor : '',
    primaryBg: primary ? getComputedStyle(primary).backgroundColor : '',
    activeTab: (active && active.dataset.tab) || '',
    panelId: (panel && panel.id) || '',
    homeStatus: (document.getElementById('home-status') || {}).textContent || '',
    hint: (document.getElementById('hint') || {}).textContent || '',
    importSource: (document.getElementById('import-source') || {}).textContent || '',
    importResult: (document.getElementById('import-result') || {}).textContent || '',
    releaseText: (document.getElementById('release-list') || {}).innerText || '',
    pluginSummary: (document.getElementById('forensics-summary') || {}).textContent || '',
    pluginText: (document.getElementById('plugin-list') || {}).innerText || '',
    optQuit: Boolean((document.getElementById('opt-quit') || {}).checked),
    optAuto: Boolean((document.getElementById('opt-auto') || {}).checked),
    optAsk: Boolean((document.getElementById('opt-ask') || {}).checked),
  };
})()`

function sameRgb(actual, expected) {
  const norm = (value) => String(value || '').replace(/\s+/g, '').toLowerCase()
  return norm(actual) === norm(expected)
}

function assertScheme(scheme, sample) {
  const fails = []
  const want = OFFICIAL[scheme]
  if (sample.shell !== 'official') fails.push(`shell=${sample.shell}`)
  if (sample.boot) fails.push('data-boot-theme present')
  if (scheme === 'dark' && !sample.dark) fails.push('missing data-ds-dark-theme')
  if (scheme === 'light' && sample.dark) fails.push('data-ds-dark-theme on light')
  if (String(sample.inlineBg || '').trim()) fails.push(`inline wallpaper override ${sample.inlineBg}`)
  if (/#|rgb/i.test(String(sample.inlineBodyBg || ''))) fails.push(`inline body background ${sample.inlineBodyBg}`)
  if (!sameRgb(sample.tokenBg, want.bg) && !sameRgb(sample.htmlBg, want.bg) && !sameRgb(sample.bodyBg, want.bg)) {
    fails.push(`bg ${sample.tokenBg || sample.bodyBg} != ${want.bg}`)
  }
  if (!sameRgb(sample.tokenSidebar, want.sidebar) && !sameRgb(sample.railBg, want.sidebar)) {
    fails.push(`sidebar ${sample.tokenSidebar || sample.railBg} != ${want.sidebar}`)
  }
  if (!sameRgb(sample.tokenPrimary, want.primary) && !sameRgb(sample.primaryBg, want.primary)) {
    fails.push(`primary ${sample.tokenPrimary || sample.primaryBg} != ${want.primary}`)
  }
  const blob = JSON.stringify(sample).toLowerCase()
  if (blob.includes('243, 250, 247') || blob.includes('#f3faf7') || blob.includes('7, 20, 17') || blob.includes('#071411')) {
    fails.push('celadon wallpaper seed leaked into sampled colors')
  }
  return fails
}

async function screenshot(cdp, file) {
  await cdp.send('Page.enable')
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
}

async function clickTab(cdp, tab) {
  await cdp.eval(`document.querySelector('[data-tab="${tab}"]').click()`)
  await sleep(tab === 'versions' ? 4000 : 1200)
}

async function runScheme(scheme, debugPort) {
  const dirs = prepareUserData(scheme)
  const child = spawnElectron(dirs.userData, debugPort)
  const rows = []
  try {
    const { launcher, targets } = await waitForLauncher(debugPort)
    await sleep(1500)
    const cdp = new Cdp(launcher.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable').catch(() => {})

    const bootWait = Date.now() + 12_000
    while (Date.now() < bootWait) {
      const ready = await cdp.eval(`({
        status: (document.getElementById('home-status') || {}).textContent || '',
        hasPageShell: typeof pageShell === 'function',
      })`).catch(() => ({ status: '', hasPageShell: false }))
      if (ready.hasPageShell && ready.status && !/正在读取状态/.test(ready.status)) break
      await sleep(400)
    }

    const urls = targets.map((row) => row.url)
    const extraWindows = urls.filter((url) => !/launcher\.html/i.test(url) && !/devtools/i.test(url))

    for (const tab of TABS) {
      await clickTab(cdp, tab)
      const sample = await cdp.eval(SAMPLE_JS)
      const png = path.join(outDir, `${scheme}-${tab}.png`)
      await screenshot(cdp, png)
      const colorFails = assertScheme(scheme, sample)
      rows.push({
        tab,
        png,
        colorFails,
        sample: {
          shell: sample.shell,
          boot: sample.boot,
          dark: sample.dark,
          tokenBg: sample.tokenBg,
          tokenSidebar: sample.tokenSidebar,
          tokenPrimary: sample.tokenPrimary,
          htmlBg: sample.htmlBg,
          bodyBg: sample.bodyBg,
          railBg: sample.railBg,
          primaryBg: sample.primaryBg,
          inlineBg: sample.inlineBg,
          activeTab: sample.activeTab,
          panelId: sample.panelId,
          homeStatus: sample.homeStatus,
          hint: sample.hint,
          importSource: sample.importSource,
          releasePreview: String(sample.releaseText || '').slice(0, 400),
          pluginSummary: sample.pluginSummary,
          pluginPreview: String(sample.pluginText || '').slice(0, 400),
          optQuit: sample.optQuit,
          optAuto: sample.optAuto,
          optAsk: sample.optAsk,
        },
      })
    }

    cdp.close()
    return {
      scheme,
      userData: dirs.userData,
      celadon: CELADON,
      extraWindows,
      urls,
      logTail: child.log().split(/\r?\n/).slice(-40),
      rows,
    }
  } finally {
    stopProcessTree(child)
    await sleep(800)
  }
}

const report = {
  at: new Date().toISOString(),
  electronBin,
  official: OFFICIAL,
  celadonProbe: CELADON,
  schemes: [],
}

if (!existsSync(electronBin)) {
  throw new Error(`missing electron: ${electronBin}`)
}

report.schemes.push(await runScheme('light', 9335))
report.schemes.push(await runScheme('dark', 9336))

const failures = []
for (const scheme of report.schemes) {
  if (scheme.extraWindows.length) {
    failures.push(`${scheme.scheme}: extra windows ${scheme.extraWindows.join(', ')}`)
  }
  for (const row of scheme.rows) {
    if (row.sample.activeTab !== row.tab) {
      failures.push(`${scheme.scheme}/${row.tab}: active tab ${row.sample.activeTab}`)
    }
    for (const fail of row.colorFails) {
      failures.push(`${scheme.scheme}/${row.tab}: ${fail}`)
    }
  }
  const settings = scheme.rows.find((row) => row.tab === 'settings')
  if (settings?.sample.optAuto !== false) {
    failures.push(`${scheme.scheme}: auto-start was not off`)
  }
}

report.failures = failures
report.ok = failures.length === 0
writeFileSync(path.join(outDir, 'live-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  ok: report.ok,
  failures,
  screenshots: report.schemes.flatMap((scheme) => scheme.rows.map((row) => path.basename(row.png))),
}, null, 2))
if (!report.ok) process.exitCode = 1
