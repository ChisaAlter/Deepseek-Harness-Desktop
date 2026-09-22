#!/usr/bin/env node
/** Attach to running Electron (port 9470) and exercise stop-desktop + settings. */
import { writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.DSHD_QA_PORT || 9470)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
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
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true })
      this.ws.addEventListener('error', rej, { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${method}`)) }, 20_000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed')
    return r.result?.value
  }
  async shot(name) {
    const png = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'))
  }
  close() { try { this.ws.close() } catch { /* */ } }
}

async function attachLauncher() {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
  const launcher = targets.find((t) => /launcher\.html/i.test(t.url || ''))
  if (!launcher?.webSocketDebuggerUrl) throw new Error('launcher not found')
  const cdp = new Cdp(launcher.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

async function sample(cdp) {
  return cdp.eval(`Promise.all([
    window.shell?.launcherStatus?.(),
    Promise.resolve({
      home: (document.getElementById('home-status')||{}).textContent||'',
      btn: (document.getElementById('btn-start')||{}).textContent||'',
      hint: (document.getElementById('hint')||{}).textContent||'',
    }),
  ]).then(([st, ui]) => ({ state: st?.desktop?.state||'', ...ui }))`)
}

async function listUrls() {
  return (await httpJson(`http://127.0.0.1:${port}/json/list`))
    .map((t) => t.url).filter((u) => !/devtools/i.test(u))
}

const report = { at: new Date().toISOString(), probes: [] }

// --- stop desktop ---
try {
  const cdp = await attachLauncher()
  const before = await sample(cdp)
  await cdp.shot('real-profile-01-before.png')
  if (!/关闭桌面端/.test(before.btn) && before.state !== 'ready') {
    // open launcher if hidden - try show tab home
    await cdp.eval(`document.querySelector('[data-tab="home"]')?.click?.()`)
    await sleep(500)
  }
  const before2 = await sample(cdp)
  await cdp.eval(`document.getElementById('btn-start').click()`)
  let after = null
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    after = await sample(cdp)
    if ((after.state === 'idle' || after.state === 'stopped' || /未运行/.test(after.home)) && /启动桌面端/.test(after.btn)) break
  }
  const urlsAfter = await listUrls()
  await cdp.shot('real-profile-02-after-stop.png')
  report.probes.push({
    name: 'stop-desktop-real-profile',
    pass: (after?.state === 'idle' || after?.state === 'stopped' || /未运行/.test(after?.home || ''))
      && /启动桌面端/.test(after?.btn || '')
      && !/127\.0\.0\.1:\d+/i.test(urlsAfter.filter((u) => !/launcher|boot/i.test(u)).join(' ')),
    before: before2,
    after,
    urlsAfter,
  })
  cdp.close()
} catch (e) {
  report.probes.push({ name: 'stop-desktop-real-profile', pass: false, error: e.message })
}

// --- launcher settings toggle ---
try {
  const cdp = await attachLauncher()
  await cdp.eval(`document.querySelector('[data-tab="settings"]').click()`)
  await sleep(400)
  const before = await cdp.eval(`document.getElementById('opt-auto').checked`)
  await cdp.eval(`document.getElementById('opt-auto').click()`)
  await sleep(600)
  const after = await cdp.eval(`document.getElementById('opt-auto').checked`)
  await cdp.eval(`document.getElementById('opt-auto').click()`) // restore
  await sleep(400)
  await cdp.shot('real-profile-03-settings.png')
  report.probes.push({ name: 'launcher-settings-toggle', pass: before !== after, before, after })
  cdp.close()
} catch (e) {
  report.probes.push({ name: 'launcher-settings-toggle', pass: false, error: e.message })
}

report.pass = report.probes.every((p) => p.pass)
writeFileSync(path.join(outDir, 'real-profile-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
