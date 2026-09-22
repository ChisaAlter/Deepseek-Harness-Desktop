#!/usr/bin/env node
/**
 * Drive the live desktop: open Settings, screenshot Harness 自动恢复 +
 * 价格设置 model picker. Leaves the app running.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const CDP_PORT = Number(process.env.DSH_CDP_PORT || 9229)
const READY_MS = Number(process.env.DSH_READY_MS || 240_000)

function electronBin() {
  const list = [
    process.env.ELECTRON_PATH,
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
  ]
  return list.find((item) => item && existsSync(item))
}

function killDesktopElectron() {
  const listed = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process | Where-Object {
      $_.Name -match 'electron' -and $_.CommandLine -and (
        $_.CommandLine -match [regex]::Escape('${root.replace(/'/g, "''")}') -or
        $_.CommandLine -match 'Deepseek-Harness-Desktop'
      ) -and $_.CommandLine -match 'electron\\\\dist\\\\electron'
    } | ForEach-Object { $_.ProcessId }`,
  ], { encoding: 'utf8', windowsHide: true })
  const pids = String(listed.stdout || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
  for (const pid of pids) {
    spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  }
  return pids
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function jsonList() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  if (!res.ok) throw new Error(`cdp list ${res.status}`)
  return res.json()
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', (err) => reject(err))
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id == null) return
    const wait = pending.get(msg.id)
    if (!wait) return
    pending.delete(msg.id)
    if (msg.error) wait.reject(new Error(JSON.stringify(msg.error)))
    else wait.resolve(msg.result)
  })
  async function send(method, params = {}) {
    await ready
    const id = ++nextId
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP timeout ${method}`))
        }
      }, 30_000)
    })
    ws.send(JSON.stringify({ id, method, params }))
    return result
  }
  return {
    send,
    close() {
      try { ws.close() } catch { /* ignore */ }
    },
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate threw')
  }
  return result.result?.value
}

async function screenshot(session, name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  const dest = path.join(outDir, name)
  writeFileSync(dest, Buffer.from(shot.data, 'base64'))
  return dest
}

const OPEN_GENERAL = `
(() => {
  const trigger = document.querySelector('[data-dsh-settings-trigger]');
  if (!trigger) return false;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      const nav = document.querySelector('[data-dsh-settings-section="general"]');
      if (nav) { nav.click(); resolve(true); return; }
      if (n++ > 80) { resolve(false); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
})()
`

const OPEN_INTERFACE = `
(() => {
  const nav = document.querySelector('[data-dsh-settings-section="interface"]');
  if (!nav) return false;
  nav.click();
  return true;
})()
`

const OPEN_MODELS = `
(() => {
  const nav = document.querySelector('[data-dsh-settings-section="models"]');
  if (!nav) return false;
  nav.click();
  return true;
})()
`

const PROBE_GENERAL = `
(() => {
  const sw = document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]');
  const row = sw && sw.closest('div');
  const nativeSelects = Array.from(document.querySelectorAll('select')).map((el) => ({
    aria: el.getAttribute('aria-label') || '',
    className: el.className,
  }));
  const maxBtn = document.querySelector('[aria-label="最大重启次数"], [aria-label="Max restart attempts"]');
  const delayBtn = document.querySelector('[aria-label="基础重启延迟"], [aria-label="Base restart delay"]');
  const body = document.body.innerText || '';
  return {
    hasTrigger: Boolean(document.querySelector('[data-dsh-settings-trigger]')),
    switchRole: sw ? sw.getAttribute('role') : null,
    switchType: sw ? sw.getAttribute('type') : null,
    switchTag: sw ? sw.tagName : null,
    switchChecked: sw ? sw.checked : null,
    savingText: /正在保存|Saving/.test(body),
    nativeSelectCount: nativeSelects.length,
    nativeSelects,
    maxIsButton: Boolean(maxBtn && maxBtn.tagName === 'BUTTON' && maxBtn.getAttribute('aria-haspopup') === 'menu'),
    delayIsButton: Boolean(delayBtn && delayBtn.tagName === 'BUTTON' && delayBtn.getAttribute('aria-haspopup') === 'menu'),
    titleVisible: /Harness 自动恢复|Harness auto-recovery/.test(body),
  };
})()
`

