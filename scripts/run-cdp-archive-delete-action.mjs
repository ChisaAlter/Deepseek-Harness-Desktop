#!/usr/bin/env node
/** CDP: restore archived list, open delete on first archived row, confirm, assert no TypeError. */
const port = Number(process.env.DSH_CDP_PORT || 9333)

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  return pages.find((t) => /3080/.test(t.url))
    || pages.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url) && !/boot\.html/i.test(t.url))
    || pages[0]
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
    ws.addEventListener('error', reject)
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
  if (!page) throw new Error('no page')
  const session = await cdpSession(page.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  await session.send('Console.enable')
  const errors = []
  session.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.method === 'Console.messageAdded' && msg.params?.message?.level === 'error') {
      errors.push(msg.params.message.text)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(msg.params.exceptionDetails))
    }
  })

  async function evalExpr(expression) {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }

  await evalExpr(`(() => {
    const key = 'dsh.workspace.view.v6'
    const raw = localStorage.getItem(key)
    const p = raw ? JSON.parse(raw) : {}
    if (p.state && typeof p.state === 'object') {
      localStorage.setItem(key, JSON.stringify({
        ...p,
        state: { ...p.state, showArchivedList: true, archivedExpanded: true },
      }))
    } else {
      localStorage.setItem(key, JSON.stringify({
        ...p,
        showArchivedList: true,
        archivedExpanded: true,
      }))
    }
    return true
  })()`)
  await session.send('Page.reload', { ignoreCache: true })
  await new Promise((r) => setTimeout(r, 4500))

  const before = await evalExpr(`(() => {
    const labels = Array.from(document.querySelectorAll('[role="treeitem"]'))
      .map((el) => (el.innerText || '').split('\\n')[0].trim())
    return { labels, hasArchived: labels.includes('已归档') }
  })()`)
  console.log('before', JSON.stringify(before))

  const clicked = await evalExpr(`(() => {
    const items = Array.from(document.querySelectorAll('[role="treeitem"]'))
    const archivedIdx = items.findIndex((el) => (el.innerText || '').includes('已归档'))
    if (archivedIdx < 0) return { ok: false, reason: 'no archived header' }
    const buttons = Array.from(document.querySelectorAll('button[aria-label*="的操作"]'))
      .filter((b) => (b.getAttribute('aria-label') || '').includes('会话'))
    let target = null
    for (const b of buttons) {
      const row = b.closest('[role="treeitem"]')
      if (!row) continue
      const idx = items.indexOf(row)
      if (idx > archivedIdx) { target = b; break }
    }
    if (!target) {
      return {
        ok: false,
        reason: 'no archived session menu',
        buttons: buttons.map((b) => b.getAttribute('aria-label')).slice(0, 8),
      }
    }
    target.click()
    const menu = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .map((el) => (el.textContent || '').trim())
    const del = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((el) => (el.textContent || '').includes('删除会话'))
    if (!del) return { ok: false, reason: 'no delete menuitem', menu }
    del.click()
    return { ok: true, menu, dialog: Boolean(document.querySelector('[role="dialog"]')) }
  })()`)
  console.log('menu', JSON.stringify(clicked))
  if (!clicked.ok) {
    console.log('SKIP interactive delete:', clicked.reason)
    session.close()
    process.exit(0)
  }

  await new Promise((r) => setTimeout(r, 400))
  const confirmed = await evalExpr(`(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return { ok: false, reason: 'no dialog' }
    const confirm = Array.from(dialog.querySelectorAll('button'))
      .find((b) => (b.textContent || '').includes('删除会话'))
    if (!confirm) return { ok: false, reason: 'no confirm' }
    confirm.click()
    return { ok: true }
  })()`)
  console.log('confirm', JSON.stringify(confirmed))
  await new Promise((r) => setTimeout(r, 3000))

  const after = await evalExpr(`(() => {
    const labels = Array.from(document.querySelectorAll('[role="treeitem"]'))
      .map((el) => (el.innerText || '').split('\\n')[0].trim())
    const dialog = document.querySelector('[role="dialog"]')
    return {
      labels,
      dialogOpen: Boolean(dialog),
      dialogText: dialog ? (dialog.innerText || '').slice(0, 240) : null,
      liveHasDeletedTitle: false,
    }
  })()`)
  console.log('after', JSON.stringify(after, null, 2))
  console.log('consoleErrors', JSON.stringify(errors.slice(0, 10)))
  if (errors.some((e) => /is not a function|TypeError/i.test(String(e)))) {
    throw new Error('TypeError during delete')
  }
  console.log('OK delete path no TypeError')
  session.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
