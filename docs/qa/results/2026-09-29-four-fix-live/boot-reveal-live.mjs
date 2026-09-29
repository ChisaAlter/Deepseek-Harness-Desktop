#!/usr/bin/env node
/**
 * Launch an isolated source instance and measure boot -> harness reveal timing.
 * Uses two CDP targets on the same instance (boot.html + loopback harness).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.DSHD_QA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated')
mkdirSync(outDir, { recursive: true })
const port = Number(process.env.DSH_BOOT_CDP_PORT || 9335)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
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
          pending.set(reqId, { res: (v) => { clearTimeout(timer); res(v) }, rej: (e) => { clearTimeout(timer); rej(e) } })
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const userData = path.join(process.env.TEMP || process.env.TMPDIR || '.', `dshd-boot-live-${stamp}`)
  const { writeFileSync: write } = await import('node:fs')
  mkdirSync(userData, { recursive: true })
  write(path.join(userData, 'config.json'), JSON.stringify({
    workspace: root,
    host: '127.0.0.1',
    port: 3199,
    autoStartDesktop: true,
    askOnUpdate: false,
    closeToTray: false,
    whaleAssistantEnabled: true,
    remoteWorkspaceEnabled: true,
    dshbotEnabled: false,
    pet: { enabled: false },
    live2dPet: { enabled: false },
  }, null, 2))

  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const startedAt = Date.now()
  const child = spawn(electron, ['.', `--user-data-dir=${userData}`, '--no-first-run', `--remote-debugging-port=${port}`, '--remote-allow-origins=*'], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })

  try {
    let boot = null
    let harness = null
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      try {
        const list = await listTargets()
        boot = list.find((t) => /boot\.html/i.test(t.url || '')) || boot
        harness = list.find((t) => /^https?:\/\/127\.0\.0\.1:3199\/?$/.test(t.url || '')) || harness
        if (harness) break
      } catch { /* not up yet */ }
      await sleep(250)
    }
    if (!boot || !harness) throw new Error(`targets missing boot=${Boolean(boot)} harness=${Boolean(harness)}`)

    const bootCdp = await connect(boot.webSocketDebuggerUrl)
    await bootCdp.send('Runtime.enable')
    const bootEval = async (expression) => {
      const r = await bootCdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return r.result?.value
    }

    // The fix's observable guarantee: boot stays in front until the harness
    // renderer reports its fade completed, then boot flips data-harness-covered.
    let coveredMs = null
    for (let i = 0; i < 400; i++) {
      const covered = await bootEval(`document.body && document.body.hasAttribute('data-harness-covered')`)
      if (covered) { coveredMs = Date.now() - startedAt; break }
      await sleep(100)
    }

    const harnessCdp = await connect(harness.webSocketDebuggerUrl)
    await harnessCdp.send('Runtime.enable')
    const harnessEval = async (expression) => {
      const r = await harnessCdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return r.result?.value
    }
    const harnessState = await harnessEval(`(() => ({
      url: location.href,
      opacity: getComputedStyle(document.documentElement).opacity,
      fadeAttr: document.documentElement.getAttribute('data-dshd-harness-fade'),
      hasApp: Boolean(document.querySelector('[data-dsh-settings-trigger]')),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
    }))()`)

    const bootState = await bootEval(`(() => ({
        url: location.href,
        covered: document.body.hasAttribute('data-harness-covered'),
        fade: document.body.getAttribute('data-harness-fade'),
        opacity: getComputedStyle(document.body).opacity,
      }))()`)

    const report = { at: new Date().toISOString(), userData, coveredMs, bootState, harnessState,
      checks: { bootCovered: bootState?.covered === true, harnessOpaque: harnessState?.opacity === '1', harnessMounted: harnessState?.hasApp === true } }
    writeFileSync(path.join(outDir, 'boot-reveal-live.json'), `${JSON.stringify(report, null, 2)}\n`)
    const shot = await harnessCdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path.join(outDir, 'boot-reveal-live.png'), Buffer.from(shot.data, 'base64'))
    console.log(JSON.stringify(report, null, 2))
    harnessCdp.close(); bootCdp.close()
  } finally {
    child.kill()
    if (stderr.trim()) console.error(stderr.trim().slice(0, 2000))
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
