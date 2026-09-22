/**
 * LAN rehearsal: S09 only — browse throwaway + switch grok-4.6 + five rounds + unlist.
 * Does not log #offer=. Not T1 Pass.
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

const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);
const FOLDER_NAME = `dshd-ws-s09-${Date.now()}`;
const ROUNDS = [
  '用一句话回复：你已连通，并给出一个三位数验证码。',
  '刚才的验证码是多少？只回答数字。',
  '阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。',
  '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
  '汇总：验证码、产品一句话、目录名各一行。',
];

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitFor(page, fn, message, timeout = 8000, arg) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function clickSheet(page, label) {
  const hit = await page.evaluate((want) => {
    const items = [...document.querySelectorAll('.sheet-item, .session-list-action')];
    const matches = items.filter((item) => {
      const title = item.querySelector('.sheet-item-main > span:first-child')?.textContent
        || (item.textContent || '').trim();
      return title === want || (item.textContent || '').includes(want);
    });
    const node = matches.find((item) => !item.querySelector('.sheet-hint')) || matches[matches.length - 1];
    node?.click();
    return Boolean(node);
  }, label);
  if (!hit) throw new Error(`sheet item missing: ${label}`);
  await sleep(400);
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
        model: document.querySelector('#model-chip')?.textContent || '',
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
        assistants,
        lastAssistant: assistants[assistants.length - 1] || '',
        gained: assistants.length > prev,
        users: document.querySelectorAll('#log .user').length,
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
  const dump = await page.evaluate(() => ({
    banner: document.querySelector('#banner')?.textContent || '',
    model: document.querySelector('#model-chip')?.textContent || '',
    stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
    approval: !document.querySelector('#approval')?.classList.contains('hidden'),
    assistants: document.querySelectorAll('#log .assistant').length,
    users: document.querySelectorAll('#log .user').length,
    log: (document.querySelector('#log')?.textContent || '').slice(0, 400),
  }));
  throw new Error(`idle timeout ${JSON.stringify(dump)}`);
}

async function unlistLive(page) {
  await page.evaluate(() => {
    document.querySelector('.sheet-mask')?.click();
    document.querySelector('#settings .settings-back, #settings-close')?.click();
    document.querySelector('#menu')?.click();
  });
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 8_000);
  await sleep(400);
  const stale = await page.evaluate(() => [...document.querySelectorAll('#session-list .workspace-head b')]
    .map((n) => n.textContent || '')
    .filter((t) => /dshd-ws-/.test(t)));
  for (const title of stale) {
    await page.evaluate((name) => {
      const head = [...document.querySelectorAll('#session-list .workspace-head')]
        .find((node) => (node.querySelector('b')?.textContent || '') === name);
      head?.querySelector('[aria-label="工作区操作"]')?.click();
    }, title);
    await clickSheet(page, '从列表移除');
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'unlist', 5_000);
    await page.evaluate(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === '移除')?.click());
    await sleep(500);
    console.log(`unlisted ${title}`);
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  for (const port of [3080, 3180, 6767]) {
    if (!(await portOpen(port))) throw new Error(`port ${port} closed`);
  }
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
  const url = parsed.toString();
  console.log(`[s09] pairing ${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`);

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const dump = {};
  try {
    await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'paste', 10_000);
    await page.evaluate((offerUrl) => {
      const input = document.querySelector('#paste');
      if (input) input.value = offerUrl;
      document.querySelector('#paste-enter')?.click();
    }, url);
    await waitFor(page, () => !document.querySelector('#screen-chat')?.classList.contains('hidden'), 'chat', 90_000);

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 8_000);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser', 8_000);
    await clickSheet(page, '浏览本机目录…');
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
      && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''), 'browse', 20_000);
    await clickSheet(page, '新建文件夹');
    await waitFor(page, () => Boolean(document.querySelector('.dialog input.paste')), 'mkdir dialog', 8_000);
    await page.evaluate((name) => {
      const input = document.querySelector('.dialog input.paste');
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.dialog .primary-btn')?.click();
    }, FOLDER_NAME);
    await waitFor(
      page,
      (name) => {
        const hint = [...document.querySelectorAll('.sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区')
          ?.querySelector('.sheet-hint')?.textContent || '';
        return hint.includes(name);
      },
      'landed in folder',
      15_000,
      FOLDER_NAME,
    );
    const folderPath = await page.evaluate(() => [...document.querySelectorAll('.sheet-item')]
      .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区')
      ?.querySelector('.sheet-hint')?.textContent || '');
    await writeFile(path.join(folderPath, 'README.md'), 'dshd-qa 临时工作区\n', 'utf8');
    await clickSheet(page, '使用此目录作为工作区');
    await waitFor(page, () => !document.querySelector('.sheet-title'), 'created', 25_000);
    await page.screenshot({ path: path.join(SHOT_DIR, 's09-00-created.png') });

    await page.click('#model-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model pane', 8_000);
    await waitFor(
      page,
      () => [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6|Grok/i.test(n.textContent || ''))
        || /读取模型失败/.test(document.querySelector('#options')?.textContent || ''),
      'model rows',
      15_000,
    );
    dump.models = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')].map((n) => n.textContent));
    const switched = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#options .sheet-item')]
        .find((n) => /grok-4\.6/i.test(n.textContent || ''));
      row?.click();
      return Boolean(row);
    });
    dump.switchedGrok = switched;
    await sleep(800);
    await page.evaluate(() => document.querySelector('#close-settings')?.click());
    await sleep(400);
    dump.modelChip = await page.evaluate(() => document.querySelector('#model-chip')?.textContent || '');
    await page.screenshot({ path: path.join(SHOT_DIR, 's09-01-model.png') });
    if (!switched) throw new Error(`no grok-4.6 in catalog: ${dump.models.slice(0, 12).join('|')}`);

    const logs = [];
    for (let i = 0; i < ROUNDS.length; i += 1) {
      const view = await sendAndIdle(page, ROUNDS[i]);
      logs.push({ round: i + 1, assistant: view.lastAssistant, model: view.model });
      await page.screenshot({ path: path.join(SHOT_DIR, `s09-round-${i + 1}.png`) });
      console.log(`ok - S09 round ${i + 1}`);
    }
    dump.s09 = logs;
    const code = (logs[0].assistant || '').match(/\b(\d{3})\b/)?.[1];
    if (!code) throw new Error(`round 1 no code: ${logs[0].assistant.slice(0, 160)}`);
    if (!(logs[1].assistant || '').includes(code)) throw new Error(`round 2 != ${code}`);
    if (!/README|产品|临时工作区|dshd-qa/i.test(logs[2].assistant || '')) throw new Error('round 3 unread README');
    if (!(logs[3].assistant || '').includes(FOLDER_NAME)) throw new Error('round 4 missing folder');
    if (!(logs[4].assistant || '').includes(code)) throw new Error('round 5 missing code');
    console.log(`Pass - TC-MREM-S09 code=${code}`);
  } finally {
    try { await unlistLive(page); } catch (error) { console.log(`unlist: ${error.message}`); }
    await writeFile(path.join(SHOT_DIR, 's09-dump.json'), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
