#!/usr/bin/env node
/**
 * Real launcher-home probe (isolated source instance, CDP port 9334).
 * Verifies the single start/stop entry, in-flight lock, elapsed progress text,
 * collapsed diagnostics and no duplicate retry action.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.DSH_LAUNCHER_CDP_PORT || 9334)
const outDir = process.env.DSHD_QA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 1
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const reqId = id++
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(reqId); rej(new Error(`timeout ${method}`)) }, 30000)
          pending.set(reqId, {
            res: (v) => { clearTimeout(timer); res(v) },
            rej: (e) => { clearTimeout(timer); rej(e) },
          })
          ws.send(JSON.stringify({ id: reqId, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* ignore */ } },
    }))
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      const job = msg.id != null ? pending.get(msg.id) : null
      if (!job) return
      pending.delete(msg.id)
      msg.error ? job.rej(new Error(JSON.stringify(msg.error))) : job.res(msg.result)
    })
  })
}

async function main() {
  const list = await targets()
  const launcher = list.find((t) => /launcher\.html/i.test(t.url || ''))
  if (!launcher) throw new Error('launcher page not found')
  const cdp = await connect(launcher.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path.join(outDir, name), Buffer.from(s.data, 'base64'))
  }

  for (let i = 0; i < 60; i++) {
    if (await ev(`Boolean(document.getElementById('btn-start'))`)) break
    await sleep(500)
  }
  await ev(`document.querySelector('[data-tab="home"]')?.click?.()`)
  await sleep(500)

  const read = () => ev(`(() => {
    const get = (id) => document.getElementById(id);
    return {
      tab: [...document.querySelectorAll('[data-tab]')].find((el) => el.getAttribute('aria-selected') === 'true')?.getAttribute('data-tab') || '',
      start: { hidden: get('btn-start')?.hidden, disabled: get('btn-start')?.disabled, text: get('btn-start')?.textContent || '' },
      stop: { hidden: get('btn-stop')?.hidden, disabled: get('btn-stop')?.disabled, text: get('btn-stop')?.textContent || '' },
      skip: Boolean(get('btn-skip')),
      retryFull: Boolean(get('btn-retry-full')),
      duplicateRetry: Boolean(get('btn-recovery-retry')),
      recovery: { exists: Boolean(get('home-recovery')), hidden: get('home-recovery')?.hidden, open: get('home-recovery')?.open },
      progress: { hidden: get('home-start-progress')?.hidden, text: get('home-start-progress')?.textContent || '' },
      status: get('home-status')?.textContent || '',
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  })()`)

  const initial = await read()
  await shot('launcher-home-initial.png')

  const t0 = Date.now()
  await ev(`document.getElementById('btn-start').click()`)
  await sleep(650)
  const pending = await read()
  const pendingMs = Date.now() - t0
  await shot('launcher-home-pending.png')

  const report = {
    at: new Date().toISOString(),
    launcherUrl: launcher.url,
    initial,
    pending,
    pendingMs,
    checks: {
      homeTab: initial.tab === 'home',
      startVisible: !initial.start.hidden,
      stopHiddenOnIdle: initial.stop.hidden === true,
      singleRetryControl: initial.duplicateRetry === false,
      diagnosticsCollapsed: initial.recovery.hidden !== false || initial.recovery.open === false,
      startLockedAfterClick: pending.start.disabled === true,
      stopLockedAfterClick: initial.stop.hidden ? true : pending.stop.disabled === true,
      progressVisible: pending.progress.hidden === false && /秒/.test(pending.progress.text),
    },
  }
  writeFileSync(path.join(outDir, 'launcher-home-probe.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
