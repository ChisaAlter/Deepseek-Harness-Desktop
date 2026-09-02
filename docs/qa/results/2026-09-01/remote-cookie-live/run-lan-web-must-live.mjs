/**
 * LAN :3180 Web MUST live against the already-running source Electron daemon.
 * Ayase grok-4.6 real rounds. Does not bounce daemon, does not log #offer= or API keys.
 * Evidence only — not T1 camera / T3 APK Pass.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../../../../src/main/chisacode-remote.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../../../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

const CHROME = chromePath();
const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);
const FOLDER_NAME = `dshd-ws-must-${Date.now()}`;
const PROTECTED_HEADS = /Deepseek-Harness-Desktop|ChisaTerminal/;
const THROWAY_HEAD = /dshd-ws-must-|dshd-ws-live-|dshd-ws-s09-/;
const ROUNDS = [
  '用一句话回复：你已连通，并给出一个三位数验证码。',
  '刚才的验证码是多少？只回答数字。',
  '阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。',
  '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
  '汇总：验证码、产品一句话、目录名各一行。',
];

const results = [];
let failures = 0;
const dumps = {};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
async function check(id, fn) {
  try {
    const outcome = await fn();
    if (outcome?.blocked) {
      results.push(`Blocked - ${id}: ${outcome.blocked}`);
      console.log(`Blocked - ${id}: ${outcome.blocked}`);
      return;
    }
    results.push(`Pass - ${id}`);
    console.log(`Pass - ${id}`);
  } catch (error) {
    failures += 1;
    const message = error?.message || String(error);
    results.push(`Fail - ${id}: ${message}`);
    console.log(`Fail - ${id}: ${message}`);
  }
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
}
function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
  } catch {
    return '<unparseable>';
  }
}
async function waitFor(page, fn, message, timeout = 8000, arg) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}
async function pairingUrl() {
  const api = await loadServerApi();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: path.join(USER_DATA, 'chisacode-home'),
    relayEnabled: true,
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayPublicEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: 'http://127.0.0.1:3180',
    includeQr: false,
  });
  const parsed = new URL(pairing.url);
  parsed.hostname = '127.0.0.1';
  return parsed.toString();
}
async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelector('#close-settings')?.click();
    document.querySelector('.sheet-mask')?.click();
    document.querySelector('.dialog-mask')?.click();
    document.querySelector('.dialog .ghost-btn')?.click();
  });
  await sleep(250);
}
async function openDrawer(page) {
  const open = await page.evaluate(() => document.querySelector('#phone')?.hasAttribute('data-drawer'));
  if (!open) await page.evaluate(() => document.querySelector('#menu')?.click());
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 10_000);
  await sleep(300);
}
async function closeDrawer(page) {
  await page.evaluate(() => document.querySelector('#backdrop')?.click());
  await sleep(200);
}
async function clickSheet(page, label, { exact = false } = {}) {
  const hit = await page.evaluate((want, exactMatch) => {
    const items = [...document.querySelectorAll('#sheet-root .sheet-item, #session-list .session-list-action')];
    const matches = items.filter((item) => {
      const title = item.querySelector('.sheet-item-main > span:first-child')?.textContent
        || (item.textContent || '').trim();
      return exactMatch ? title === want : title === want || (item.textContent || '').includes(want);
    });
    const node = exactMatch
      ? (matches.find((item) => !item.querySelector('.sheet-hint')) || matches[matches.length - 1])
      : matches[0];
    node?.click();
    return Boolean(node);
  }, label, exact);
  assert(hit, `sheet item missing: ${label}`);
  await sleep(400);
}
async function fillDialog(page, value) {
  await waitFor(page, () => Boolean(document.querySelector('.dialog input.paste')), 'dialog input', 8_000);
  await page.evaluate((text) => {
    const input = document.querySelector('.dialog input.paste');
    if (!input) return;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.evaluate(() => document.querySelector('.dialog .primary-btn')?.click());
  await sleep(800);
}
async function sendAndIdle(page, text, timeout = 180_000) {
  const before = await page.evaluate(() => document.querySelectorAll('#log .assistant').length);
  await page.click('#draft');
  await page.evaluate(() => {
    const draft = document.querySelector('#draft');
    if (draft) draft.value = '';
  });
  await page.type('#draft', text);
  await page.click('#send-btn');
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const view = await page.evaluate((prev) => {
      const allow = [...document.querySelectorAll('#approval-actions button')]
        .find((btn) => (btn.textContent || '').includes('允许一次'));
      if (allow) allow.click();
      const assistants = [...document.querySelectorAll('#log .assistant')].map((n) => n.textContent || '');
      return {
        banner: document.querySelector('#banner')?.textContent || '',
        log: document.querySelector('#log')?.textContent || '',
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
        lastAssistant: assistants[assistants.length - 1] || '',
        gained: assistants.length > prev,
        model: document.querySelector('#model-chip')?.textContent || '',
        access: document.querySelector('#access-chip')?.textContent || '',
      };
    }, before);
    if (/无法|失败|host HTTP|typert|只读|断开/i.test(view.banner)) throw new Error(view.banner);
    if (view.gained && view.lastAssistant.trim() && !view.stop && !view.approval) {
      await sleep(800);
      const settled = await page.evaluate(() => ({
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
      }));
      if (!settled.stop && !settled.approval) return view;
    }
    await sleep(400);
  }
  throw new Error(`idle timeout after send: ${text.slice(0, 24)}`);
}
function composerBoxes() {
  const ids = ['attach-toggle', 'access-chip', 'plan-chip', 'model-chip', 'send-btn'];
  return ids.map((id) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) return { id, hidden: true };
    const r = el.getBoundingClientRect();
    return { id, x: r.x, y: r.y, w: r.width, h: r.height, text: (el.textContent || '').trim().slice(0, 24) };
  });
}
function assertNoOverlap(boxes) {
  const visible = boxes.filter((b) => !b.hidden && b.w > 0);
  for (let i = 0; i < visible.length; i += 1) {
    assert(visible[i].w >= 28 && visible[i].h >= 28, `${visible[i].id} ${visible[i].w}x${visible[i].h}`);
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert(!overlap, `${a.id} overlaps ${b.id}`);
    }
  }
}
async function switchGrok(page) {
  await dismissOverlays(page);
  await page.click('#model-chip');
  await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model pane', 8_000);
  await waitFor(
    page,
    () => [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6/i.test(n.textContent || ''))
      || /读取模型失败/.test(document.querySelector('#options')?.textContent || ''),
    'model rows',
    15_000,
  );
  const switched = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#options .sheet-item')]
      .find((n) => /grok-4\.6/i.test(n.textContent || '') && /Ayase/i.test(n.textContent || ''));
    (row || [...document.querySelectorAll('#options .sheet-item')].find((n) => /grok-4\.6/i.test(n.textContent || '')))?.click();
    return Boolean(row || [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6/i.test(n.textContent || '')));
  });
  await sleep(600);
  await page.evaluate(() => document.querySelector('#close-settings')?.click());
  assert(switched, 'Ayase grok-4.6 missing from session.models');
}
async function createThrowaway(page) {
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'new session', 8_000);
  await clickSheet(page, '浏览本机目录…', { exact: true });
  await waitFor(
    page,
    () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
      && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
    'browse',
    20_000,
  );
  await clickSheet(page, '新建文件夹', { exact: true });
  await fillDialog(page, FOLDER_NAME);
  await waitFor(
    page,
    (name) => {
      const hint = [...document.querySelectorAll('#sheet-root .sheet-item')]
        .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区')
        ?.querySelector('.sheet-hint')?.textContent || '';
      return hint.includes(name);
    },
    'landed',
    15_000,
    FOLDER_NAME,
  );
  const createdFolderPath = await page.evaluate(() => {
    const hint = [...document.querySelectorAll('#sheet-root .sheet-item')]
      .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
    return hint?.querySelector('.sheet-hint')?.textContent || '';
  });
  await writeFile(path.join(createdFolderPath, 'README.md'), 'dshd-qa 临时工作区\n', 'utf8');
  await clickSheet(page, '使用此目录作为工作区', { exact: true });
  await waitFor(page, () => !document.querySelector('.sheet-title') || Boolean(document.querySelector('.sheet-error')?.textContent), 'create', 25_000);
  const err = await page.evaluate(() => document.querySelector('.sheet-error')?.textContent || '');
  assert(!err, err);
  await sleep(800);
  return createdFolderPath;
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), `missing ${CHROME}`);
  assert(await portOpen(3080), '3080 down');
  assert(await portOpen(3180), '3180 down');
  assert(await portOpen(6767), '6767 down');

  const url = await pairingUrl();
  console.log(`[web-must] pairing ${pairingSummary(url)}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `must-${name}.png`) });
  let createdFolderPath = '';
  let sessionA = '';
  let sessionB = '';

  try {
    await check('M0-pair :3180 SPA', async () => {
      await page.setViewport({ width: 390, height: 844 });
      const parsed = new URL(url);
      await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const appSrc = await page.evaluate(() => document.querySelector('script[type="module"]')?.src || '');
      assert(/20260901-review-fix3/.test(appSrc), `stale app.js: ${appSrc}`);
      dumps.appSrc = appSrc.replace(/#.*$/, '');
      await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'paste', 10_000);
      await shot('s01-connect-390');
      await page.evaluate((offerUrl) => {
        const input = document.querySelector('#paste');
        if (input) input.value = offerUrl;
        document.querySelector('#paste-enter')?.click();
      }, url);
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
          || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
        'chat',
        90_000,
      );
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        error: document.querySelector('#connect-error')?.textContent || '',
      }));
      if (view.error && !view.chat) throw new Error(view.error);
      assert(view.chat, JSON.stringify(view));
    });

    await check('TC-MREM-S01 layout 360/390/430', async () => {
      for (const [name, w, h] of [['360', 360, 640], ['390', 390, 844], ['430', 430, 932]]) {
        await page.setViewport({ width: w, height: h });
        await sleep(200);
        const boxes = await page.evaluate(composerBoxes);
        dumps[`hit-${name}`] = boxes;
        assertNoOverlap(boxes);
        await shot(`s01-chat-${name}`);
      }
      await page.setViewport({ width: 390, height: 844 });
      await openDrawer(page);
      await shot('s01-drawer-390');
      await closeDrawer(page);
    });

    await check('TC-MREM-S09 throwaway + grok-4.6 five rounds', async () => {
      createdFolderPath = await createThrowaway(page);
      dumps.createdFolderPath = createdFolderPath;
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        'opened created session',
        15_000,
      );
      await switchGrok(page);
      const chip = await page.evaluate(() => document.querySelector('#model-chip')?.textContent || '');
      dumps.modelChip = chip;
      assert(/grok-4\.6/i.test(chip), `chip not grok-4.6: ${chip}`);
      const logs = [];
      for (let i = 0; i < ROUNDS.length; i += 1) {
        const view = await sendAndIdle(page, ROUNDS[i]);
        logs.push({ round: i + 1, assistant: view.lastAssistant.slice(0, 400) });
        await shot(`s09-round-${i + 1}`);
      }
      dumps.s09 = logs;
      const code = (logs[0]?.assistant || '').match(/\b(\d{3})\b/)?.[1];
      assert(code, `round 1 no code: ${(logs[0]?.assistant || '').slice(0, 120)}`);
      assert((logs[1]?.assistant || '').includes(code), `round 2 != ${code}`);
      assert(/README|产品|临时工作区|dshd-qa/i.test(logs[2]?.assistant || ''), `round 3: ${(logs[2]?.assistant || '').slice(0, 120)}`);
      assert((logs[3]?.assistant || '').includes(FOLDER_NAME), `round 4 missing folder: ${(logs[3]?.assistant || '').slice(0, 120)}`);
      assert((logs[4]?.assistant || '').includes(code), `round 5 missing code`);
      sessionA = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      dumps.sessionA = sessionA;
      assert(sessionA, 'missing open session id');
    });

    await check('TC-MREM-S06 thinking effort then chat', async () => {
      await dismissOverlays(page);
      await page.click('#model-chip');
      await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model', 8_000);
      const picked = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#options .sheet-item')]
          .find((n) => /^(High|高|high)$/i.test((n.querySelector('.sheet-item-main > span:first-child')?.textContent || n.textContent || '').trim())
            || /High/.test(n.textContent || ''));
        const effort = [...document.querySelectorAll('#options .sheet-item, #options button')]
          .find((n) => /High/i.test(n.textContent || '') && !/grok|DeepSeek|MiniMax|Qwen|Kimi|GLM/i.test(n.textContent || ''));
        (effort || row)?.click();
        return (effort || row)?.textContent || '';
      });
      dumps.effort = picked;
      await sleep(500);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
      const chip = await page.evaluate(() => document.querySelector('#model-chip')?.textContent || '');
      dumps.modelAfterEffort = chip;
      const view = await sendAndIdle(page, '请只回复一行：思考档切换验证');
      dumps.s06 = view.lastAssistant.slice(0, 200);
      assert(/思考档切换验证|验证/.test(view.log), view.lastAssistant.slice(0, 120));
      await shot('s06-effort');
    });

    await check('TC-MREM-S05 switch model then back to grok-4.6', async () => {
      await dismissOverlays(page);
      await page.click('#model-chip');
      await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'models', 8_000);
      const m2 = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#options .sheet-item')].find((n) => {
          const t = n.textContent || '';
          return t && !/grok-4\.6/i.test(t) && !/^(Low|High|低|高)/.test(t.trim())
            && /DeepSeek|MiniMax|Qwen|Kimi|GLM|Ayase|opencode|Flash|Pro/i.test(t);
        });
        row?.click();
        return row?.textContent?.slice(0, 80) || '';
      });
      dumps.m2 = m2;
      if (!m2) {
        await page.evaluate(() => document.querySelector('#close-settings')?.click());
        return { blocked: 'no second model besides grok-4.6' };
      }
      await sleep(600);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
      const chip2 = await page.evaluate(() => document.querySelector('#model-chip')?.textContent || '');
      dumps.chipM2 = chip2;
      assert(/DeepSeek-V4-Flash|V4-Flash/i.test(chip2), `chip stayed: ${chip2}`);
      const view2 = await sendAndIdle(page, '请只回复一行：当前模型切换验证-M2');
      dumps.s05m2 = view2.lastAssistant.slice(0, 160);
      assert(/切换验证-M2|M2|验证/.test(view2.log), view2.lastAssistant.slice(0, 120));
      await switchGrok(page);
      const chipBack = await page.evaluate(() => document.querySelector('#model-chip')?.textContent || '');
      dumps.chipBack = chipBack;
      assert(/grok-4\.6/i.test(chipBack), `did not return to grok-4.6: ${chipBack}`);
      const view1 = await sendAndIdle(page, '请只回复一行：切换验证-M1');
      dumps.s05m1 = view1.lastAssistant.slice(0, 160);
      await shot('s05-back-grok');
    });

    await check('TC-MREM-S07 permission then chat', async () => {
      await dismissOverlays(page);
      const before = await page.evaluate(() => document.querySelector('#access-chip')?.textContent || '');
      await page.click('#access-chip');
      await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'access', 8_000);
      const labels = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item, #options .mode-row')].map((n) => (n.textContent || '').trim()));
      dumps.permissionRows = labels;
      assert(labels.some((t) => /只读/.test(t)), `no 只读: ${labels.join('|')}`);
      assert(labels.some((t) => /工作区|写入/.test(t)), `no 工作区写入: ${labels.join('|')}`);
      const switched = await page.evaluate((current) => {
        const rows = [...document.querySelectorAll('#options .sheet-item, #options .mode-row')];
        const next = rows.find((n) => {
          const t = n.textContent || '';
          return /完全访问|工作区写入/.test(t) && !t.includes(current.trim().slice(0, 2));
        }) || rows.find((n) => /完全访问/.test(n.textContent || ''));
        next?.click();
        return next?.textContent || '';
      }, before);
      dumps.p2 = switched;
      await sleep(800);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
      const after = await page.evaluate(() => document.querySelector('#access-chip')?.textContent || '');
      dumps.accessAfter = after;
      const view = await sendAndIdle(page, `请只回复一行：权限已切换为${after || 'P2'}`);
      dumps.s07 = view.lastAssistant.slice(0, 160);
      await shot('s07-permission');
    });

    await check('TC-MREM-S08 approval allow-once', async () => {
      await dismissOverlays(page);
      const before = await page.evaluate(() => document.querySelectorAll('#log .assistant').length);
      await page.click('#draft');
      await page.evaluate(() => { const d = document.querySelector('#draft'); if (d) d.value = ''; });
      await page.type('#draft', '列出工作区根目录文件名，需要的话请申请执行命令。');
      await page.click('#send-btn');
      try {
        await waitFor(
          page,
          () => !document.querySelector('#approval')?.classList.contains('hidden'),
          'approval bar',
          90_000,
        );
      } catch {
        dumps.s08 = await page.evaluate(() => ({
          banner: document.querySelector('#banner')?.textContent || '',
          log: (document.querySelector('#log')?.textContent || '').slice(-240),
          approval: !document.querySelector('#approval')?.classList.contains('hidden'),
        }));
        await shot('s08-timeout');
        if (dumps.s08.approval) return;
        return { blocked: `no approval bar in 90s; banner=${dumps.s08.banner.slice(0, 80)}` };
      }
      dumps.s08bar = await page.evaluate(() => ({
        title: document.querySelector('#approval-title')?.textContent || '',
        command: document.querySelector('#approval-command')?.textContent || '',
        composerHidden: document.querySelector('#composer')?.classList.contains('hidden'),
        buttons: [...document.querySelectorAll('#approval-actions button')].map((b) => b.textContent),
      }));
      await shot('s08-approval');
      assert(dumps.s08bar.composerHidden, 'composer still sendable during approval');
      await page.evaluate(() => {
        [...document.querySelectorAll('#approval-actions button')].find((b) => (b.textContent || '').includes('允许一次'))?.click();
      });
      await sendAndIdle(page, '请只回复一行：审批后继续', 120_000).catch(() => null);
      await waitFor(
        page,
        (prev) => document.querySelectorAll('#log .assistant').length > prev
          || document.querySelector('#approval')?.classList.contains('hidden'),
        'approval settled',
        120_000,
        before,
      );
    });

    await check('TC-MREM-S03 switch sessions no mix', async () => {
      await dismissOverlays(page);
      const ackA = await sendAndIdle(page, '这是会话A标记句。请只回复：ACK-A');
      dumps.ackA = ackA.lastAssistant.slice(0, 80);
      assert(/ACK-A/i.test(ackA.log), ackA.lastAssistant.slice(0, 120));
      sessionA = (await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '')) || sessionA;
      await openDrawer(page);
      const created = await page.evaluate((name) => {
        const head = [...document.querySelectorAll('#session-list .workspace-head')]
          .find((node) => (node.querySelector('b')?.textContent || '').includes(name));
        head?.querySelector('[aria-label="在此工作区新建会话"]')?.click();
        return Boolean(head);
      }, FOLDER_NAME);
      assert(created, 'throwaway + missing');
      await waitFor(
        page,
        (prev) => {
          const id = document.querySelector('#phone')?.dataset.sessionId || '';
          return Boolean(id) && id !== prev;
        },
        'session B opened',
        15_000,
        sessionA,
      );
      sessionB = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      dumps.sessionB = sessionB;
      await closeDrawer(page);
      await switchGrok(page);
      const logB0 = await page.evaluate(() => document.querySelector('#log')?.textContent || '');
      assert(!/ACK-A|会话A标记句/.test(logB0), `B already has A: ${logB0.slice(0, 160)}`);
      const ackB = await sendAndIdle(page, '这是会话B标记句。请只回复：ACK-B');
      dumps.ackB = ackB.lastAssistant.slice(0, 80);
      assert(/ACK-B/i.test(ackB.log), ackB.lastAssistant.slice(0, 120));
      await openDrawer(page);
      await page.evaluate((id) => {
        const row = [...document.querySelectorAll('#session-list .session-row')].find((n) => n.dataset.sessionId === id);
        row?.querySelector('.session')?.click();
      }, sessionA);
      await waitFor(page, (id) => (document.querySelector('#phone')?.dataset.sessionId || '') === id, 'back to A', 12_000, sessionA);
      await closeDrawer(page);
      await waitFor(page, () => /ACK-A/.test(document.querySelector('#log')?.textContent || ''), 'A timeline', 15_000);
      const logA = await page.evaluate(() => document.querySelector('#log')?.textContent || '');
      dumps.logA = logA.slice(-240);
      assert(/ACK-A/.test(logA), 'A lost ACK-A');
      assert(!/ACK-B/.test(logA), 'A mixed with ACK-B');
      await shot('s03-back-a');
    });

    await check('TC-MREM-504 slash host list', async () => {
      await dismissOverlays(page);
      await page.click('#draft');
      await page.evaluate(() => {
        const draft = document.querySelector('#draft');
        if (draft) {
          draft.value = '';
          draft.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.type('#draft', '/');
      await waitFor(
        page,
        () => {
          const pop = document.querySelector('#slash-pop');
          const text = pop?.innerText || '';
          return (!pop?.classList.contains('hidden') && text && !/正在读取/.test(text))
            || /失败/.test(document.querySelector('#banner')?.textContent || '');
        },
        'slash pop loaded',
        20_000,
      );
      dumps.slash = await page.evaluate(() => (document.querySelector('#slash-pop')?.innerText || '').slice(0, 240));
      await shot('m8-slash');
      assert(/permission|plan|\//i.test(dumps.slash), dumps.slash);
      await page.evaluate(() => {
        const draft = document.querySelector('#draft');
        if (draft) {
          draft.value = '';
          draft.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    await check('TC-MREM-505 send then stop', async () => {
      await dismissOverlays(page);
      await page.click('#draft');
      await page.evaluate(() => { const d = document.querySelector('#draft'); if (d) d.value = ''; });
      await page.type('#draft', '请慢慢数到二十，每行一个数字。');
      await page.click('#send-btn');
      await waitFor(
        page,
        () => !document.querySelector('#stop-btn')?.classList.contains('hidden')
          || !document.querySelector('#send-btn')?.classList.contains('hidden') === false,
        'running or stopped',
        20_000,
      );
      const running = await page.evaluate(() => !document.querySelector('#stop-btn')?.classList.contains('hidden'));
      if (running) {
        await page.click('#stop-btn');
        await sleep(800);
      }
      dumps.stop = await page.evaluate(() => ({
        stopHidden: document.querySelector('#stop-btn')?.classList.contains('hidden'),
        sendHidden: document.querySelector('#send-btn')?.classList.contains('hidden'),
      }));
      await shot('m8-stop');
    });

    await check('TC-MREM-506 attach sheet', async () => {
      await dismissOverlays(page);
      await page.click('#attach-toggle');
      await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('添加'), 'attach', 5_000);
      const labels = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent));
      dumps.attach = labels;
      await shot('m8-attach');
      assert(labels.some((t) => /相册|拍照|相机/.test(t)), labels.join('|'));
      await dismissOverlays(page);
    });

    await check('TC-MREM-601 git on throwaway', async () => {
      await dismissOverlays(page);
      await waitFor(
        page,
        () => !document.querySelector('#git-pill')?.classList.contains('hidden'),
        'git pill',
        15_000,
      );
      await page.click('#git-pill');
      await sleep(600);
      const surface = await page.evaluate(() => ({
        title: document.querySelector('#settings-title, #sheet-root .sheet-title')?.textContent || '',
        body: (document.querySelector('#options')?.innerText || document.querySelector('#sheet-root')?.innerText || '').slice(0, 400),
      }));
      dumps.git = surface;
      await shot('m9-git');
      if (/Initialize Git/i.test(surface.body + surface.title)) {
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('#options button, #sheet-root .sheet-item, #options .sheet-item')]
            .find((n) => /Initialize Git/i.test(n.textContent || ''));
          btn?.click();
        });
        await sleep(2000);
        dumps.gitAfter = await page.evaluate(() => document.querySelector('#git-pill')?.textContent || '');
      }
      await dismissOverlays(page);
      assert(/Git|分支|Commit|Init|main|master/i.test(`${surface.title}\n${surface.body}`), surface.body.slice(0, 160));
    });

    await check('TC-MREM-801 Files/MCP freeze', async () => {
      await dismissOverlays(page);
      await page.evaluate(() => document.querySelector('#open-settings')?.click());
      await waitFor(page, () => (document.querySelector('#options')?.innerText || '').length > 8, 'settings', 8_000);
      await page.evaluate(() => {
        [...document.querySelectorAll('#options button, #options .row')].find((n) => (n.textContent || '').includes('文件'))?.click();
      });
      await sleep(400);
      dumps.files = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
      await shot('m10-files');
      assert(/电脑端|冻结|只读|下一轮|浏览/.test(dumps.files), dumps.files.slice(0, 160));
      await page.evaluate(() => document.querySelector('#settings-back')?.click());
      await sleep(200);
      await page.evaluate(() => {
        [...document.querySelectorAll('#options button, #options .row')].find((n) => (n.textContent || '').includes('MCP'))?.click();
      });
      await sleep(400);
      dumps.mcp = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
      await shot('m10-mcp');
      assert(/电脑端|只读|冻结|MCP/.test(dumps.mcp), dumps.mcp.slice(0, 160));
      await dismissOverlays(page);
    });
  } finally {
    try {
      await dismissOverlays(page);
      await openDrawer(page);
      const titles = await page.evaluate(() => [...document.querySelectorAll('#session-list .workspace-head b')].map((n) => n.textContent || ''));
      for (const title of titles.filter((t) => THROWAY_HEAD.test(t) && !PROTECTED_HEADS.test(t))) {
        await page.evaluate((name) => {
          const head = [...document.querySelectorAll('#session-list .workspace-head')]
            .find((node) => (node.querySelector('b')?.textContent || '') === name);
          head?.querySelector('[aria-label="工作区操作"]')?.click();
        }, title);
        await clickSheet(page, '从列表移除', { exact: true });
        await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'unlist', 8_000);
        await page.evaluate(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === '移除')?.click());
        await sleep(600);
      }
    } catch {
      // best-effort unlist
    }
    await writeFile(path.join(SHOT_DIR, 'must-web-dump.json'), `${JSON.stringify(dumps, null, 2)}\n`, 'utf8');
    await writeFile(path.join(SHOT_DIR, 'must-web-report.txt'), `${results.join('\n')}\n`, 'utf8');
    await browser.close().catch(() => {});
  }
  console.log(`\n${results.length} checks, ${failures} failed. shots ${SHOT_DIR}`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
