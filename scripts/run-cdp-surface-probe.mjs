#!/usr/bin/env node
/**
 * Quick CDP probe against a packaged/source Electron instance started with
 * --remote-debugging-port. Verifies terminal drawer + surface tabs manually.
 *
 * Env: DSH_CDP_PORT (default 9333), DSH_CDP_OUT optional JSON path
 */
import { writeFileSync } from 'node:fs'

const port = Number(process.env.DSH_CDP_PORT || 9333)
const outPath = process.env.DSH_CDP_OUT || ''

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const harness = pages.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url))
    || pages.find((t) => /dsh|harness/i.test(`${t.url} ${t.title}`) && !/boot\.html/i.test(t.url))
    || pages.find((t) => !/boot\.html|devtools/i.test(`${t.url} ${t.title}`))
    || pages[0]
  if (!harness) throw new Error(`no page target in ${JSON.stringify(targets.map((t) => t.url))}`)
  return harness
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      ws,
      send(method, params = {}) {
        const id = nextId++
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* ignore */ } },
    }))
    ws.addEventListener('error', (err) => reject(err))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function main() {
  const targets = await listTargets()
  const page = pickPage(targets)
  const session = await cdpSession(page.webSocketDebuggerUrl)
  await session.send('Runtime.enable')

  async function evalExpr(expression) {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails))
    }
    return result.result?.value
  }

  const before = await evalExpr(`(() => ({
    url: location.href,
    hasFrame: Boolean(document.querySelector('[class*="frame"]')),
    terminalOpen: Boolean(document.querySelector('[class*="terminal"], [data-terminal], .xterm')),
    surfaceTabs: Array.from(document.querySelectorAll('[role="tab"]')).map(el => (el.textContent||'').trim()).filter(Boolean).slice(0,20),
  }))()`)

  // Click titlebar terminal toggle by aria-label
  const clickedTerminal = await evalExpr(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const el = btns.find(b => /terminal|终端/i.test((b.getAttribute('aria-label')||'') + (b.textContent||'')));
    if (!el) return { ok:false, reason:'no button' };
    el.click();
    return { ok:true, label: (el.getAttribute('aria-label')||el.textContent||'').trim() };
  })()`)

  await new Promise((r) => setTimeout(r, 1500))
  const afterTerminal = await evalExpr(`(() => ({
    xterm: Boolean(document.querySelector('.xterm')),
    terminalish: Boolean(document.querySelector('[class*="terminal"], [class*="Terminal"]')),
    bodyTextHasEcho: /dshd|终端|Terminal/i.test(document.body.innerText||''),
  }))()`)

  // Open surfaces then try Diff / Browser / Agents cards or tabs
  const surfaces = await evalExpr(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const el = btns.find(b => /surfaces|右侧|right panel/i.test((b.getAttribute('aria-label')||'') + (b.textContent||'')));
    if (el) el.click();
    return { clicked: Boolean(el) };
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  async function clickText(reSource) {
    return evalExpr(`(() => {
      const re = ${reSource};
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a, div, span'));
      const el = nodes.find(n => re.test((n.textContent||'').trim()) && n.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.click();
      return true;
    })()`)
  }

  const clickedDiff = await clickText('/差异|Diff/i')
  await new Promise((r) => setTimeout(r, 800))
  const diffState = await evalExpr(`(() => ({
    hasDiff: /diff|变更|暂无|no changes|git/i.test(document.body.innerText||''),
  }))()`)

  const clickedBrowser = await clickText('/浏览器|Browser/i')
  await new Promise((r) => setTimeout(r, 800))
  const browserState = await evalExpr(`(() => ({
    hasUrl: Boolean(document.querySelector('input[type="url"], input[placeholder*="http"], input[placeholder*="URL"], input[aria-label*="URL" i]')),
  }))()`)

  const clickedAgents = await clickText('/代理|Agents/i')
  await new Promise((r) => setTimeout(r, 800))
  const agentsState = await evalExpr(`(() => ({
    textHit: /代理|agent|暂无|empty|运行/i.test(document.body.innerText||''),
  }))()`)

  const result = {
    ok: Boolean(clickedTerminal?.ok) && (afterTerminal.xterm || afterTerminal.terminalish),
    pageUrl: page.url,
    before,
    clickedTerminal,
    afterTerminal,
    surfaces,
    clickedDiff,
    diffState,
    clickedBrowser,
    browserState,
    clickedAgents,
    agentsState,
  }
  console.log(JSON.stringify(result, null, 2))
  if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2))
  session.close()
  process.exit(result.ok ? 0 : 1)
}

main().catch((error) => {
  console.error(String(error))
  process.exit(2)
})
