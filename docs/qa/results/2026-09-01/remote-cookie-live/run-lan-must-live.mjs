/**
 * LAN :3180 MUST rehearsal against the already-running Electron daemon.
 * Does not bounce daemon, does not log #offer=.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../../../../src/main/chisacode-remote.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../../../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

const CHROME = chromePath();
const SHOT_DIR = path.join(
  process.cwd(),
  'docs',
  'qa',
  'results',
  '2026-09-01',
  'remote-cookie-live',
);
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);

const results = [];
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    const message = error?.message || String(error);
    results.push(`NOT OK - ${name}: ${message}`);
    console.log(`NOT OK - ${name}: ${message}`);
  }
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

function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
  } catch {
    return '<unparseable pairing url>';
  }
}

function loopbackPairing(url) {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  return parsed.toString();
}

async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function dumpChat(page) {
  return page.evaluate(() => ({
    title: document.querySelector('#header-title')?.textContent || document.querySelector('header h1')?.textContent || '',
    connected: (document.querySelector('#device-line')?.textContent || '').includes('已连接')
      || (document.querySelector('header')?.textContent || '').includes('已连接'),
    banner: document.querySelector('#banner')?.textContent || '',
    connBanner: document.querySelector('#conn-banner')?.textContent || '',
    log: (document.querySelector('#log')?.textContent || '').slice(0, 400),
    timelineError: document.querySelector('#log .log-error')?.textContent || '',
    blank: !document.querySelector('#blank')?.classList.contains('hidden'),
    model: document.querySelector('#model-chip')?.textContent || '',
    access: document.querySelector('#access-chip')?.textContent || '',
    git: document.querySelector('#git-pill')?.textContent || '',
    gitHidden: document.querySelector('#git-pill')?.classList.contains('hidden'),
    draftDisabled: Boolean(document.querySelector('#draft')?.disabled),
    sendHidden: document.querySelector('#send-btn')?.classList.contains('hidden'),
  }));
}

async function pairingUrl() {
  const home = path.join(USER_DATA, 'chisacode-home');
  assert(existsSync(home), `missing chisacode-home`);
  const api = await loadServerApi();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: home,
    relayEnabled: true,
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayPublicEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: 'http://127.0.0.1:3180',
    includeQr: false,
  });
  const rawUrl = pairing?.url || '';
  assert(rawUrl && /#offer=/.test(rawUrl), 'no pairing url');
  return loopbackPairing(rawUrl);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), `missing browser at ${CHROME}`);
  assert(await portOpen(3080), 'dsh web is not on 127.0.0.1:3080');
  assert(await portOpen(3180), 'LAN SPA is not on 127.0.0.1:3180');
  assert(await portOpen(6767), 'Electron daemon is not on :6767');

  const url = await pairingUrl();
  console.log(`[lan-must] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  const dumps = {};

  try {
    await check('A 配对进 chat', async () => {
      const parsed = new URL(url);
      await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'landing paste', 10_000);
      await page.evaluate((offerUrl) => {
        const input = document.querySelector('#paste');
        if (input) input.value = offerUrl;
        document.querySelector('#paste-enter')?.click();
      }, url);
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
          || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
        'chat or connect error',
        90_000,
      );
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        error: document.querySelector('#connect-error')?.textContent || '',
      }));
      if (view.error && !view.chat) throw new Error(view.error);
      assert(view.chat, JSON.stringify(view));
    });
    await shot('10-paired');

    const chatReady = await page.evaluate(() => !document.querySelector('#screen-chat')?.classList.contains('hidden'));
    if (!chatReady) {
      dumps.landing = await page.evaluate(() => ({
        hashOffer: location.hash.startsWith('#offer='),
        connect: document.querySelector('#connect-error')?.textContent || '',
        line: document.querySelector('#device-line')?.textContent || '',
        body: (document.body?.innerText || '').slice(0, 240),
      }));
      throw new Error(`did not reach chat: ${JSON.stringify(dumps.landing)}`);
    }

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 10_000);
    await waitFor(
      page,
      () => document.querySelectorAll('#session-list .session b').length >= 1
        || (document.querySelector('#session-list')?.textContent || '').includes('无法加载'),
      'drawer rows',
      25_000,
    );
    await shot('11-drawer');
    dumps.drawer = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session b')].map((n) => n.textContent),
      heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((n) => n.textContent),
      banner: document.querySelector('#banner')?.textContent || '',
      error: document.querySelector('#session-list')?.textContent?.includes('无法加载') || false,
    }));

    await check('A 会话列表能加载', async () => {
      assert(!dumps.drawer.error, `catalog error banner=${dumps.drawer.banner}`);
      assert(dumps.drawer.titles.length > 0, 'no live session rows');
    });

    await check('A 工作区头（分组）', async () => {
      assert(dumps.drawer.heads.length > 0, `heads=0; sessions are flat`);
    });

    let openedTitle = '';
    await check('E 打开已有会话并载入时间线', async () => {
      const pick = await page.evaluate(() => {
        const preferred = [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session')]
          .find((node) => (node.querySelector('b')?.textContent || '') === 'pong')
          || [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session')][0];
        if (!preferred) return '';
        const title = preferred.querySelector('b')?.textContent || '';
        preferred.click();
        return title;
      });
      assert(pick, 'no session row to open');
      openedTitle = pick;
      await waitFor(
        page,
        () => Boolean(document.querySelector('#log .log-error'))
          || document.querySelectorAll('#log .bubble, #log .msg, #log .turn, #log article, #log p').length > 0
          || !document.querySelector('#blank')?.classList.contains('hidden')
          || Boolean(document.querySelector('#banner:not(.hidden)')?.textContent),
        'history or error',
        20_000,
      );
      await sleep(800);
      dumps.open = await dumpChat(page);
      dumps.open.openedTitle = openedTitle;
      await shot('12-open-session');
      if (dumps.open.timelineError) throw new Error(dumps.open.timelineError);
      if (/无法|失败|host HTTP|typert/i.test(dumps.open.banner)) throw new Error(dumps.open.banner);
    });

    await check('C 模型芯片来自 session.models', async () => {
      await waitFor(
        page,
        () => {
          const banner = document.querySelector('#banner')?.textContent || '';
          const label = (document.querySelector('#model-chip')?.textContent || '').replace(/\s+/g, '');
          return /读取模型失败/i.test(banner) || (label && label !== '模型');
        },
        'model chip or error',
        12_000,
      );
      dumps.models = await dumpChat(page);
      const banner = dumps.models.banner || '';
      assert(!/读取模型失败/i.test(banner), banner);
      const label = (dumps.models.model || '').replace(/\s+/g, '');
      assert(label && label !== '模型', `chip still generic: ${JSON.stringify(dumps.models.model)}`);
    });

    await check('C 发送一条短消息', async () => {
      await page.evaluate(() => {
        window.__dshdLogBefore = document.querySelector('#log')?.textContent || '';
      });
      await page.click('#draft');
      await page.type('#draft', '只回复一个词：pong');
      await page.click('#send-btn');
      await waitFor(
        page,
        () => {
          const banner = document.querySelector('#banner')?.textContent || '';
          const log = document.querySelector('#log')?.textContent || '';
          const stop = !document.querySelector('#stop-btn')?.classList.contains('hidden');
          const prev = window.__dshdLogBefore || '';
          return /无法|失败|host HTTP|typert|只读|断开/i.test(banner)
            || stop
            || (log.includes('只回复一个词：pong') && log.length > prev.length);
        },
        'send result',
        25_000,
      );
      await sleep(500);
      dumps.send = await dumpChat(page);
      await shot('13-send');
      const fail = `${dumps.send.banner}\n${dumps.send.timelineError}`;
      assert(!/无法|失败|host HTTP|typert|只读|断开/i.test(fail), fail.slice(0, 280));
    });

    await check('A 搜索会话', async () => {
      await page.evaluate(() => {
        document.querySelector('#backdrop')?.click();
        document.querySelector('#menu')?.click();
      });
      await waitFor(page, () => {
        const search = document.querySelector('#search');
        return Boolean(search && search.getBoundingClientRect().height > 0);
      }, 'search visible', 10_000);
      await page.evaluate(() => {
        const search = document.querySelector('#search');
        if (!search) return;
        search.focus();
        search.value = '';
      });
      await page.evaluate(() => {
        const search = document.querySelector('#search');
        if (!search) return;
        search.value = 'pong';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(1500);
      dumps.search = await page.evaluate(() => ({
        banner: document.querySelector('#banner')?.textContent || '',
        hits: [...document.querySelectorAll('#session-list .session b')].map((n) => n.textContent),
        body: (document.querySelector('#session-list')?.textContent || '').slice(0, 240),
      }));
      await shot('14-search');
      assert(!/无法|失败|host HTTP|typert/i.test(dumps.search.banner + dumps.search.body), dumps.search.body);
      assert(dumps.search.hits.some((title) => /pong/i.test(title)), `no pong hit: ${dumps.search.hits.slice(0, 8).join('|')}`);
    });

    await check('D Git 顶栏在已打开会话上可见或给出授权错误', async () => {
      dumps.git = await dumpChat(page);
      const text = `${dumps.git.git}\n${dumps.git.banner}\n${dumps.git.connBanner}`;
      if (dumps.git.gitHidden) {
        assert(/Git|授权|workspace|未启动/i.test(text) || dumps.git.git === '', `git hidden with no status: ${text.slice(0, 200)}`);
        throw new Error(`git pill hidden; banner=${dumps.git.banner || '(empty)'}`);
      }
    });
  } finally {
    await writeFile(path.join(SHOT_DIR, 'must-dump.json'), `${JSON.stringify(dumps, null, 2)}\n`, 'utf8');
    await browser.close().catch(() => {});
    await writeFile(path.join(SHOT_DIR, 'must-report.txt'), `${results.join('\n')}\n`, 'utf8');
  }

  console.log(`\n${results.length} checks, ${failures} failed. shots ${SHOT_DIR}`);
  if (failures) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
