#!/usr/bin/env node
/** Whale settings rename — real clicks, custom dropdown, verify via catalog RPC. */
import { writeFileSync } from 'node:fs'
const port = Number(process.env.DSH_CDP_PORT || 9333)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(t.url))
if (!page) { console.error('no harness page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id).res(msg.result ?? msg.error); pending.delete(msg.id) } })
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`/tmp/whale-${name}.png`, Buffer.from(s.data, 'base64')) }
const panelJs = `( () => [...document.querySelectorAll('.laAamG_panel')].find(e => e.isConnected) )() `

// 1) ensure panel + whale section
let open = await evalJs(`!!${panelJs}`)
if (!open) {
  const pt = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '设置'); const r = b.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
  await clickAt(pt.x, pt.y)
  for (let i = 0; i < 15; i++) { await sleep(300); open = await evalJs(`!!${panelJs}`); if (open) break }
}
const whale = await evalJs(`(() => { const c = [...document.querySelectorAll('.laAamG_navCell')].find(x => x.textContent.trim().includes('鲸鱼')); if (!c) return null; const r = c.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
await clickAt(whale.x, whale.y)
let ready = false
for (let i = 0; i < 15; i++) { await sleep(400); ready = await evalJs(`{ const p = ${panelJs}; p && p.querySelector('.dsh-whale-form') ? true : false }`); if (ready) break }
console.log('section ready:', ready)
if (!ready) { await shot('x-nosection'); process.exit(1) }

// 2) set name via native setter + input event
const nameSet = await evalJs(`(() => {
  const p = ${panelJs};
  const input = [...p.querySelectorAll('input')].find(i => i.type === 'text' && !i.readOnly);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '小蓝');
  input.dispatchEvent(new Event('input', {bubbles:true}));
  input.dispatchEvent(new Event('change', {bubbles:true}));
  return input.value;
})()`)
console.log('name set ->', nameSet)

// 3) personality dropdown: real-click trigger, then pick menu item
const trig = await evalJs(`(() => {
  const p = ${panelJs};
  const fields = [...p.querySelectorAll('.dsh-whale-field')];
  const f = fields.find(x => x.querySelector('label')?.textContent.trim() === '性格');
  const btn = f?.querySelector('button[aria-haspopup=menu]');
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return {x: r.x+r.width/2, y: r.y+r.height/2};
})()`)
console.log('personality trigger at', JSON.stringify(trig))
await clickAt(trig.x, trig.y)
await sleep(700)
// menu items render in a floating layer — search whole document
const items = await evalJs(`[...document.querySelectorAll('[role=menuitem], [role=option], [class*=menu] [class*=item], li')].map(e => { const r = e.getBoundingClientRect(); return {t: (e.textContent||'').trim().slice(0,24), x: r.x+r.width/2, y: r.y+r.height/2, vis: r.width>0 && r.height>0} }).filter(e => e.vis)`)
console.log('menu items:', JSON.stringify(items))
const target = items?.find(i => /傲娇|tsundere/i.test(i.t)) || items?.find(i => /毒|poison/i.test(i.t))
if (target) { await clickAt(target.x, target.y); console.log('picked:', target.t) } else console.log('no menu item matched — keep natural')
await sleep(400)
await shot('3-picked')

// 4) save
const saveAt = await evalJs(`(() => { const p = ${panelJs}; const b = [...p.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '保存'); const r = b.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
await clickAt(saveAt.x, saveAt.y)
await sleep(2200)

// 5) verify
const cat = await evalJs(`fetch('/dsh-whale/catalog', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({type:'client-request', rpcId:'ui-x', method:'catalog', payload:{}})}).then(r => r.json()).then(j => ({name: j?.result?.value?.name, personality: j?.result?.value?.personality}))`)
console.log('catalog:', JSON.stringify(cat))
ws.close()
process.exit(0)
