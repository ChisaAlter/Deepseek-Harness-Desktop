/**
 * Best-effort unlist of leftover dshd-ws-live-* heads. Does not log #offer=.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../../../../src/main/chisacode-remote.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../../../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

function chromePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

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

async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function main() {
  if (!(await portOpen(3180)) || !(await portOpen(6767))) throw new Error('desktop not listening');
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
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
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
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 10_000);
    await sleep(800);
    const stale = await page.evaluate(() => [...document.querySelectorAll('#session-list .workspace-head b')]
      .map((n) => n.textContent || '')
      .filter((t) => t.includes('dshd-ws-live-')));
    console.log(`stale ${stale.length}: ${stale.join(' | ')}`);
    for (const title of stale) {
      await page.evaluate((name) => {
        document.querySelector('.sheet-mask')?.click();
        document.querySelector('.dialog .ghost-btn')?.click();
      });
      await sleep(200);
      await page.evaluate((name) => {
        const head = [...document.querySelectorAll('#session-list .workspace-head')]
          .find((node) => (node.querySelector('b')?.textContent || '') === name);
        head?.querySelector('[aria-label="工作区操作"]')?.click();
      }, title);
      await sleep(300);
      const removed = await page.evaluate(() => {
        const item = [...document.querySelectorAll('.sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '从列表移除');
        item?.click();
        return Boolean(item);
      });
      if (!removed) {
        console.log(`skip ${title}: no unlist`);
        continue;
      }
      await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'confirm', 5_000);
      await page.evaluate(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === '移除')?.click());
      await sleep(700);
      console.log(`unlisted ${title}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
