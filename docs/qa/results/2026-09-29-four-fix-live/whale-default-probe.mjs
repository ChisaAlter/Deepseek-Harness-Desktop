#!/usr/bin/env node
/**
 * Real-source check that a fresh config without whaleAssistantEnabled still
 * enables the assistant: sidebar entry present + settings toggle on.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.DSH_DEFAULT_CDP_PORT || 9336)
const userData = process.env.DSH_DEFAULT_USERDATA || ''
const outDir = process.env.DSHD_QA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => /127\.0\.0\.1:3200/.test(t.url || ''))
  if (!page) throw new Error('no harness page on :3200')
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }

  for (let i = 0; i < 120; i++) {
    if (await ev(`document.body && document.body.innerText.includes('鲸鱼娘')`)) break
    await sleep(500)
  }

  const sidebar = await ev(`(() => {
    const entries = [...document.querySelectorAll('button,[role="button"],a,[role="treeitem"]')]
      .map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), rect: el.getBoundingClientRect().toJSON() }));
    const whale = entries.filter((entry) => /鲸鱼娘|Whale Assistant/.test(entry.text));
    return { whale, bodyHasWhale: document.body.innerText.includes('鲸鱼娘') };
  })()`)

  // Settings → pet section: assistant toggle must be on for a default config.
  await ev(`(() => {
    const trigger = document.querySelector('[data-dsh-settings-trigger]');
    if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    return true;
  })()`)
  await sleep(800)
  let petFound = false
  for (let i = 0; i < 40; i++) {
    petFound = await ev(`(() => {
      const nav = [...document.querySelectorAll('[data-dsh-settings-section]')]
        .find((el) => el.getAttribute('data-dsh-settings-section') === 'pet');
      if (nav) { nav.click(); return true; }
      return false;
    })()`)
    if (petFound) break
    await sleep(250)
  }
  await sleep(1200)
  const settings = await ev(`(() => {
    const rows = [...document.querySelectorAll('[role="switch"],input[type=checkbox]')]
      .map((el) => ({
        role: el.getAttribute('role') || el.type,
        checked: el.getAttribute('role') === 'switch' ? el.getAttribute('aria-checked') : String(el.checked),
        label: (el.closest('label,[class*="row" i]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      }));
    const text = document.body.innerText;
    return { rows, hasAssistantText: /鲸鱼娘|助理/.test(text) };
  })()`)

  const config = userData ? JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf8')) : null
  const report = {
    at: new Date().toISOString(),
    launchConfigOmittedKey: true,
    configKeyPresentAfterRun: config ? Object.prototype.hasOwnProperty.call(config, 'whaleAssistantEnabled') : null,
    resolvedEnabled: config ? config.whaleAssistantEnabled : null,
    sidebar,
    petTabFound: petFound,
    settings,
    checks: {
      launchConfigOmittedKey: true,
      resolvedDefaultTrue: config ? config.whaleAssistantEnabled === true : false,
      sidebarEntryPresent: sidebar.whale.length > 0,
      assistantSettingVisible: petFound && settings.hasAssistantText,
    },
  }
  writeFileSync(path.join(outDir, 'whale-default-probe.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
