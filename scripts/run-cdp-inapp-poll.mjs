#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

const port = Number(process.env.DSH_CDP_PORT || 9333)
const outPath = process.env.DSH_CDP_OUT || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && /^https?:\/\/127\.0\.0\.1/.test(t.url))
  if (!page) throw new Error('no harness page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let id = 1
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(JSON.stringify(msg.error)))
      else res(msg.result)
    }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = id++
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  let last = null
  for (let i = 0; i < 60; i += 1) {
    last = await ev(`(() => {
      const t = document.body.innerText || '';
      return {
        hasConn: /已连通/.test(t),
        hasGhostty: /libghostty-vt/.test(t),
        hasTool: /Workspace Write|bash|Read|工具/.test(t),
        hasHigh: /\\bHigh\\b|思考/.test(t),
        tail: t.slice(-1500),
      };
    })()`)
    console.log(JSON.stringify({ i, hasConn: last.hasConn, hasGhostty: last.hasGhostty, hasTool: last.hasTool }))
    if (last.hasConn) break
    await sleep(3000)
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(last, null, 2))
  console.log(last?.tail || '')
  ws.close()
  process.exit(last?.hasConn ? 0 : 1)
}

main().catch((e) => { console.error(String(e)); process.exit(2) })
