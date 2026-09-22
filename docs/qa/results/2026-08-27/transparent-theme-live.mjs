#!/usr/bin/env node
/**
 * Live drive of TC-APP-012 / 013 / 014 (透明主题) against the source desktop
 * app on Linux: isolated user-data, real Electron + harness web UI over CDP.
 * Writes live-report.json plus PNG screenshots next to this file.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const electronBin = process.env.ELECTRON_PATH
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { reject(new Error(`bad JSON from ${url}`)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${url}`)) })
  })
}

class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map() }
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
      if (msg.error) job.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else job.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 30_000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval failed')
    }
    return result.result?.value
  }
  close() { try { this.ws?.close() } catch { /* already gone */ } }
}

/** Encode a busy random-noise RGB PNG (worst case for text readability). */
function noisyPng(width, height) {
  const crcTable = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < width; x += 1) {
      raw[offset] = Math.floor(Math.random() * 256)
      raw[offset + 1] = Math.floor(Math.random() * 256)
      raw[offset + 2] = Math.floor(Math.random() * 256)
      offset += 3
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function prepareDirs(port) {
  const base = path.join(os.tmpdir(), `dshd-transparent-live-${Date.now()}`)
  const userData = path.join(base, 'user-data')
  const workspace = path.join(base, 'workspace')
  mkdirSync(userData, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(path.join(workspace, 'README.md'), 'transparent theme qa\n')
  const git = (args) => spawnSync('git', args, { cwd: workspace, windowsHide: true })
  git(['init'])
  git(['add', '.'])
  git(['-c', 'user.name=dsh-qa', '-c', 'user.email=qa@example.test', 'commit', '-m', 'qa'])
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: false,
    quitAfterStart: true,
    autoStartDesktop: true,
    askOnUpdate: false,
    locale: 'zh',
  }, null, 2))
  return { base, userData, workspace }
}

function stopTree(child) {
  if (!child || child.exitCode !== null) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

async function waitForMainWindow(debugPort, appPort, timeoutMs = 180_000) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
      const main = (Array.isArray(targets) ? targets : []).find((row) => (
        row.type === 'page'
        && String(row.url || '').includes(`127.0.0.1:${appPort}`)
        && row.webSocketDebuggerUrl
      ))
      if (main) return main
    } catch (error) { last = error.message }
    await sleep(500)
  }
  throw new Error(`main window CDP not ready: ${last}`)
}

