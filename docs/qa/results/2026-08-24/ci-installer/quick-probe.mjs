#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'

const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Deepseek-Harness-Desktop', 'Deepseek-Harness-Desktop.exe')
const port = 9473

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore' })
await sleep(2000)
spawn(exe, [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'])

let wsUrl
for (let i = 0; i < 60; i += 1) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => [])
  const launcher = targets.find((row) => /launcher\.html/i.test(row.url || ''))
  if (launcher?.webSocketDebuggerUrl) {
    wsUrl = launcher.webSocketDebuggerUrl
    break
  }
  await sleep(500)
}
if (!wsUrl) {
  console.error('no launcher target')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id == null) return
  const job = pending.get(msg.id)
  if (!job) return
  pending.delete(msg.id)
  msg.error ? job.reject(new Error(msg.error.message)) : job.resolve(msg.result)
})
function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalExpr(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
console.log('btn', await evalExpr("document.getElementById('btn-start')?.textContent || ''"))
console.log('status', await evalExpr('window.shell?.launcherStatus?.()'))
console.log('urls', (await httpJson(`http://127.0.0.1:${port}/json/list`)).map((row) => row.url))
spawnSync('taskkill', ['/IM', 'Deepseek-Harness-Desktop.exe', '/F'], { stdio: 'ignore' })
