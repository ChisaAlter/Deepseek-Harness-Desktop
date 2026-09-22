const res = await fetch('http://127.0.0.1:9229/json/list')
const targets = await res.json()
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
  const p = new Promise((resolve, reject) => pending.set(next, { resolve, reject }))
  ws.send(JSON.stringify({ id: next, method, params }))
  return p
}
await send('Runtime.enable')
const ev = await send('Runtime.evaluate', {
  expression: `({
    hasShell: typeof window.shell,
    keys: window.shell ? Object.keys(window.shell).slice(0, 30) : [],
    argv: String((window.process && window.process.argv) || 'no-process'),
    readyState: document.readyState,
  })`,
  returnByValue: true,
})
console.log(JSON.stringify(ev, null, 2))
ws.close()
