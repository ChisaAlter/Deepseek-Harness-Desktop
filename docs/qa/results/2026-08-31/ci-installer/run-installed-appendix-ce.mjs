#!/usr/bin/env node
/**
 * Appendix A on the installed CI exe against real %APPDATA%.
 * The baked DSH_QA_APPENDIX walker still types into a <textarea>; 0.1.2-alpha.2
 * composer is Lexical [data-composer-input]. This driver uses CDP insertText.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  attachHarness,
  CI_RUN,
  killProduct,
  loadConfig,
  productExe,
  saveConfigPatch,
  SETUP_SHA256,
  sleep,
  spawnInstalled,
  userData,
  waitFor,
  waitForHarnessUrl,
} from './install-qa-lib.mjs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.DSHD_QA_PORT || 9476)
const sibling = process.env.DSH_SMOKE_SIBLING || 'C:\\Ai\\ChisaTerminal'
const prior = loadConfig()

const TURNS = [
  {
    id: 'appendix.turn1.connect',
    prompt: '用一句话回复：你已连通，并给出一个三位数验证码。',
    expect: (text) => /连通/.test(text) && /\b\d{3}\b/.test(text),
  },
  {
    id: 'appendix.turn2.recall',
    prompt: '刚才的验证码是多少？只回答数字。',
    expect: (text, ctx) => (ctx.code ? text.includes(ctx.code) : /\b\d{3}\b/.test(text)),
  },
  {
    id: 'appendix.turn3.readReadme',
    prompt: '阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。',
    expect: (text) => text.trim().length > 0,
    expectTool: true,
  },
  {
    id: 'appendix.turn4.shell',
    prompt: '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
    expect: (text) => text.trim().length > 0,
    expectTool: true,
  },
  {
    id: 'appendix.turn5.summary',
    prompt: '汇总：验证码、产品一句话、目录名各一行。',
    expect: (text, ctx) => Boolean(ctx.code) && text.includes(ctx.code),
  },
]

const SNAPSHOT = `(() => {
  const flow = document.querySelector('[data-chat-flow]');
  const kinds = Array.from(document.querySelectorAll('[data-chat-flow-kind]'))
    .map((el) => el.getAttribute('data-chat-flow-kind') || '')
    .filter(Boolean);
  const assistants = Array.from(document.querySelectorAll(
    '[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]',
  ));
  const last = assistants.at(-1);
  const lastText = last ? (last.innerText || '').slice(0, 1500) : '';
  const input = document.querySelector('[data-composer-input]');
  const card = document.querySelector('[data-composer-card]');
  const send = card && Array.from(card.querySelectorAll('button')).find((el) =>
    /send message|发送消息/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
  const body = (flow && flow.innerText) || '';
  return {
    kinds,
    assistantCount: assistants.length,
    lastText,
    inputText: input ? (input.innerText || '') : '',
    inputEditable: Boolean(input && input.getAttribute('contenteditable') === 'true'),
    sendDisabled: Boolean(send && send.disabled),
    toolCall: kinds.includes('tool-call') || kinds.includes('tool-result'),
    approval: Boolean(document.querySelector('[data-approval-key]')),
    busy: Boolean(card && Array.from(card.querySelectorAll('button')).some((el) =>
      /stop generating|停止生成/i.test((el.getAttribute('aria-label') || '') + (el.textContent || ''))))
      || /Deep diving|深潜/.test(body + lastText),
    modelLabel: (() => {
      const trigger = card && Array.from(card.querySelectorAll('button')).find((el) =>
        /选择模型|select model/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
      return trigger ? ((trigger.getAttribute('aria-label') || '') + (trigger.textContent || '')).replace(/\\s+/g, ' ').trim() : '';
    })(),
  };
})()`

const report = {
  at: new Date().toISOString(),
  productExe,
  userData,
  ciRun: CI_RUN,
  setupSha256: SETUP_SHA256,
  sibling,
  driver: 'cdp-contenteditable',
  steps: [],
  pass: false,
}

function rec(name, ok, detail = '') {
  const row = { name, ok: Boolean(ok), detail: String(detail || '').slice(0, 600) }
  report.steps.push(row)
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${name}${row.detail ? ` — ${row.detail}` : ''}`)
  return row.ok
}

killProduct()
await sleep(2000)
saveConfigPatch({
  workspace: sibling,
  autoStartDesktop: true,
  quitAfterStart: false,
  theme: prior.theme || 'deepseek',
})

const child = spawnInstalled(port)
let cdp
try {
  const harness = await waitForHarnessUrl(port, 300_000)
  rec('harness.up', harness.ok, (harness.harness || (harness.urls || []).join(' ')).slice(0, 200))
  if (!harness.ok) throw new Error('harness did not come up')

  cdp = await attachHarness(port, 90_000)
  await sleep(3000)

  const wasm = await cdp.eval(`Promise.all([
    fetch(location.origin + '/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm').then((r) => r.status).catch((e) => String(e)),
    fetch(location.origin + '/plugins/@deepseek-ai/dsh-client-ui-user-terminal/lib/assets/ghostty-vt.wasm').then((r) => r.status).catch((e) => String(e)),
  ])`)
  rec('term.ghosttyWasm', wasm?.[0] === 200 || wasm?.[1] === 200, JSON.stringify(wasm))

  const composer = await waitFor(async () => {
    const snap = await cdp.eval(SNAPSHOT)
    return { ok: Boolean(snap?.inputEditable || snap?.modelLabel), snap }
  }, 45_000, 1000)
  rec('appendix.composer', composer.ok, JSON.stringify(composer.snap || {}).slice(0, 240))

  await cdp.eval(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((el) => /新建会话|new session/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')))
      || buttons.find((el) => ((el.textContent || '').trim() === '新会话'));
    if (btn && !btn.disabled) btn.click();
    return Boolean(btn);
  })()`)
  await sleep(2000)
  const sendState = await cdp.eval(SNAPSHOT)
  if (sendState?.sendDisabled || /turn-error/.test((sendState?.kinds || []).join(','))) {
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find((el) => /新建会话|new session/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')))
        || buttons.find((el) => ((el.textContent || '').trim() === '新会话'));
      if (btn && !btn.disabled) btn.click();
      return Boolean(btn);
    })()`)
    await sleep(2000)
  }

  const modelLabel = await cdp.eval(`(() => {
    const card = document.querySelector('[data-composer-card]');
    const trigger = card && Array.from(card.querySelectorAll('button')).find((el) =>
      /选择模型|select model/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
    return trigger ? ((trigger.getAttribute('aria-label') || '') + (trigger.textContent || '')).replace(/\\s+/g, ' ').trim() : '';
  })()`)
  if (!/grok-4\.6/i.test(modelLabel || '')) {
    await cdp.eval(`(() => {
      const card = document.querySelector('[data-composer-card]');
      const trigger = card && Array.from(card.querySelectorAll('button')).find((el) =>
        /选择模型|select model/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
      if (trigger && !trigger.disabled) trigger.click();
      return Boolean(trigger);
    })()`)
    await sleep(400)
    await cdp.eval(`(() => {
      const row = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button'))
        .find((el) => {
          const label = ((el.getAttribute('aria-label') || '') + (el.textContent || '')).replace(/\\s+/g, ' ').trim();
          return /模型|model/i.test(label) && !/推理|thinking|effort/i.test(label);
        });
      if (row) row.click();
      return Boolean(row);
    })()`)
    await sleep(400)
    const menu = await cdp.eval(`(() => Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]'))
      .map((el) => ((el.getAttribute('aria-label') || '') + (el.textContent || '')).replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20))()`)
    rec('appendix.modelMenu', Array.isArray(menu) && menu.some((label) => String(label).includes('grok-4.6')), JSON.stringify(menu || []).slice(0, 400))
    await cdp.eval(`(() => {
      const item = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]'))
        .find((el) => /grok-4\\.6/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
      if (item && !item.disabled) item.click();
      return Boolean(item);
    })()`)
    await sleep(800)
  }
  const afterModel = await cdp.eval(SNAPSHOT)
  rec('appendix.model', /grok-4\.6/i.test(afterModel?.modelLabel || ''), afterModel?.modelLabel || modelLabel || '')

  const ctx = { code: '' }
  for (const turn of TURNS) {
    const idle = await waitFor(async () => {
      await cdp.eval(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((el) =>
          /allow once|允许一次/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
      })()`)
      const snap = await cdp.eval(SNAPSHOT)
      return { ok: Boolean(snap && !snap.busy && !snap.approval), snap }
    }, 90_000, 800)
    if (!idle.ok) {
      rec(turn.id, false, 'composer stayed busy before send')
      break
    }
    const beforeCount = idle.snap?.assistantCount || 0
    const box = await cdp.eval(`(() => {
      const el = document.querySelector('[data-composer-input]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      el.click();
      el.focus();
      return {
        x: Math.round(r.x + Math.min(40, r.width / 2)),
        y: Math.round(r.y + r.height / 2),
        existing: el.innerText || '',
      };
    })()`)
    if (!box) {
      rec(turn.id, false, 'composer input missing')
      break
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
    })
    await sleep(40)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
    })
    await sleep(200)
    if (String(box.existing || '').trim()) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
        windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2,
        windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
      })
    }
    await cdp.send('Input.insertText', { text: turn.prompt })
    await sleep(400)
    let typed = await cdp.eval(`(() => (document.querySelector('[data-composer-input]') || {}).innerText || '')()`)
    if (!String(typed).includes(turn.prompt.slice(0, 10))) {
      await cdp.send('Input.insertText', { text: turn.prompt })
      await sleep(400)
      typed = await cdp.eval(`(() => (document.querySelector('[data-composer-input]') || {}).innerText || '')()`)
    }
    if (!String(typed).includes(turn.prompt.slice(0, 10))) {
      rec(turn.id, false, `composer did not accept prompt; typed=${String(typed).slice(0, 80)}`)
      break
    }
    const sent = await cdp.eval(`(() => {
      const card = document.querySelector('[data-composer-card]');
      const btn = card && Array.from(card.querySelectorAll('button')).find((el) =>
        /send message|发送消息/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`)
    if (!sent) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
    }
    const done = await waitFor(async () => {
      await cdp.eval(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((el) =>
          /allow once|允许一次/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')));
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
      })()`)
      const snap = await cdp.eval(SNAPSHOT)
      const grew = (snap?.assistantCount || 0) > beforeCount && Boolean(snap?.lastText)
      const ok = Boolean(grew && !snap.busy && !snap.approval)
      return { ok, snap }
    }, 120_000, 1000)
    const text = done.snap?.lastText || ''
    if (turn.id === 'appendix.turn1.connect') {
      const match = text.match(/\b(\d{3})\b/)
      ctx.code = match ? match[1] : ''
    }
    const toolOk = !turn.expectTool || Boolean(done.snap?.toolCall)
    rec(turn.id, Boolean(done.ok && turn.expect(text, ctx) && toolOk), text.slice(0, 240))
    if (!done.ok || !turn.expect(text, ctx)) break
  }

  try {
    await cdp.shot(outDir, '07-appendix-ce.png')
  } catch {
    // screenshot is optional
  }

  const required = ['harness.up', 'appendix.composer', 'appendix.model', ...TURNS.map((t) => t.id)]
  const names = new Set(report.steps.map((s) => s.name))
  report.pass = required.every((id) => report.steps.some((s) => s.name === id && s.ok))
    && required.every((id) => names.has(id))
  report.ctx = ctx
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.pass = false
} finally {
  if (cdp) cdp.close()
  killProduct()
  await sleep(2000)
  saveConfigPatch({
    workspace: prior.workspace,
    autoStartDesktop: prior.autoStartDesktop,
    quitAfterStart: prior.quitAfterStart,
    askOnUpdate: prior.askOnUpdate,
    theme: 'deepseek',
  })
}

writeFileSync(path.join(outDir, 'install-appendix-ce-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  pass: report.pass,
  error: report.error,
  steps: report.steps.map((s) => ({ id: s.name, pass: s.ok })),
}, null, 2))
if (!report.pass) process.exitCode = 1
