import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const CDP_PORT = 9229

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
      }, 20_000)
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
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails))
  }
  return result.result?.value
}

async function clickCss(session, x, y) {
  const point = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point })
}

async function screenshot(session, name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  const dest = path.join(outDir, name)
  writeFileSync(dest, Buffer.from(shot.data, 'base64'))
  return dest
}

async function findHarness(deadline) {
  let last = []
  while (Date.now() < deadline) {
    const targets = await jsonList()
    last = targets.map((t) => ({ title: t.title, url: t.url, type: t.type }))
    const harness = targets.find((t) =>
      t.webSocketDebuggerUrl
      && /^https?:\/\/127\.0\.0\.1|^https?:\/\/localhost/i.test(t.url || ''))
    if (harness) return { harness, targets }
    await sleep(1500)
  }
  return { harness: null, targets: last }
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

async function main() {
  let found = await findHarness(Date.now() + 5_000)
  if (!found.harness) {
    const targets = await jsonList()
    const launcher = targets.find((t) => /launcher\.html/.test(t.url || '')) || targets[0]
    if (!launcher?.webSocketDebuggerUrl) throw new Error('no launcher target')
    const launch = cdpSession(launcher.webSocketDebuggerUrl)
    await launch.send('Runtime.enable')
    await launch.send('Page.enable')
    const box = await evaluate(launch, `(() => {
      const el = document.getElementById('btn-start');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent, disabled: el.disabled };
    })()`)
    console.error('btn-start', JSON.stringify(box))
    if (!box || box.disabled) throw new Error('start button missing or disabled')
    await clickCss(launch, box.x, box.y)
    launch.close()
    console.error('clicked start via Input, waiting for harness...')
    found = await findHarness(Date.now() + 180_000)
  }
  if (!found.harness) {
    console.error('still no harness', JSON.stringify(found.targets, null, 2))
    process.exit(1)
  }
  console.error('harness', found.harness.url, found.harness.title)

  const session = cdpSession(found.harness.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  await session.send('Page.enable')

  const readyDeadline = Date.now() + 90_000
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(session, `Boolean(document.querySelector('[data-dsh-settings-trigger]'))`)
    if (ready) break
    await sleep(1000)
  }

  const report = { steps: {} }
  report.steps.openGeneral = await evaluate(session, OPEN_GENERAL)
  await sleep(700)
  report.steps.probeGeneral = await evaluate(session, `(() => {
    const sw = document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]');
    const maxBtn = document.querySelector('[aria-label="最大重启次数"], [aria-label="Max restart attempts"]');
    const delayBtn = document.querySelector('[aria-label="基础重启延迟"], [aria-label="Base restart delay"]');
    const body = document.body.innerText || '';
    return {
      switchRole: sw ? sw.getAttribute('role') : null,
      switchType: sw ? sw.getAttribute('type') : null,
      switchTag: sw ? sw.tagName : null,
      switchChecked: sw ? sw.checked : null,
      savingText: /正在保存|Saving/.test(body),
      nativeSelectCount: document.querySelectorAll('select').length,
      maxIsMenuButton: Boolean(maxBtn && maxBtn.tagName === 'BUTTON' && maxBtn.getAttribute('aria-haspopup') === 'menu'),
      delayIsMenuButton: Boolean(delayBtn && delayBtn.tagName === 'BUTTON' && delayBtn.getAttribute('aria-haspopup') === 'menu'),
      titleVisible: /Harness 自动恢复|Harness auto-recovery/.test(body),
    };
  })()`)
  report.steps.shotGeneral = await screenshot(session, '01-general-harness-restart.png')

  report.steps.clickSwitch = await evaluate(session, `(() => {
    const sw = document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]');
    if (!sw) return { ok: false };
    const before = sw.checked;
    sw.click();
    return { ok: true, before, after: sw.checked, role: sw.getAttribute('role'), savingText: /正在保存|Saving/.test(document.body.innerText || '') };
  })()`)
  report.steps.shotSwitchImmediate = await screenshot(session, '02-general-switch-clicked.png')
  await sleep(250)
  report.steps.probeAfterClick = await evaluate(session, `(() => {
    const sw = document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]');
    const body = document.body.innerText || '';
    return {
      role: sw ? sw.getAttribute('role') : null,
      checked: sw ? sw.checked : null,
      savingText: /正在保存|Saving/.test(body),
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  report.steps.shotSwitchSettled = await screenshot(session, '03-general-switch-settled.png')
  if (report.steps.clickSwitch?.ok && report.steps.clickSwitch.before !== report.steps.clickSwitch.after) {
    await evaluate(session, `document.querySelector('[aria-label="启用自动恢复"], [aria-label="Enable auto-recovery"]').click(); true`)
    report.steps.restoredSwitch = true
    await sleep(200)
  }

  report.steps.maxMenu = await evaluate(session, `(() => {
    const btn = document.querySelector('[aria-label="最大重启次数"], [aria-label="Max restart attempts"]');
    if (!btn) return { ok: false };
    btn.click();
    return {
      ok: true,
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuitems: Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim()).slice(0, 12),
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  await sleep(250)
  report.steps.shotMaxMenu = await screenshot(session, '04-general-max-attempts-menu.png')
  await evaluate(session, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(200)

  report.steps.openInterface = await evaluate(session, `(() => {
    const nav = document.querySelector('[data-dsh-settings-section="interface"]');
    if (!nav) return false;
    nav.click();
    return true;
  })()`)
  await sleep(500)
  report.steps.shotInterface = await screenshot(session, '05-interface-session-cost.png')
  report.steps.openPrices = await evaluate(session, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((el) =>
      /设置模型价格|Set model prices/.test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  })()`)
  await sleep(500)
  report.steps.probePrices = await evaluate(session, `(() => {
    const modelBtn = document.querySelector('[aria-label="模型"], [aria-label="Model"]');
    return {
      modelTag: modelBtn ? modelBtn.tagName : null,
      modelHasPopup: modelBtn ? modelBtn.getAttribute('aria-haspopup') : null,
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  report.steps.shotPrices = await screenshot(session, '06-price-panel.png')
  report.steps.modelMenu = await evaluate(session, `(() => {
    const modelBtn = document.querySelector('[aria-label="模型"], [aria-label="Model"]');
    if (!modelBtn) return { ok: false };
    modelBtn.click();
    return {
      ok: true,
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuitems: Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim()).slice(0, 20),
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  await sleep(300)
  report.steps.shotModelMenu = await screenshot(session, '07-price-model-menu.png')

  writeFileSync(path.join(outDir, 'live-report.json'), JSON.stringify(report, null, 2))
  session.close()
  console.log(JSON.stringify({ ok: true, report: path.join(outDir, 'live-report.json') }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
