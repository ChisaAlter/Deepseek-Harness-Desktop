#!/usr/bin/env node
/** Pick whale personality via real UI; verify via catalog RPC. Waits for UI readiness. */
const port = Number(process.env.DSH_CDP_PORT || 9333)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && /^https?:\/\//.test(t.url))
if (!page) { console.error('no page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const send = (m, p = {}) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id) } })
await new Promise((r) => ws.addEventListener('open', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const panelJs = `(() => [...document.querySelectorAll('.laAamG_panel')].find(e => e.isConnected))()`

// wait for UI
let ui = false
for (let i = 0; i < 40; i++) {
  ui = await evalJs(`!![...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '设置')`)
  if (ui) break
  await sleep(500)
}
console.log('ui ready:', ui)
if (!ui) process.exit(1)

// open settings
let open = await evalJs(`!!${panelJs}`)
if (!open) {
  const pt = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '设置'); const r = b.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
  await clickAt(pt.x, pt.y)
  for (let i = 0; i < 15; i++) { await sleep(300); open = await evalJs(`!!${panelJs}`); if (open) break }
}
console.log('panel:', open)

// whale nav → section
const whale = await evalJs(`(() => { const c = [...document.querySelectorAll('.laAamG_navCell')].find(x => x.textContent.trim().includes('鲸鱼')); if (!c) return null; const r = c.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
if (!whale) { console.error('no whale nav'); process.exit(1) }
await clickAt(whale.x, whale.y)
let ready = false
for (let i = 0; i < 15; i++) { await sleep(400); ready = await evalJs(`{ const p = ${panelJs}; !!(p && p.querySelector('.dsh-whale-form')) }`); if (ready) break }
console.log('section:', ready)

// check trigger label (fix check: should be translated 软萌, not raw "natural")
const trigLabel = await evalJs(`(() => { const p = ${panelJs}; const f = [...p.querySelectorAll('.dsh-whale-field')].find(x => x.querySelector('label')?.textContent.trim() === '性格'); return f?.querySelector('button[aria-haspopup=menu]')?.textContent.trim() })()`)
console.log('trigger label:', JSON.stringify(trigLabel))

// open dropdown + pick 傲娇
const trig = await evalJs(`(() => { const p = ${panelJs}; const f = [...p.querySelectorAll('.dsh-whale-field')].find(x => x.querySelector('label')?.textContent.trim() === '性格'); const btn = f?.querySelector('button[aria-haspopup=menu]'); const r = btn.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
await clickAt(trig.x, trig.y)
await sleep(800)
const item = await evalJs(`(() => { const m = [...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.trim() === '傲娇'); if (!m) return null; const r = m.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
console.log('menuitem:', JSON.stringify(item))
if (item) await clickAt(item.x, item.y)
await sleep(600)
const trig2 = await evalJs(`(() => { const p = ${panelJs}; const f = [...p.querySelectorAll('.dsh-whale-field')].find(x => x.querySelector('label')?.textContent.trim() === '性格'); return f?.querySelector('button[aria-haspopup=menu]')?.textContent.trim() })()`)
console.log('trigger after:', JSON.stringify(trig2))

// save + verify
const saveAt = await evalJs(`(() => { const p = ${panelJs}; const b = [...p.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '保存'); const r = b.getBoundingClientRect(); return {x: r.x+r.width/2, y: r.y+r.height/2} })()`)
await clickAt(saveAt.x, saveAt.y)
await sleep(2200)
const cat = await evalJs(`fetch('/dsh-whale/catalog', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({type:'client-request', rpcId:'ui-x', method:'catalog', payload:{}})}).then(r => r.json()).then(j => ({name: j?.result?.value?.name, personality: j?.result?.value?.personality}))`)
console.log('catalog:', JSON.stringify(cat))
process.exit(0)
