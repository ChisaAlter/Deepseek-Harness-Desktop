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
  return { send, close() { try { ws.close() } catch { /* ignore */ } } }
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

async function screenshot(session, name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  const dest = path.join(outDir, name)
  writeFileSync(dest, Buffer.from(shot.data, 'base64'))
  return dest
}

async function main() {
  const targets = await jsonList()
  const harness = targets.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url || ''))
  if (!harness) throw new Error('no harness')
  const session = cdpSession(harness.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  await session.send('Page.enable')

  const opened = await evaluate(session, `(() => {
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
  })()`)
  await sleep(700)

  const probe = await evaluate(session, `(() => {
    const sw = document.querySelector('[role="switch"][aria-label="Enable auto-restart"], [role="switch"][aria-label="启用自动恢复"]');
    const labels = Array.from(document.querySelectorAll('[role="switch"]')).map((el) => el.getAttribute('aria-label'));
    return {
      opened: ${JSON.stringify(opened)} === undefined ? null : true,
      switchRole: sw ? sw.getAttribute('role') : null,
      switchChecked: sw ? sw.checked : null,
      switchLabels: labels,
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)

  const clicked = await evaluate(session, `(() => {
    const sw = document.querySelector('[role="switch"][aria-label="Enable auto-restart"], [role="switch"][aria-label="启用自动恢复"]');
    if (!sw) return { ok: false };
    const before = sw.checked;
    sw.click();
    return {
      ok: true,
      before,
      after: sw.checked,
      role: sw.getAttribute('role'),
      savingText: /正在保存|Saving settings|Saving/.test(document.body.innerText || ''),
    };
  })()`)
  const shotSwitch = await screenshot(session, '02-general-switch-clicked.png')
  await sleep(200)
  const after = await evaluate(session, `(() => {
    const sw = document.querySelector('[role="switch"][aria-label="Enable auto-restart"], [role="switch"][aria-label="启用自动恢复"]');
    return {
      checked: sw ? sw.checked : null,
      role: sw ? sw.getAttribute('role') : null,
      savingText: /正在保存|Saving settings|Saving…|Saving/.test(document.body.innerText || ''),
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  const shotSettled = await screenshot(session, '03-general-switch-settled.png')
  if (clicked?.ok && clicked.before !== clicked.after) {
    await evaluate(session, `document.querySelector('[role="switch"][aria-label="Enable auto-restart"], [role="switch"][aria-label="启用自动恢复"]').click(); true`)
    await sleep(200)
  }

  const iface = await evaluate(session, `(() => {
    const nav = document.querySelector('[data-dsh-settings-section="interface"]');
    if (!nav) return false;
    nav.click();
    return true;
  })()`)
  await sleep(500)
  const shotIface = await screenshot(session, '05-interface-session-cost.png')
  const prices = await evaluate(session, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((el) =>
      /设置模型价格|Set model prices/.test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
    if (!btn) {
      return { ok: false, buttons: Array.from(document.querySelectorAll('button')).map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 40) };
    }
    btn.click();
    return { ok: true, label: (btn.textContent || '').trim() };
  })()`)
  await sleep(500)
  const shotPrices = await screenshot(session, '06-price-panel.png')
  const model = await evaluate(session, `(() => {
    const modelBtn = document.querySelector('button[aria-label="模型"], button[aria-label="Model"]');
    if (!modelBtn) {
      return {
        ok: false,
        nativeSelectCount: document.querySelectorAll('select').length,
        popups: Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).map((el) => el.getAttribute('aria-label')),
      };
    }
    modelBtn.click();
    return {
      ok: true,
      tag: modelBtn.tagName,
      hasPopup: modelBtn.getAttribute('aria-haspopup'),
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuitems: Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim()).slice(0, 24),
      nativeSelectCount: document.querySelectorAll('select').length,
    };
  })()`)
  await sleep(300)
  const shotMenu = await screenshot(session, '07-price-model-menu.png')

  const report = {
    probe, clicked, after, shotSwitch, shotSettled, iface, shotIface, prices, shotPrices, model, shotMenu,
  }
  writeFileSync(path.join(outDir, 'live-report-2.json'), JSON.stringify(report, null, 2))
  session.close()
  console.log(JSON.stringify({ ok: true, clicked, after, iface, pricesOk: prices?.ok, modelOk: model?.ok, native: model?.nativeSelectCount }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
