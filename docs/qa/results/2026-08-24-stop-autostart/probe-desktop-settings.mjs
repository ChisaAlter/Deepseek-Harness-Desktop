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
const harness = targets.find((t) => /^http:\/\/127\.0\.0\.1:\d+\/?$/i.test(t.url || ''))
if (!harness) throw new Error('no harness target')
const cdp = new Cdp(harness.webSocketDebuggerUrl)
await cdp.connect()
await cdp.send('Runtime.enable')

const openGeneral = `
(() => {
  const trigger = document.querySelector('[data-dsh-settings-trigger]');
  if (trigger) trigger.click();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  return wait(800).then(() => {
    const nav = document.querySelector('[data-dsh-settings-section="general"]');
    if (nav) nav.click();
    return wait(600);
  }).then(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.innerText || document.body.innerText || '';
    return {
      hasDialog: Boolean(dialog),
      hasAutoStartTitle: /启动时|Start behavior/.test(text),
      hasDirectOption: /直接进入桌面端|directly open the desktop/.test(text),
      hasLauncherOption: /先打开启动器|open the launcher first/.test(text),
      snippet: text.split('\\n').filter(l => /启动|launcher|desktop/i.test(l)).slice(0, 8),
    };
  });
})()
`

console.log(JSON.stringify(await cdp.eval(openGeneral), null, 2))
