#!/usr/bin/env node
/** Read the resolved config through the real preload IPC bridge. */
const port = Number(process.env.DSH_DEFAULT_CDP_PORT || 9336)
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
          const timer = setTimeout(() => { pending.delete(reqId); rej(new Error(`timeout ${method}`)) }, 20000)
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
  if (!page) throw new Error('harness page not found')
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 60; i++) {
    const probe = await cdp.send('Runtime.evaluate', { expression: `Boolean(window.shell && window.shell.getConfig)`, returnByValue: true })
    if (probe.result?.value) break
    await sleep(300)
  }
  const result = await cdp.send('Runtime.evaluate', {
    expression: `window.shell.getConfig().then((cfg) => ({
      whaleAssistantEnabled: cfg.whaleAssistantEnabled,
      keys: Object.keys(cfg).filter((k) => /whale/i.test(k)),
    }))`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result.result.value }, null, 2))
  cdp.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