async function screenshot(cdp, name, { scrollToToggle = false } = {}) {
  if (scrollToToggle) {
    await cdp.eval(`(() => {
      const toggle = document.querySelector('[role="switch"][aria-label="透明主题"], [role="switch"][aria-label="Transparent theme"]')
      if (toggle) toggle.scrollIntoView({ block: 'center' })
      return true
    })()`)
    await sleep(500)
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(outDir, name)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return name
}

const steps = []
const rec = (name, ok, detail = '') => {
  steps.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

/** Bilingual selectors: the web UI locale follows the browser (en here). */
const TOGGLE_SEL = '[role="switch"][aria-label="透明主题"], [role="switch"][aria-label="Transparent theme"]'
const GLASS_SEL = 'input[aria-label="玻璃透明度"], input[aria-label="Glass opacity"]'
const BLUR_SEL = 'input[aria-label="毛玻璃程度"], input[aria-label="Frosted glass"]'

/** Page-side probe: transparent-theme relevant document + Appearance state. */
const PROBE = `(() => {
  const cs = getComputedStyle(document.body)
  const wallpaper = document.getElementById('dsh-wallpaper')
  const mask = wallpaper ? getComputedStyle(wallpaper, '::after').backgroundColor : ''
  const toggle = document.querySelector('${TOGGLE_SEL}')
  const panel = toggle ? toggle.closest('[role="dialog"]') : null
  const glass = document.querySelector('${GLASS_SEL}')
  const blur = document.querySelector('${BLUR_SEL}')
  const text = panel ? panel.innerText : ''
  return {
    transparentAttr: document.documentElement.hasAttribute('data-dsh-transparent'),
    wallpaperAttr: document.documentElement.hasAttribute('data-dsh-wallpaper'),
    glassToken: cs.getPropertyValue('--dsw-alias-glass-opacity').trim(),
    sidebarFill: cs.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
    terminalPane: cs.getPropertyValue('--dsw-alias-terminal-pane').trim(),
    maskColor: mask,
    glassSlider: glass ? { value: glass.value, disabled: glass.disabled } : null,
    blurSlider: blur ? { value: blur.value, disabled: blur.disabled } : null,
    toggleChecked: toggle ? (toggle.checked ?? toggle.getAttribute('aria-checked') === 'true') : null,
    hintNeedsWallpaper: /透明主题需要先设置背景图|takes effect after a wallpaper is set/.test(text),
    hintLowBlur: /毛玻璃程度低于 20%|Frosted glass is below 20%/.test(text),
    hintNormal: /开启后界面表层完全透明|Makes every UI surface fully transparent/.test(text),
  }
})()`

const setRange = (selector, value) => `(() => {
  const input = document.querySelector('${selector}')
  if (!input) return false
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, '${value}')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

const clickToggle = `(() => {
  const toggle = document.querySelector('${TOGGLE_SEL}')
  if (!toggle) return false
  toggle.click()
  return true
})()`

const dismissNotice = `(() => {
  const notice = Array.from(document.querySelectorAll('[role="dialog"]')).find((el) => (
    /Internal Testing|内测/.test(el.getAttribute('aria-label') || '') && el.getBoundingClientRect().height > 0
  ))
  if (!notice) return false
  const buttons = Array.from(notice.querySelectorAll('button')).filter((el) => el.getBoundingClientRect().height > 0)
  if (buttons.length === 0) return false
  buttons[buttons.length - 1].click()
  return true
})()`

const clickByText = (pattern) => `(() => {
  const re = new RegExp(${JSON.stringify(pattern)})
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="tab"]'))
  const hit = nodes.find((el) => re.test((el.textContent || '').trim()) && el.getBoundingClientRect().height > 0)
  if (!hit) return false
  hit.click()
  return true
})()`

async function waitUntil(fn, timeoutMs = 15_000, interval = 400) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (value) return value
    await sleep(interval)
  }
  return null
}

const appPort = await reservePort()
const debugPort = await reservePort()
const dirs = prepareDirs(appPort)
const pngB64 = noisyPng(512, 512).toString('base64')

const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
delete env.DSH_HOME
delete env.DSHD_HOME
delete env.DSH_SMOKE
delete env.DSH_QA

const child = spawn(electronBin, [
  `--user-data-dir=${dirs.userData}`,
  `--remote-debugging-port=${debugPort}`,
  '--remote-allow-origins=*',
  '.',
], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', (chunk) => { log += String(chunk) })
child.stderr.on('data', (chunk) => { log += String(chunk) })

const shots = []
try {
  const target = await waitForMainWindow(debugPort, appPort)
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  const trigger = await waitUntil(
    () => cdp.eval(`Boolean(document.querySelector('[data-dsh-settings-trigger]'))`),
    120_000,
  )
  rec('boot.settingsTrigger', trigger)

  await cdp.eval(dismissNotice)
  await sleep(600)
  await cdp.eval(clickByText('Configure later|稍后配置'))
  await sleep(600)
  await cdp.eval(`document.querySelector('[data-dsh-settings-trigger]').click()`)
  await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[data-dsh-settings-section="appearance"]'))`))
  await cdp.eval(dismissNotice)
  await sleep(400)
  await cdp.eval(`document.querySelector('[data-dsh-settings-section="appearance"]').click()`)
  const appearance = await waitUntil(async () => {
    const probe = await cdp.eval(PROBE)
    return probe.toggleChecked !== null ? probe : null
  })
  rec('appearance.open', Boolean(appearance))

  // ---- TC-APP-013: no wallpaper — flag is inert, hint, slider stays live.
  await cdp.eval(clickToggle)
  const inert = await waitUntil(async () => {
    const probe = await cdp.eval(PROBE)
    return probe.toggleChecked === true ? probe : null
  })
  rec('tc013.toggleOnWithoutWallpaper', Boolean(inert), JSON.stringify({ checked: inert?.toggleChecked }))
  rec('tc013.hintNeedsWallpaper', inert?.hintNeedsWallpaper)
  rec('tc013.transparentAttrAbsent', inert && !inert.transparentAttr)
  rec('tc013.glassStaysSlider', inert?.glassToken === '80%', `glass=${inert?.glassToken}`)
  rec('tc013.glassSliderEnabled', inert?.glassSlider && !inert.glassSlider.disabled)
  const okGlassDrag = await cdp.eval(setRange(GLASS_SEL, 60))
  await sleep(500)
  const dragged = await cdp.eval(PROBE)
  rec('tc013.glassSliderStillEffective', okGlassDrag && dragged.glassToken === '60%', `glass=${dragged.glassToken}`)
  await cdp.eval(setRange(GLASS_SEL, 80))
  await sleep(400)
  shots.push(await screenshot(cdp, 'tc013_transparent_without_wallpaper_hint.png', { scrollToToggle: true }))

  // ---- Set a busy wallpaper while the flag is already on (transition path 2).
  const assigned = await cdp.eval(`(() => {
    const input = document.querySelector('input[type="file"][accept*="image"]')
    if (!input) return false
    const bytes = Uint8Array.from(atob('${pngB64}'), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'qa-noise.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  rec('wallpaper.fileAssigned', assigned)
  const cropOpen = await waitUntil(() => cdp.eval(clickByText('使用此图片|Use this image')), 15_000)
  rec('wallpaper.cropConfirmed', Boolean(cropOpen))
  const effective = await waitUntil(async () => {
    const probe = await cdp.eval(PROBE)
    return probe.transparentAttr && probe.blurSlider ? probe : null
  }, 20_000)
  rec('tc012.transparentAttrSet', Boolean(effective))
  rec('tc012.glassZero', effective?.glassToken === '0%', `glass=${effective?.glassToken}`)
  rec('tc012.sidebarZeroFill', String(effective?.sidebarFill || '').includes('0%'), effective?.sidebarFill)
  rec('tc012.maskDropped', /rgba\(0,\s*0,\s*0,\s*0\)/.test(effective?.maskColor || ''), `mask=${effective?.maskColor}`)
  rec('tc012.terminalPaneSolid', Boolean(effective?.terminalPane) && !String(effective.terminalPane).includes('color-mix'), effective?.terminalPane)
  rec('tc012.glassSliderDisabled', effective?.glassSlider?.disabled === true)
  // ---- TC-APP-014: the effective transition auto-raised a 0 blur to 20.
  rec('tc014.blurAutoNudged', effective?.blurSlider?.value === '20', `blur=${effective?.blurSlider?.value}`)
  rec('tc014.normalHintAfterNudge', effective?.hintNormal && !effective.hintLowBlur)
  shots.push(await screenshot(cdp, 'tc012_transparent_effective_settings.png', { scrollToToggle: true }))

  // ---- TC-APP-014: manual re-lower is respected, warning hint appears.
  await cdp.eval(setRange(BLUR_SEL, 0))
  await sleep(600)
  const lowered = await cdp.eval(PROBE)
  rec('tc014.lowerNotReclamped', lowered.blurSlider?.value === '0', `blur=${lowered.blurSlider?.value}`)
  rec('tc014.lowBlurHint', lowered.hintLowBlur)
  shots.push(await screenshot(cdp, 'tc014_low_blur_warning_hint.png', { scrollToToggle: true }))

  // ---- TC-APP-012: switching off restores the glass slider immediately.
  await cdp.eval(clickToggle)
  const restored = await waitUntil(async () => {
    const probe = await cdp.eval(PROBE)
    return probe.toggleChecked === false ? probe : null
  })
  rec('tc012.offRestoresGlass', restored?.glassToken === '80%', `glass=${restored?.glassToken}`)
  rec('tc012.offRemovesAttr', restored && !restored.transparentAttr)
  rec('tc012.offEnablesSlider', restored?.glassSlider && !restored.glassSlider.disabled)
  rec('tc012.offKeepsMask', !/rgba\(0,\s*0,\s*0,\s*0\)/.test(restored?.maskColor || ''), `mask=${restored?.maskColor}`)

  // ---- TC-APP-012/014: toggle on with wallpaper present (transition path 1) nudges again.
  await cdp.eval(clickToggle)
  const reOn = await waitUntil(async () => {
    const probe = await cdp.eval(PROBE)
    return probe.transparentAttr ? probe : null
  })
  rec('tc012.onWithWallpaper', Boolean(reOn), JSON.stringify({ glass: reOn?.glassToken }))
  rec('tc014.blurNudgedOnEnable', reOn?.blurSlider?.value === '20', `blur=${reOn?.blurSlider?.value}`)

  // ---- Close settings, screenshot the transparent chrome over the wallpaper.
  await cdp.eval(`(() => {
    const toggle = document.querySelector('${TOGGLE_SEL}')
    const panel = toggle ? toggle.closest('[role="dialog"]') : null
    const close = panel && (panel.querySelector('[aria-label="关闭"]') || panel.querySelector('[aria-label="Close"]'))
    if (close) { close.click(); return true }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return false
  })()`)
  await sleep(1200)
  shots.push(await screenshot(cdp, 'tc012_transparent_chrome_over_wallpaper.png'))

  cdp.close()
} catch (error) {
  rec('drive.error', false, error.message || String(error))
} finally {
  stopTree(child)
  await sleep(1000)
}

const failed = steps.filter((step) => !step.ok).map((step) => step.name)
const report = {
  at: new Date().toISOString(),
  electronBin,
  userData: dirs.userData,
  ok: failed.length === 0,
  failed,
  steps,
  screenshots: shots,
  logTail: log.split(/\r?\n/).slice(-30),
}
writeFileSync(path.join(outDir, 'live-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ok: report.ok, failed, screenshots: shots }, null, 2))
if (!report.ok) process.exitCode = 1
