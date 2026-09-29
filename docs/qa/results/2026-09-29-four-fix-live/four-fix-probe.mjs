#!/usr/bin/env node
/**
 * Read-only CDP probe for the four 2026-09-29 fixes.
 * Attaches to the isolated source desktop (default port 9333) and reports:
 *  - agent preset roster (whale-girl must be absent) from the real mode picker
 *  - remote/home directory picker state exposed by the real plugin bundle
 * Does not type into the app or touch user data.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.DSH_CDP_PORT || 9333)
const outDir = process.env.DSHD_QA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated')
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`timeout ${method}`)) }, 30000)
          pending.set(id, {
            res: (v) => { clearTimeout(timer); res(v) },
            rej: (e) => { clearTimeout(timer); rej(e) },
          })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* ignore */ } },
    }))
    ws.addEventListener('error', (err) => reject(err))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      const job = msg.id != null ? pending.get(msg.id) : null
      if (!job) return
      pending.delete(msg.id)
      if (msg.error) job.rej(new Error(JSON.stringify(msg.error)))
      else job.res(msg.result)
    })
  })
}

async function main() {
  const targets = await listTargets()
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const harness = pages.find((t) => /127\.0\.0\.1:3197/.test(t.url || '')) || pages.find((t) => /^https?:/.test(t.url || ''))
  if (!harness) throw new Error(`no harness page; pages=${JSON.stringify(pages.map((p) => p.url))}`)

  const cdp = await connect(harness.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  async function ev(expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }

  // Wait for the client to finish mounting.
  for (let i = 0; i < 120; i++) {
    const ready = await ev(`Boolean(document.querySelector('[data-dsh-settings-trigger]')) || Boolean(document.querySelector('[data-dsh-remote-trigger]')) || document.body.innerText.length > 0`)
    if (ready) break
    await sleep(500)
  }

  const baseline = await ev(`(() => ({
    url: location.href,
    title: document.title,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
    hasWhaleString: document.body.innerText.includes('鲸鱼娘'),
    presetChips: [...document.querySelectorAll('[data-dsh-agent-preset], [class*="preset" i]')].map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 40),
    buttons: [...document.querySelectorAll('button,[role="button"]')].map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 60),
    dataAttrs: [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((n) => n.startsWith('data-dsh-')).filter((v, i, a) => a.indexOf(v) === i).sort(),
  }))()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(path.join(outDir, 'four-fix-baseline.png'), Buffer.from(shot.data, 'base64'))

  // 1) Real agent-preset picker: whale-girl must not be offered.
  const presetPicker = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const textOf = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button,[role="button"],[role="combobox"]')]
      .filter((el) => /模式$/.test(textOf(el)) || /^(标准模式|Standard)/.test(textOf(el)));
    const chip = candidates[0] || null;
    if (!chip) return { found: false, candidates: candidates.map(textOf) };
    const before = { chipText: textOf(chip), chipRect: chip.getBoundingClientRect().toJSON() };
    chip.click();
    await sleep(350);
    const menuNodes = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]')]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    const items = menuNodes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"],[role="option"],button,[role="button"]')]
      .map((el) => textOf(el)).filter(Boolean));
    const allText = menuNodes.map((el) => textOf(el)).join(' | ');
    const whale = /鲸鱼娘|whale-girl|Whale Assistant/i.test(allText);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return { found: true, before, items: [...new Set(items)].slice(0, 60), menuText: allText.slice(0, 1500), whaleVisible: whale };
  })()`)

  // 2) Real workspace picker: local -> remote tab layout and affordances.
  const workspacePicker = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const textOf = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const all = [...document.querySelectorAll('button,[role="button"]')];
    const exactWorkspace = all.find((el) => textOf(el) === '工作区');
    const namedWorkspace = all.find((el) => /Deep[e ]*eek-Harne[e ]*-De[e ]*ktop|Deepseek-Harness-Desktop/i.test(textOf(el)) && !/新会话/.test(textOf(el)));
    const trigger = exactWorkspace || namedWorkspace;
    if (!trigger) return { found: false, buttons: all.map(textOf).slice(0, 80) };
    const triggerText = textOf(trigger);
    trigger.click();
    await sleep(400);
    const addItem = [...document.querySelectorAll('button,[role="menuitem"],[role="button"]')]
      .find((el) => /添加工作区|Add workspace/i.test(textOf(el)));
    if (addItem) {
      addItem.click();
      await sleep(900);
    }
    const remoteTab = [...document.querySelectorAll('button,[role="tab"],[role="button"]')].find((el) => {
      const t = textOf(el);
      return t === '远程' || t === 'Remote';
    });
    const beforeRemote = {
      dialogVisible: document.querySelectorAll('[role="dialog"],[role="menu"]').length > 0,
      dialogTabs: [...document.querySelectorAll('[role="tab"]')].map(textOf).filter(Boolean),
      remoteTabText: remoteTab ? textOf(remoteTab) : '',
    };
    if (remoteTab) {
      remoteTab.click();
      await sleep(900);
    }
    const root = document.querySelector('.dshr-flow');
    const content = document.querySelector('.dshr-flowContent');
    const footer = document.querySelector('.dshr-flowFooter');
    const cancel = [...document.querySelectorAll('button')].find((el) => /取消|Cancel/.test(textOf(el)));
    const tabRects = [...document.querySelectorAll('[role="tab"]')].map((el) => ({ text: textOf(el), rect: el.getBoundingClientRect().toJSON() }));
    const style = (el) => el ? {
      rect: el.getBoundingClientRect().toJSON(),
      padding: getComputedStyle(el).padding,
      overflow: getComputedStyle(el).overflow,
      display: getComputedStyle(el).display,
    } : null;
    const result = {
      found: true,
      triggerText,
      beforeRemote,
      remoteTabClicked: Boolean(remoteTab),
      errorState: root && /失败/.test(textOf(root)) ? 'error-visible' : 'ok',
      root: style(root),
      content: style(content),
      footer: style(footer),
      cancel: cancel ? { text: textOf(cancel), rect: cancel.getBoundingClientRect().toJSON() } : null,
      tabRects,
    };
    return result;
  })()`)

  const remoteShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(path.join(outDir, 'four-fix-remote-picker.png'), Buffer.from(remoteShot.data, 'base64'))
  await ev(`(() => {
    const cancel = [...document.querySelectorAll('button')].find((el) => /取消|Cancel/.test(el.textContent || ''));
    if (cancel) cancel.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`)

  const report = {
    at: new Date().toISOString(),
    harnessUrl: harness.url,
    baseline,
    presetPicker,
    workspacePicker,
    checks: {
      whalePresetHidden: presetPicker.found === true && presetPicker.whaleVisible === false,
      remotePickerRendered: workspacePicker.found === true && workspacePicker.remoteTabClicked === true,
      remotePickerCancelVisible: Boolean(workspacePicker.cancel),
      remoteContentPadded: Boolean(workspacePicker.content && workspacePicker.content.padding && workspacePicker.content.padding !== '0px'),
      remoteFooterSeparated: Boolean(workspacePicker.footer),
    },
    notes: [],
  }
  writeFileSync(path.join(outDir, 'four-fix-probe.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
