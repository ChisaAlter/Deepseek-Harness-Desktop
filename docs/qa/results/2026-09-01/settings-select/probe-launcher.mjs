const res = await fetch('http://127.0.0.1:9229/json/list')
const targets = await res.json()
console.log(JSON.stringify(targets.map((t) => ({ title: t.title, url: t.url, type: t.type })), null, 2))
const t = targets.find((x) => x.url && x.url.includes('launcher.html'))
if (!t) {
  console.log('no launcher')
  process.exit(1)
}
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
const ev = await send('Runtime.evaluate', {
  expression: `({
    start: (document.getElementById('btn-start')||{}).textContent,
    disabled: Boolean((document.getElementById('btn-start')||{}).disabled),
    hint: (document.getElementById('hint')||{}).textContent,
    hintHidden: (document.getElementById('hint')||{}).hidden,
    status: (document.getElementById('home-status')||{}).textContent,
    lede: (document.getElementById('lede')||{}).textContent,
    body: (document.body.innerText||'').slice(0, 1200)
  })`,
  returnByValue: true,
  awaitPromise: true,
})
console.log(JSON.stringify(ev.result.value, null, 2))
const start = ev.result.value?.start || ''
if (/启动桌面端/.test(start) && !ev.result.value.disabled) {
  await send('Runtime.evaluate', {
    expression: "document.getElementById('btn-start').click(); true",
    returnByValue: true,
  })
  console.log('clicked start')
} else {
  console.log('did not click', { start, disabled: ev.result.value?.disabled })
}
ws.close()
