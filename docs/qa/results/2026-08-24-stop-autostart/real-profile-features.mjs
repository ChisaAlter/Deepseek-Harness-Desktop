import http from 'node:http'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.DSHD_QA_PORT || 9470)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(JSON.parse(body)))
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
      msg.error ? job.reject(new Error(msg.error.message)) : job.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.n
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${method}`)) }, 25_000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'eval failed')
    return result.result?.value
  }
}

async function attach(urlRe) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
  const row = targets.find((t) => urlRe.test(t.url || ''))
  if (!row?.webSocketDebuggerUrl) throw new Error(`target not found: ${urlRe}`)
  const cdp = new Cdp(row.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Runtime.enable')
  return cdp
}

const report = { at: new Date().toISOString(), probes: [] }

// Import rescan feedback
try {
  const cdp = await attach(/launcher\.html/i)
  await cdp.eval(`document.querySelector('[data-tab="import"]').click()`)
  await sleep(800)
  await cdp.eval(`document.getElementById('btn-scan').click()`)
  let sawLoading = false
  for (let i = 0; i < 20; i += 1) {
    await sleep(300)
    const status = await cdp.eval(`(document.getElementById('import-scan-status')||{}).textContent||''`)
    if (/扫描|读取|正在/.test(status)) sawLoading = true
    if (status && !/扫描|读取|正在/.test(status) && i > 2) break
  }
  const finalStatus = await cdp.eval(`({
    scanStatus: (document.getElementById('import-scan-status')||{}).textContent||'',
    hasPreset: !!document.querySelector('input[value*=\"preset-\"]'),
    sessionCount: document.querySelectorAll('input[name=\"session-rel\"]').length,
  })`)
  report.probes.push({
    name: 'import-rescan',
    pass: sawLoading || finalStatus.scanStatus.length > 0,
    sawLoading,
    finalStatus,
  })
  cdp.close()
} catch (error) {
  report.probes.push({ name: 'import-rescan', pass: false, error: error.message })
}

// Versions tab installed card
try {
  const cdp = await attach(/launcher\.html/i)
  await cdp.eval(`document.querySelector('[data-tab="versions"]').click()`)
  await sleep(1200)
  const card = await cdp.eval(`({
    installed: (document.getElementById('installed-card')||{}).textContent||'',
    hasUninstall: !(document.getElementById('btn-uninstall-app')||{}).hidden,
    uninstallLabel: (document.getElementById('btn-uninstall-app')||{}).textContent||'',
  })`)
  report.probes.push({
    name: 'versions-page',
    pass: /当前安装|0\.2\./.test(card.installed),
    card,
  })
  cdp.close()
} catch (error) {
  report.probes.push({ name: 'versions-page', pass: false, error: error.message })
}

// Start desktop then check harness settings row (if desktop loads)
try {
  const launcher = await attach(/launcher\.html/i)
  await launcher.eval(`document.querySelector('[data-tab="home"]').click()`)
  await launcher.eval(`document.getElementById('btn-start').click()`)
  launcher.close()
  let harnessCdp = null
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000)
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
    const harness = targets.find((t) => /^http:\/\/127\.0\.0\.1:\d+\/?$/i.test(t.url || ''))
    if (harness?.webSocketDebuggerUrl) {
      harnessCdp = new Cdp(harness.webSocketDebuggerUrl)
      await harnessCdp.connect()
      await harnessCdp.send('Runtime.enable')
      break
    }
  }
  if (!harnessCdp) throw new Error('harness UI timeout')
  // Open settings via hash if available
  const row = await harnessCdp.eval(`({
    href: location.href,
    hasAutoStartText: document.body?.innerText?.includes('启动时') || document.body?.innerText?.includes('Start behavior'),
  })`)
  report.probes.push({
    name: 'desktop-autostart-row',
    pass: row.hasAutoStartText === true,
    note: 'Full settings navigation requires in-app click; body text probe only',
    row,
  })
  harnessCdp.close()
} catch (error) {
  report.probes.push({ name: 'desktop-autostart-row', pass: false, error: error.message })
}

report.pass = report.probes.every((p) => p.pass)
writeFileSync(path.join(outDir, 'real-profile-features.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
