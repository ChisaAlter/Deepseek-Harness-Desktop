#!/usr/bin/env node
const port = Number(process.env.DSH_CDP_PORT || 9333)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && /3080/.test(t.url))
if (!page) throw new Error('no page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 1
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(JSON.stringify(m.error)))
    else res(m.result)
  }
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = id++
  pending.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method, params }))
})
await send('Runtime.enable')
const evalExpr = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

// Force show on + expanded
await evalExpr(`(() => {
  const key = 'dsh.workspace.view.v6'
  const raw = localStorage.getItem(key)
  const p = raw ? JSON.parse(raw) : {}
  if (p.state && typeof p.state === 'object') {
    p.state.showArchivedList = true
    p.state.archivedExpanded = true
    localStorage.setItem(key, JSON.stringify(p))
  } else {
    localStorage.setItem(key, JSON.stringify({
      ...p,
      showArchivedList: true,
      archivedExpanded: true,
    }))
  }
  return localStorage.getItem(key)
})()`)
await send('Page.reload', { ignoreCache: true })
await new Promise((r) => setTimeout(r, 4500))

const v = await evalExpr(`(() => ({
  ls: localStorage.getItem('dsh.workspace.view.v6'),
  treeHasArchived: (document.querySelector('[role="tree"]')?.innerText || '').includes('已归档'),
  labels: Array.from(document.querySelectorAll('[role="treeitem"]'))
    .map((el) => (el.innerText || '').split('\\n')[0].trim()).slice(0, 40),
}))()`)
console.log(JSON.stringify(v, null, 2))
ws.close()
