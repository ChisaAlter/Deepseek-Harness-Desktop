/**
 * LAN :3180 rehearsal: workspace heads/grouping against the running daemon.
 * Does not bounce the product, does not log #offer=.
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
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);

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

async function pairingUrl() {
  const home = path.join(USER_DATA, 'chisacode-home');
  if (!existsSync(home)) throw new Error('missing chisacode-home');
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
  if (!rawUrl || !/#offer=/.test(rawUrl)) throw new Error('no pairing url');
  return loopbackPairing(rawUrl);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  if (!(await portOpen(3080))) throw new Error('dsh web is not on 127.0.0.1:3080');
  if (!(await portOpen(3180))) throw new Error('LAN SPA is not on 127.0.0.1:3180');
  if (!(await portOpen(6767))) throw new Error('Electron daemon is not on :6767');

  const url = await pairingUrl();
  console.log(`[lan-workspace] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const dump = {};

  try {
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
    if (!view.chat) throw new Error(`did not reach chat: ${JSON.stringify(view)}`);

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 10_000);
    await waitFor(
      page,
      () => document.querySelectorAll('#session-list .session b').length >= 1
        || (document.querySelector('#session-list')?.textContent || '').includes('无法加载'),
      'drawer rows',
      25_000,
    );
    await sleep(400);
    dump.drawer = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#session-list .workspace-head')].map((head) => ({
        title: head.querySelector('b')?.textContent || '',
        add: Boolean(head.querySelector('[aria-label="在此工作区新建会话"]')),
        more: Boolean(head.querySelector('[aria-label="工作区操作"]')),
      }));
      return {
        heads,
        titles: [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session b')].map((n) => n.textContent),
        banner: document.querySelector('#banner')?.textContent || '',
        error: (document.querySelector('#session-list')?.textContent || '').includes('无法加载'),
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, '20-workspace-heads.png') });
    await writeFile(path.join(SHOT_DIR, 'workspace-dump.json'), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');

    if (dump.drawer.error) throw new Error(`catalog error banner=${dump.drawer.banner}`);
    if (!dump.drawer.heads.length) throw new Error(`heads=0; sessions are flat titles=${dump.drawer.titles.slice(0, 8).join('|')}`);
    if (dump.drawer.heads.some((head) => !head.title || !head.add || !head.more)) {
      throw new Error(`workspace head missing title/+/⋯: ${JSON.stringify(dump.drawer.heads)}`);
    }
    console.log(`ok - workspace heads ${dump.drawer.heads.length}: ${dump.drawer.heads.map((h) => h.title).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
