#!/usr/bin/env node
/**
 * Real-userData live probe: cold start with existing sticky skip + lastStart fail.
 * Mutates only by exercising launcher buttons; restores nothing automatically.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..', '..')
const outDir = __dirname
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const userData = path.join(process.env.APPDATA, 'Deepseek-Harness-Desktop')
const DEBUG_PORT = Number(process.env.DSHD_QA_PORT || 9367)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch { reject(new Error(`bad json ${url}`)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${url}`)) })
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
      if (msg.error) job.reject(new Error(msg.error.message || 'cdp error'))
      else job.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, 45_000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval')
    }
    return result.result?.value
  }
  close() { try { this.ws?.close() } catch {} }
}

function spawnElectron() {
  const env = { ...process.env }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  env.ELECTRON_ENABLE_LOGGING = '1'
  const child = spawn(electronBin, [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    '.',
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
  let log = ''
  const onChunk = (c) => { log += String(c) }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)
  child.log = () => log
  return child
}

function stop(child) {
  if (!child || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}

async function waitLauncher(timeoutMs = 90_000) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const launcher = (targets || []).find((t) => /launcher\.html/i.test(t.url || '') && t.webSocketDebuggerUrl)
      if (launcher) return launcher
    } catch (e) { last = e.message || String(e) }
    await sleep(400)
  }
  throw new Error(`launcher not ready: ${last}`)
}

async function shot(cdp, name) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'))
}

const SAMPLE = `(() => {
  const recovery = document.getElementById('home-recovery');
  return {
    activeTab: document.querySelector('.tab.is-active')?.dataset?.tab || '',
    homeStatus: document.getElementById('home-status')?.textContent || '',
    hint: document.getElementById('hint')?.textContent || '',
    recoveryHidden: recovery ? recovery.hidden : true,
    recoveryVerdict: document.getElementById('home-recovery-verdict')?.textContent || '',
    recoveryText: (document.getElementById('home-recovery-list')?.innerText || '').slice(0, 800),
    hasRecoveryApi: Boolean(window.launcherRecovery),
  };
})()`

async function main() {
  mkdirSync(outDir, { recursive: true })
  const child = spawnElectron()
  const report = { at: new Date().toISOString(), userData, steps: [], fails: [], pass: false }
  try {
    const launcher = await waitLauncher()
    const cdp = new Cdp(launcher.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    for (let i = 0; i < 40; i += 1) {
      const s = await cdp.eval(`document.getElementById('home-status')?.textContent || ''`).catch(() => '')
      if (s && !/正在读取状态/.test(s)) break
      await sleep(400)
    }

    let sample = await cdp.eval(SAMPLE)
    await shot(cdp, 'real-01-cold.png')
    report.steps.push({ name: 'cold', sample })
    if (sample.activeTab !== 'home') report.fails.push(`tab=${sample.activeTab}`)
    if (sample.recoveryHidden) report.fails.push('recovery hidden on sticky/lastStart fail')
    if (!/跳过用户插件|上次启动失败/.test(sample.homeStatus + sample.recoveryVerdict)) {
      report.fails.push(`status/verdict weak: ${sample.homeStatus} | ${sample.recoveryVerdict}`)
    }

    // Clear sticky + full start (user's primary recovery path after disable).
    await cdp.eval(`document.getElementById('btn-start').click()`)
    // Wait for either ready state or failure hint.
    let desktopReady = false
    for (let i = 0; i < 90; i += 1) {
      await sleep(1000)
      sample = await cdp.eval(SAMPLE)
      if (/桌面端已就绪/.test(sample.homeStatus)) {
        desktopReady = true
        break
      }
      if ((/启动失败|进程结束/.test(sample.hint) || /桌面端异常/.test(sample.homeStatus)) && i > 15) {
        break
      }
    }
    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`).catch(() => [])
    const hasLoopbackUi = (targets || []).some((t) => /^https?:\/\/(127\.0\.0\.1|localhost):\d+/i.test(String(t.url || '')))
    await shot(cdp, 'real-02-after-start.png')
    report.steps.push({
      name: 'after-start',
      sample,
      desktopReady,
      hasLoopbackUi,
      logTail: child.log().slice(-4000),
      targets: (targets || []).map((t) => t.url),
    })
    if (!desktopReady) {
      // Try skip as rescue
      await cdp.eval(`document.getElementById('btn-skip').click()`)
      for (let i = 0; i < 60; i += 1) {
        await sleep(1000)
        sample = await cdp.eval(SAMPLE)
        if (/桌面端已就绪/.test(sample.homeStatus) || (/当前跳过用户插件/.test(sample.homeStatus) && !/桌面端异常|未运行/.test(sample.homeStatus))) {
          // sticky skip with running desktop still shows 已就绪 ideally
          if (/桌面端已就绪/.test(sample.homeStatus)) desktopReady = true
          const loop = (await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`).catch(() => []))
            .some((t) => /^https?:\/\/(127\.0\.0\.1|localhost):\d+/i.test(String(t.url || '')))
          if (loop) desktopReady = true
          if (desktopReady) break
        }
        if (/进程结束/.test(sample.hint) && i > 12) break
      }
      await shot(cdp, 'real-03-after-skip.png')
      report.steps.push({
        name: 'after-skip',
        sample,
        desktopReady,
        logTail: child.log().slice(-4000),
        targets: (await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`).catch(() => [])).map((t) => t.url),
      })
      if (!/跳过用户插件/.test(sample.homeStatus + sample.recoveryVerdict)) {
        report.fails.push('sticky skip not reflected after skip click')
      }
    }
    if (!desktopReady) report.fails.push('desktop did not become ready on real userData')
    else {
      await sleep(3000)
      sample = await cdp.eval(SAMPLE)
      await shot(cdp, 'real-04-stable.png')
      report.steps.push({ name: 'stable', sample })
    }

    cdp.close()
    report.pass = report.fails.length === 0
    report.keepAlive = desktopReady
    if (!desktopReady) stop(child)
    else report.pid = child.pid
  } catch (error) {
    report.fails.push(error.message || String(error))
    report.logTail = child.log().slice(-5000)
    stop(child)
  } finally {
    writeFileSync(path.join(outDir, 'real-live-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(path.join(outDir, 'real-electron.log'), child.log())
    console.log(JSON.stringify({
      pass: report.pass,
      fails: report.fails,
      keepAlive: report.keepAlive,
      steps: report.steps.map((s) => s.name),
    }, null, 2))
    if (!report.pass) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
