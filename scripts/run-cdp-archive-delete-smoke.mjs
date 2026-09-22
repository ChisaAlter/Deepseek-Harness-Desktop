#!/usr/bin/env node
/** CDP smoke: archive section visibility + rebuilt delete path symbols on the page. */
const port = Number(process.env.DSH_CDP_PORT || 9333)

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  return pages.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url) && !/boot\.html/i.test(t.url))
    || pages.find((t) => !/boot\.html|devtools/i.test(`${t.url} ${t.title}`))
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
  if (!page) throw new Error('no page target')
  console.log('page', page.url)
  const session = await cdpSession(page.webSocketDebuggerUrl)
  await session.send('Runtime.enable')

  async function evalExpr(expression) {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }

  const probe = await evalExpr(`(() => {
    const text = document.body?.innerText || ''
    const tree = document.querySelector('[role="tree"]')
    const treeText = tree?.innerText || ''
    return {
      href: location.href,
      bodyHasArchived: /已归档|Archived/.test(text),
      treeHasArchived: /已归档|Archived/.test(treeText),
      treeLabels: Array.from(document.querySelectorAll('[role="treeitem"]'))
        .map((el) => (el.innerText || '').split('\\n')[0].trim())
        .filter(Boolean)
        .slice(0, 30),
    }
  })()`)
  console.log('probe', JSON.stringify(probe, null, 2))

  // Toggle showArchivedList off via localStorage store key, then reload and assert no 已归档.
  await evalExpr(`(() => {
    const key = 'dsh.workspace.view.v6'
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    if (parsed && parsed.state && typeof parsed.state === 'object') {
      localStorage.setItem(key, JSON.stringify({
        ...parsed,
        state: { ...parsed.state, showArchivedList: false, archivedExpanded: false },
      }))
    } else {
      localStorage.setItem(key, JSON.stringify({ ...parsed, showArchivedList: false, archivedExpanded: false }))
    }
    return localStorage.getItem(key)
  })()`)

  await session.send('Page.reload', { ignoreCache: true })
  await new Promise((r) => setTimeout(r, 4000))

  const afterOff = await evalExpr(`(() => {
    const tree = document.querySelector('[role="tree"]')
    const treeText = tree?.innerText || ''
    return {
      treeHasArchived: /已归档|Archived/.test(treeText),
      treeLabels: Array.from(document.querySelectorAll('[role="treeitem"]'))
        .map((el) => (el.innerText || '').split('\\n')[0].trim())
        .filter(Boolean)
        .slice(0, 30),
    }
  })()`)
  console.log('after showArchivedList=false', JSON.stringify(afterOff, null, 2))

  // Restore toggle on for the user.
  await evalExpr(`(() => {
    const key = 'dsh.workspace.view.v6'
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    if (parsed && parsed.state && typeof parsed.state === 'object') {
      localStorage.setItem(key, JSON.stringify({
        ...parsed,
        state: { ...parsed.state, showArchivedList: true },
      }))
    } else {
      localStorage.setItem(key, JSON.stringify({ ...parsed, showArchivedList: true }))
    }
    return true
  })()`)

  if (afterOff.treeHasArchived) {
    throw new Error('P7 fail: tree still shows Archived after showArchivedList=false')
  }
  console.log('OK: toggle-off hides archived section')
  session.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