const CLICK_SWITCH = `
(() => {
  const sw = document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]');
  if (!sw) return { ok: false };
  const before = sw.checked;
  sw.click();
  return {
    ok: true,
    before,
    after: sw.checked,
    role: sw.getAttribute('role'),
    savingText: /正在保存|Saving/.test(document.body.innerText || ''),
  };
})()
`

const CLICK_MAX_MENU = `
(() => {
  const btn = document.querySelector('[aria-label="最大重启次数"], [aria-label="Max restart attempts"]');
  if (!btn) return { ok: false };
  btn.click();
  const menus = Array.from(document.querySelectorAll('[role="menu"]'));
  return {
    ok: true,
    menuCount: menus.length,
    menuitems: Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim()).slice(0, 12),
    nativeSelectCount: document.querySelectorAll('select').length,
  };
})()
`

const CLOSE_MENUS = `
(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()
`

const OPEN_PRICES = `
(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((el) =>
    /设置模型价格|Set model prices/.test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
  if (!btn) return { ok: false, reason: 'no-open-prices' };
  btn.click();
  return { ok: true };
})()
`

const PROBE_PRICES = `
(() => {
  const modelBtn = document.querySelector('[aria-label="模型"], [aria-label="Model"]');
  const nativeSelects = Array.from(document.querySelectorAll('dialog select, [role="dialog"] select, select'));
  return {
    modelTag: modelBtn ? modelBtn.tagName : null,
    modelHasPopup: modelBtn ? modelBtn.getAttribute('aria-haspopup') : null,
    nativeSelectCount: nativeSelects.length,
    dialogText: ((document.querySelector('[role="dialog"]') || {}).innerText || '').slice(0, 200),
  };
})()
`

const OPEN_MODEL_MENU = `
(() => {
  const modelBtn = document.querySelector('[aria-label="模型"], [aria-label="Model"]');
  if (!modelBtn) return { ok: false };
  modelBtn.click();
  return {
    ok: true,
    menuCount: document.querySelectorAll('[role="menu"]').length,
    menuitems: Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim()).slice(0, 20),
    nativeSelectCount: document.querySelectorAll('select').length,
  };
})()
`

const OPEN_ADD_PROVIDER = `
(() => {
  const add = Array.from(document.querySelectorAll('button')).find((el) =>
    /添加提供方|Add provider/.test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
  if (add) add.click();
  const selectLike = document.querySelector('[aria-haspopup="menu"]');
  const native = document.querySelectorAll('select').length;
  return {
    clickedAdd: Boolean(add),
    hasMenuTrigger: Boolean(selectLike),
    nativeSelectCount: native,
  };
})()
`

