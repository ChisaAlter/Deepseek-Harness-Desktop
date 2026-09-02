/**
 * Official dsh web appendix A on the already-running source Electron (CDP 9229).
 * Does not bounce daemon. Not T1 / installed-package Pass.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CDP = `http://127.0.0.1:${process.env.DSH_CDP_PORT || 9229}`;
const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
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
    expect: (text) => /chisaterminal|终端模拟器|xterm|powershell hook|electron-store|harness|desktop|deepseek|dshd-qa|临时工作区/i.test(text)
      && !/不存在 README|没有 README|no README/i.test(text),
  },
  {
    id: 'appendix.turn4.shell',
    prompt: '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
    expect: (text) => text.trim().length > 0,
  },
  {
    id: 'appendix.turn5.summary',
    prompt: '汇总：验证码、产品一句话、目录名各一行。',
    expect: (text, ctx) => Boolean(ctx.code) && text.includes(ctx.code),
  },
];

const HELPERS = `
function dshShown(el) {
  if (!el) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}
function dshLabel(el) {
  return ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).replace(/\\s+/g, ' ').trim();
}
function dshFind(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll(
    'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="textbox"], input, textarea, a'
  )).find((el) => dshShown(el) && re.test(dshLabel(el))) || null;
}
function lastAssistantText() {
  const assistants = Array.from(document.querySelectorAll(
    '[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]',
  ));
  const last = assistants.at(-1);
  return last ? (last.innerText || '').trim() : '';
}
function dshComposerInput() {
  return document.querySelector('[data-composer-input]');
}
function dshComposerReady() {
  const el = dshComposerInput();
  return Boolean(el && dshShown(el) && el.getAttribute('contenteditable') === 'true'
    && el.getAttribute('aria-disabled') !== 'true');
}
function dshComposerText() {
  const el = dshComposerInput();
  return ((el && (el.innerText || el.textContent)) || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/g, '');
}
function dshSelectComposerAll(el) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}
function dshSetComposerText(value) {
  const el = dshComposerInput();
  if (!el || !dshComposerReady()) return false;
  el.click();
  el.focus();
  dshSelectComposerAll(el);
  if (document.execCommand) {
    if (value) document.execCommand('insertText', false, value);
    else document.execCommand('delete');
  }
  return dshComposerText() === value;
}
function snap() {
  const card = document.querySelector('[data-composer-card]');
  const send = card && dshFind('send message|发送消息', card);
  const stop = dshFind('stop generating|停止生成');
  const model = dshFind('选择模型|select model');
  return {
    composer: Boolean(card && dshShown(card)),
    composerText: dshComposerText().slice(0, 80),
    sendReady: Boolean(send && !send.disabled),
    busy: Boolean(stop && dshShown(stop)),
    approval: Boolean(document.querySelector('[data-approval-key]')),
    modelLabel: model ? dshLabel(model) : '',
    lastText: lastAssistantText().slice(0, 800),
    assistantCount: document.querySelectorAll('[data-chat-flow-kind="assistant"]').length,
  };
}
`;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function evalPage(page, body, args) {
  return page.evaluate(new Function('args', `${HELPERS}\n${body}`), args || {});
}

async function waitUntil(probe, timeout, message) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await probe();
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`${message}: ${JSON.stringify(last)}`);
}

async function allowOnce(page) {
  await evalPage(page, `
    const btn = dshFind('allow once|允许一次');
    if (btn && !btn.disabled) btn.click();
    return true;
  `);
}

async function sendTurn(page, prompt) {
  const before = await evalPage(page, 'return snap();');
  let written = await evalPage(page, 'return dshSetComposerText(args.value);', { value: prompt });
  if (!written) {
    await page.click('[data-composer-input]');
    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text: prompt });
    written = await evalPage(page, 'return dshComposerText() === args.value;', { value: prompt });
  }
  const draft = await evalPage(page, 'return snap();');
  if (!draft.composerText) {
    throw new Error(`composer empty after type; sendReady=${draft.sendReady} ready=${await evalPage(page, 'return dshComposerReady();')}`);
  }
  const clicked = await evalPage(page, `
    const card = document.querySelector('[data-composer-card]');
    const btn = card && dshFind('send message|发送消息', card);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  `);
  if (!clicked) throw new Error(`send click failed; draft=${draft.composerText}`);
  let lastSnap = draft;
  const start = Date.now();
  while (Date.now() - start < 240_000) {
    await allowOnce(page);
    lastSnap = await evalPage(page, 'return snap();');
    const grew = lastSnap.assistantCount > before.assistantCount;
    const changed = lastSnap.lastText && lastSnap.lastText !== before.lastText;
    if ((grew || changed) && lastSnap.lastText && !lastSnap.busy && !lastSnap.approval) return lastSnap;
    await sleep(400);
  }
  throw new Error(`idle after ${prompt.slice(0, 18)}: ${JSON.stringify(lastSnap)}`);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.connect({
    browserURL: CDP,
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page = pages.find((p) => /127\.0\.0\.1:3080/.test(p.url()))
    || pages.find((p) => !/boot\.html/.test(p.url()));
  if (!page) throw new Error(`no harness page in ${pages.map((p) => p.url()).join(' | ')}`);
  const dump = { url: page.url().split('?')[0], steps: [] };
  const rec = (name, ok, detail) => {
    dump.steps.push({ name, ok, detail: detail || '' });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    await waitUntil(async () => evalPage(page, 'return snap().composer ? true : null;'), 40_000, 'composer');
    rec('appendix.composer', true, '');

    await evalPage(page, `
      const buttons = Array.from(document.querySelectorAll('button')).filter(dshShown);
      const btn = buttons.find((el) => {
        const aria = el.getAttribute('aria-label') || '';
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        return /新建会话|new session/i.test(aria) || text === '新会话' || text === '新对话';
      });
      btn?.click();
      return Boolean(btn);
    `);
    await sleep(1200);

    const modelBefore = await evalPage(page, 'return snap().modelLabel;');
    if (!/grok-4\.6/i.test(modelBefore)) {
      await evalPage(page, `
        const card = document.querySelector('[data-composer-card]');
        const trigger = card && Array.from(card.querySelectorAll('button')).find((el) =>
          /选择模型|select model/i.test(dshLabel(el)));
        trigger?.click();
        return Boolean(trigger);
      `);
      await sleep(500);
      await evalPage(page, `
        const modelRow = dshFind('^模型$|模型');
        modelRow?.click();
        return Boolean(modelRow);
      `);
      await sleep(400);
      await evalPage(page, `
        const item = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'))
          .find((el) => dshShown(el) && /grok-4\\.6/i.test(dshLabel(el)));
        item?.click();
        return Boolean(item);
      `);
      await sleep(600);
    }
    const model = await evalPage(page, 'return snap().modelLabel;');
    rec('appendix.model', /grok-4\.6/i.test(model), model);

    const ctx = { code: '' };
    for (const turn of TURNS) {
      const idle = await sendTurn(page, turn.prompt);
      if (turn.id === 'appendix.turn1.connect') {
        ctx.code = (idle.lastText.match(/\b(\d{3})\b/) || [])[1] || '';
      }
      const ok = turn.expect(idle.lastText, ctx);
      dump[turn.id] = idle.lastText.slice(0, 400);
      rec(turn.id, ok, idle.lastText.replace(/\\s+/g, ' ').slice(0, 180));
      await page.screenshot({ path: path.join(SHOT_DIR, `desktop-${turn.id}.png`) });
      if (!ok) break;
    }
  } finally {
    await writeFile(path.join(SHOT_DIR, 'desktop-appendix-dump.json'), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
    await writeFile(
      path.join(SHOT_DIR, 'desktop-appendix-report.txt'),
      `${dump.steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.detail ? ` — ${s.detail}` : ''}`).join('\n')}\n`,
      'utf8',
    );
    browser.disconnect();
  }
  if (dump.steps.some((s) => !s.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
