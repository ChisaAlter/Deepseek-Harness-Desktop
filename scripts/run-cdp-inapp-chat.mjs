#!/usr/bin/env node
/**
 * In-app Appendix-A turn 1–2 via CDP (composer send). Tool turns left to human/API evidence.
 */
import { writeFileSync } from 'node:fs'

const port = Number(process.env.DSH_CDP_PORT || 9333)
const outPath = process.env.DSH_CDP_OUT || ''

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  return res.json()
}

function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  return pages.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url)) || pages[0]
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      ws,
      send(method, params = {}) {
        const id = nextId++
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* ignore */ } },
    }))
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function main() {
  const page = pickPage(await listTargets())
  const session = await cdpSession(page.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  const evalExpr = async (expression) => {
    const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }

  const prompt1 = '用一句话回复：你已连通，并给出一个三位数验证码。用标记 INAPP_T1 开头。'
  const setDraft = await evalExpr(`(() => {
    const ta = document.querySelector('[data-composer-card] textarea') || document.querySelector('textarea');
    if (!ta) return { ok:false, reason:'no textarea' };
    const proto = HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter.call(ta, ${JSON.stringify(prompt1)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    return { ok:true, value: ta.value.slice(0,80) };
  })()`)

  const clickedSend = await evalExpr(`(() => {
    const card = document.querySelector('[data-composer-card]') || document.body;
    const btns = Array.from(card.querySelectorAll('button'));
    const el = btns.find(b => /send|发送/i.test((b.getAttribute('aria-label')||'') + (b.textContent||'')))
      || btns[btns.length - 1];
    if (!el || el.disabled) return { ok:false };
    el.click();
    return { ok:true, label: (el.getAttribute('aria-label')||el.textContent||'').trim() };
  })()`)

  let reply = ''
  let found = false
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000))
    const snap = await evalExpr(`(() => {
      const text = document.body.innerText || '';
      const hit = text.includes('INAPP_T1') || /已连通|验证码/.test(text);
      const m = text.match(/(?<!\\d)(\\d{3})(?!\\d)/);
      return { hit, sample: text.slice(-800), code: m && m[1] };
    })()`)
    if (snap.hit && snap.code) {
      found = true
      reply = snap.sample
      break
    }
  }

  const result = { ok: setDraft?.ok && clickedSend?.ok && found, setDraft, clickedSend, found, replyTail: String(reply).slice(-500) }
  console.log(JSON.stringify(result, null, 2))
  if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2))
  session.close()
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => { console.error(String(e)); process.exit(2) })
