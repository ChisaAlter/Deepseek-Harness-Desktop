import http from 'node:http'

const port = 9470
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.n = 0
    this.pending = new Map()
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id == null) return
      const job = this.pending.get(msg.id)
      if (!job) return
      this.pending.delete(msg.id)
      msg.error ? job.reject(new Error(msg.error.message)) : job.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.n
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'eval failed')
    return result.result?.value
  }
}

const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
const launcher = targets.find((row) => /launcher\.html/i.test(row.url || ''))
if (!launcher) throw new Error('no launcher')
const cdp = new Cdp(launcher.webSocketDebuggerUrl)
await cdp.connect()
await cdp.send('Runtime.enable')

const sample = () => cdp.eval(`Promise.all([
  window.shell.launcherStatus(),
  Promise.resolve({
    btn: (document.getElementById('btn-start') || {}).textContent,
    home: (document.getElementById('home-status') || {}).textContent,
    hint: (document.getElementById('hint') || {}).textContent,
  }),
]).then(([status, ui]) => ({ state: status.desktop?.state, ...ui }))`)

console.log('before', await sample())
await cdp.eval(`document.getElementById('btn-start').click()`)
for (let i = 0; i < 45; i += 1) {
  await sleep(1000)
  const row = await sample()
  console.log(`t+${i}`, row.state, row.btn, row.home.slice(0, 50))
  if ((row.state === 'idle' || row.state === 'stopped' || /未运行/.test(row.home)) && /启动桌面端/.test(row.btn)) {
    console.log('STOP PASS')
    break
  }
}
const urls = (await httpJson(`http://127.0.0.1:${port}/json/list`)).map((row) => row.url).filter((url) => !/devtools/i.test(url))
console.log('urls', urls.join(' | '))
