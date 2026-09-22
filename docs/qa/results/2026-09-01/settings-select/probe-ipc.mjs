const res = await fetch('http://127.0.0.1:9229/json/list')
const targets = await res.json()
console.log(JSON.stringify(targets.map((t) => ({ title: t.title, url: t.url, type: t.type })), null, 2))
const t = targets[0]
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) {
    const wait = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) wait.reject(new Error(JSON.stringify(msg.error)))
    else wait.resolve(msg.result)
  }
})
function send(method, params = {}) {
  const next = ++id
  const p = new Promise((resolve, reject) => {
    pending.set(next, { resolve, reject })
    setTimeout(() => {
      if (pending.has(next)) {
        pending.delete(next)
        reject(new Error(`timeout ${method}`))
      }
    }, 20_000)
  })
  ws.send(JSON.stringify({ id: next, method, params }))
  return p
}
await send('Runtime.enable')
await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
const dest = 'c:/Ai/Deepseek-Harness-Desktop/docs/qa/results/2026-09-01/settings-select/00-launcher.png'
fs.writeFileSync(dest, Buffer.from(shot.data, 'base64'))
console.log('wrote', dest)
const ev = await send('Runtime.evaluate', {
  expression: `Promise.race([
    window.shell.launcherStatus().then((s) => ({ ok: true, version: s && s.version, desktop: s && s.desktop && s.desktop.state })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'ipc-timeout' }), 4000))
  ])`,
  awaitPromise: true,
  returnByValue: true,
})
console.log(JSON.stringify(ev, null, 2))
ws.close()