async function waitForHarness(deadline) {
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const targets = await jsonList()
      for (const target of targets) {
        if (!target.webSocketDebuggerUrl) continue
        const session = cdpSession(target.webSocketDebuggerUrl)
        try {
          await session.send('Runtime.enable')
          const probe = await evaluate(session, `({
            url: location.href,
            title: document.title,
            hasSettings: Boolean(document.querySelector('[data-dsh-settings-trigger]')),
            hasStart: Boolean(document.getElementById('btn-start')),
            startLabel: (document.getElementById('btn-start') || {}).textContent || '',
          })`)
          if (probe?.hasStart && /启动桌面端/.test(probe.startLabel)) {
            await evaluate(session, `document.getElementById('btn-start').click(); true`)
            session.close()
            await sleep(2000)
            break
          }
          if (probe?.hasSettings) {
            await session.send('Page.enable')
            return { session, target, probe }
          }
          session.close()
        } catch (err) {
          lastErr = String(err)
          try { session.close() } catch { /* ignore */ }
        }
      }
    } catch (err) {
      lastErr = String(err)
    }
    await sleep(1500)
  }
  throw new Error(`Harness settings trigger not ready: ${lastErr}`)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const bin = electronBin()
  if (!bin) throw new Error('electron binary missing')
  console.error(`[live-walk] root=${root}`)
  console.error(`[live-walk] bin=${bin}`)

  const killed = killDesktopElectron()
  await sleep(1500)

  const env = { ...process.env }
  for (const key of [
    'DSH_SMOKE', 'DSH_QA', 'DSH_QA_COMPOSER', 'DSH_QA_APPENDIX',
    'DSH_QA_REMOTE', 'DSH_QA_SHELL', 'DSH_QA_PERSIST', 'DSH_QA_RECOVERY',
  ]) {
    delete env[key]
  }
  const child = spawn(bin, [`--remote-debugging-port=${CDP_PORT}`, '.'], {
    cwd: root,
    env,
    stdio: 'ignore',
    detached: true,
    windowsHide: false,
  })
  child.unref()

  const deadline = Date.now() + READY_MS
  while (Date.now() < deadline) {
    try {
      await jsonList()
      break
    } catch {
      await sleep(500)
    }
  }

  const { session, target, probe } = await waitForHarness(deadline)
  const report = {
    killed,
    electronPid: child.pid,
    target: { url: target.url, title: target.title, type: target.type },
    bootProbe: probe,
    steps: {},
  }

  report.steps.openGeneral = await evaluate(session, OPEN_GENERAL)
  await sleep(600)
  report.steps.probeGeneral = await evaluate(session, PROBE_GENERAL)
  report.steps.shotGeneral = await screenshot(session, '01-general-harness-restart.png')

  const clicked = await evaluate(session, CLICK_SWITCH)
  report.steps.clickSwitch = clicked
  report.steps.shotSwitchImmediate = await screenshot(session, '02-general-switch-clicked.png')
  await sleep(250)
  report.steps.probeAfterClick = await evaluate(session, PROBE_GENERAL)
  report.steps.shotSwitchSettled = await screenshot(session, '03-general-switch-settled.png')
  if (clicked?.ok && clicked.before === clicked.after) {
    report.steps.switchDidNotToggle = true
  } else if (clicked?.ok) {
    await evaluate(session, CLICK_SWITCH)
    await sleep(200)
    report.steps.restoredSwitch = true
  }

  report.steps.maxMenu = await evaluate(session, CLICK_MAX_MENU)
  await sleep(250)
  report.steps.shotMaxMenu = await screenshot(session, '04-general-max-attempts-menu.png')
  await evaluate(session, CLOSE_MENUS)
  await sleep(200)

  report.steps.openInterface = await evaluate(session, OPEN_INTERFACE)
  await sleep(500)
  report.steps.shotInterface = await screenshot(session, '05-interface-session-cost.png')
  report.steps.openPrices = await evaluate(session, OPEN_PRICES)
  await sleep(500)
  report.steps.probePrices = await evaluate(session, PROBE_PRICES)
  report.steps.shotPrices = await screenshot(session, '06-price-panel.png')
  report.steps.modelMenu = await evaluate(session, OPEN_MODEL_MENU)
  await sleep(300)
  report.steps.shotModelMenu = await screenshot(session, '07-price-model-menu.png')

  await evaluate(session, CLOSE_MENUS)
  await sleep(150)
  await evaluate(session, CLOSE_MENUS)
  await sleep(200)

  report.steps.openModels = await evaluate(session, OPEN_MODELS)
  await sleep(500)
  report.steps.addProvider = await evaluate(session, OPEN_ADD_PROVIDER)
  await sleep(300)
  report.steps.shotModels = await screenshot(session, '08-models-add-provider.png')

  const dest = path.join(outDir, 'live-report.json')
  writeFileSync(dest, JSON.stringify(report, null, 2))
  session.close()
  console.log(JSON.stringify({ ok: true, report: dest, shots: [
    report.steps.shotGeneral,
    report.steps.shotSwitchImmediate,
    report.steps.shotSwitchSettled,
    report.steps.shotMaxMenu,
    report.steps.shotInterface,
    report.steps.shotPrices,
    report.steps.shotModelMenu,
    report.steps.shotModels,
  ] }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
