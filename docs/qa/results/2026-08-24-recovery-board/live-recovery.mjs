#!/usr/bin/env node
/**
 * Live CDP drive for launcher Recovery Board (TC-LAUNCH-005 + sticky skip).
 * Uses an isolated userData clone of production home so APPDATA is not mutated.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..', '..')
const outDir = __dirname
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const prodUserData = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Deepseek-Harness-Desktop')
  : ''

const DEBUG_PORT = Number(process.env.DSHD_QA_PORT || 9361)

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
      }, 30_000)
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

function prepareIsolatedUserData() {
  const userData = path.join(os.tmpdir(), `dshd-recovery-live-${Date.now()}`)
  mkdirSync(userData, { recursive: true })
  if (prodUserData && existsSync(path.join(prodUserData, 'dsh-home'))) {
    cpSync(path.join(prodUserData, 'dsh-home'), path.join(userData, 'dsh-home'), { recursive: true })
  } else {
    mkdirSync(path.join(userData, 'dsh-home', 'profiles', 'web'), { recursive: true })
    mkdirSync(path.join(userData, 'dsh-home', 'sessions'), { recursive: true })
  }
  if (prodUserData && existsSync(path.join(prodUserData, 'runtime'))) {
    cpSync(path.join(prodUserData, 'runtime'), path.join(userData, 'runtime'), { recursive: true })
  }
  const workspace = path.join(userData, 'workspace')
  mkdirSync(workspace, { recursive: true })

  const config = {
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
    theme: 'deepseek',
    disabledPlugins: [],
    pluginRecovery: {
      skipUserPlugins: false,
      reason: '',
      at: '',
      appVersion: '',
    },
  }
  writeFileSync(path.join(userData, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(path.join(userData, 'last-desktop-start.json'), `${JSON.stringify({
    ok: false,
    at: new Date().toISOString(),
    error: 'qa-seeded: cannot resolve profile bundle "qa-broken-pack"',
  }, null, 2)}\n`)

  const profileDir = path.join(userData, 'dsh-home', 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = path.join(profileDir, 'package.json')
  let manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch { /* keep default */ }
  }
  manifest.dependencies = {
    ...(manifest.dependencies || {}),
    'qa-broken-pack': 'file:./missing-qa-broken-pack',
  }
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? [...manifest.dsh.profile.bundles]
    : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (!bundles.includes('qa-broken-pack')) bundles.push('qa-broken-pack')
  manifest.dsh = {
    ...(manifest.dsh || {}),
    profile: {
      ...(manifest.dsh?.profile || {}),
      bundles,
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { userData, profileDir, manifestPath }
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

async function waitForLauncher(debugPort, timeoutMs = 60_000) {
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

async function screenshot(cdp, file) {
  await cdp.send('Page.enable')
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
}

const SAMPLE_JS = `(() => {
  const recovery = document.getElementById('home-recovery');
  const list = document.getElementById('home-recovery-list');
  const rows = list ? [...list.querySelectorAll('li')].map((li) => li.innerText.slice(0, 200)) : [];
  return {
    title: document.title,
    activeTab: (document.querySelector('.tab.is-active') || {}).dataset?.tab || '',
    homeStatus: (document.getElementById('home-status') || {}).textContent || '',
    hint: (document.getElementById('hint') || {}).textContent || '',
    recoveryHidden: recovery ? recovery.hidden : true,
    recoveryVerdict: (document.getElementById('home-recovery-verdict') || {}).textContent || '',
    recoveryRows: rows,
    disableSuspectsHidden: (() => {
      const btn = document.getElementById('btn-disable-suspects');
      return !btn || btn.hidden;
    })(),
    hasLauncherRecovery: Boolean(window.launcherRecovery),
    pluginSummary: (document.getElementById('forensics-summary') || {}).textContent || '',
    pluginText: ((document.getElementById('plugin-list') || {}).innerText || '').slice(0, 800),
  };
})()`

async function waitHomeReady(cdp) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const ready = await cdp.eval(`({
      status: (document.getElementById('home-status') || {}).textContent || '',
      hasShell: Boolean(window.shell),
      hasRecoveryApi: Boolean(window.launcherRecovery),
    })`).catch(() => ({ status: '', hasShell: false, hasRecoveryApi: false }))
    if (ready.hasShell && ready.status && !/正在读取状态/.test(ready.status)) {
      return ready
    }
    await sleep(400)
  }
  throw new Error('home status never left loading')
}

async function main() {
  if (!existsSync(electronBin)) {
    throw new Error(`missing electron: ${electronBin}`)
  }
  const dirs = prepareIsolatedUserData()
  const child = spawnElectron(dirs.userData, DEBUG_PORT)
  const report = {
    at: new Date().toISOString(),
    userData: dirs.userData,
    steps: [],
    pass: false,
    fails: [],
  }

  try {
    const { launcher } = await waitForLauncher(DEBUG_PORT)
    await sleep(1200)
    const cdp = new Cdp(launcher.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await waitHomeReady(cdp)

    // Cold start with lastStart.ok=false should land on home with recovery board.
    let sample = await cdp.eval(SAMPLE_JS)
    await screenshot(cdp, path.join(outDir, '01-cold-home-recovery.png'))
    report.steps.push({ name: 'cold-home-with-lastStart-fail', sample })
    if (sample.activeTab !== 'home') report.fails.push(`expected home tab, got ${sample.activeTab}`)
    if (sample.recoveryHidden) report.fails.push('recovery board hidden after lastStart fail')
    if (!sample.hasLauncherRecovery) report.fails.push('window.launcherRecovery missing')
    if (!/上次启动失败|可疑|跳过|恢复|未就绪/.test(sample.recoveryVerdict + sample.homeStatus)) {
      report.fails.push(`verdict/status weak: ${sample.recoveryVerdict || sample.homeStatus}`)
    }

    // Start desktop with broken pack — expect failure / sticky recovery stay on home.
    await cdp.eval(`document.getElementById('btn-start').click()`)
    await sleep(8000)
    sample = await cdp.eval(SAMPLE_JS)
    await screenshot(cdp, path.join(outDir, '02-after-start-attempt.png'))
    report.steps.push({ name: 'after-start-attempt', sample, logTail: child.log().slice(-2500) })
    if (sample.activeTab !== 'home') report.fails.push(`after start expected home, got ${sample.activeTab}`)
    if (sample.recoveryHidden) report.fails.push('recovery board hidden after start attempt')

    // Skip path: should keep launcher open and show sticky skip verdict.
    await cdp.eval(`document.getElementById('btn-skip').click()`)
    await sleep(12000)
    sample = await cdp.eval(SAMPLE_JS)
    await screenshot(cdp, path.join(outDir, '03-after-skip.png'))
    report.steps.push({ name: 'after-skip', sample, logTail: child.log().slice(-2500) })
    if (sample.recoveryHidden) report.fails.push('recovery board hidden after skip')
    if (!/跳过用户插件/.test(sample.homeStatus + sample.recoveryVerdict)) {
      report.fails.push(`sticky skip not visible: status=${sample.homeStatus} verdict=${sample.recoveryVerdict}`)
    }
    if (/预置 dshmarket|预置用量统计|预置 dshbot/.test(child.log()) && /跳过用户插件：已暂隐 dshbot|不预置市场/.test(child.log()) === false) {
      // soft signal only — exact log wording may vary
    }
    if (!/不预置市场与用量统计|暂隐 dshbot|跳过用户插件/.test(child.log())) {
      report.fails.push('skip path log missing hide/no-ensure markers')
    }

    // Plugins tab shares board + official-template safety.
    await cdp.eval(`document.querySelector('[data-tab="plugins"]').click()`)
    await sleep(1500)
    sample = await cdp.eval(SAMPLE_JS)
    await screenshot(cdp, path.join(outDir, '04-plugins-tab.png'))
    report.steps.push({ name: 'plugins-tab', sample })
    if (!/qa-broken-pack|未能从日志|可疑|桌面预置|官方模板/.test(sample.pluginText + sample.pluginSummary)) {
      report.fails.push(`plugins tab weak content: ${sample.pluginSummary}`)
    }

    // Back home and try disable broken pack if listed.
    await cdp.eval(`document.querySelector('[data-tab="home"]').click()`)
    await sleep(800)
    const disableResult = await cdp.eval(`(async () => {
      const list = document.getElementById('home-recovery-list');
      const btn = list && list.querySelector('[data-disable="qa-broken-pack"]');
      if (!btn) return { clicked: false, reason: 'no-disable-btn' };
      btn.click();
      await new Promise((r) => setTimeout(r, 6000));
      return {
        clicked: true,
        recoveryHidden: document.getElementById('home-recovery').hidden,
        status: document.getElementById('home-status').textContent,
        verdict: document.getElementById('home-recovery-verdict').textContent,
        listText: document.getElementById('home-recovery-list').innerText.slice(0, 600),
      };
    })()`)
    await screenshot(cdp, path.join(outDir, '05-after-disable.png'))
    report.steps.push({ name: 'disable-qa-broken-pack', disableResult })

    // Retry full plugins from launcher (must use startDesktop recovery launch path).
    await cdp.eval(`document.getElementById('btn-retry-full').click()`)
    await sleep(12000)
    sample = await cdp.eval(SAMPLE_JS)
    await screenshot(cdp, path.join(outDir, '06-after-retry-full.png'))
    report.steps.push({ name: 'after-retry-full', sample, logTail: child.log().slice(-2500) })

    cdp.close()
    report.pass = report.fails.length === 0
  } catch (error) {
    report.fails.push(error.message || String(error))
    report.pass = false
    report.logTail = child.log().slice(-4000)
  } finally {
    stopProcessTree(child)
    writeFileSync(path.join(outDir, 'live-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    // Keep isolated userData for inspection; do not auto-delete.
    console.log(JSON.stringify({
      pass: report.pass,
      fails: report.fails,
      userData: dirs.userData,
      outDir,
      steps: report.steps.map((s) => s.name),
    }, null, 2))
    if (!report.pass) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
