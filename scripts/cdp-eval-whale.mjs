#!/usr/bin/env node
/** One-off CDP driver: evaluate an expression in the live harness page. */
const port = Number(process.env.DSH_CDP_PORT || 9333)
const expr = process.argv[2]
if (!expr) { console.error('usage: cdp-eval-whale.mjs "<expr>"'); process.exit(2) }

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(t.url))
  || targets.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id).res(msg.result ?? msg.error); pending.delete(msg.id) }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const result = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(result?.result?.value ?? result, null, 1))
ws.close()
process.exit(0)
