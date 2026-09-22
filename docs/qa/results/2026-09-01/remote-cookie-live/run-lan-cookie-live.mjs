/**
 * Rehearsal: LAN :3180 SPA against the already-running Electron daemon.
 * Does not bounce daemon, does not start Harness, does not log #offer=.
 *
 * Pass for the host-cookie fix: drawer has no 「无法加载会话」 / host HTTP 401.
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

async function dumpDrawer(page) {
  return page.evaluate(() => ({
    titles: [...document.querySelectorAll('#session-list .session b')].map((node) => node.textContent),
    heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((node) => node.textContent),
    error: [...document.querySelectorAll('#session-list .row-desc')].map((node) => node.textContent).join('|'),
    body: document.querySelector('#session-list')?.textContent || '',
    banner: document.querySelector('#banner')?.textContent || '',
    device: document.querySelector('#device-line')?.textContent || '',
    connectError: document.querySelector('#connect-error')?.textContent || '',
  }));
}

function catalogDump(drawer) {
  return `${drawer.banner}\n${drawer.body}\n${drawer.error}\n${drawer.connectError}`;
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), `missing browser at ${CHROME}`);
  assert(await portOpen(3080), 'dsh web is not on 127.0.0.1:3080');
  assert(await portOpen(3180), 'LAN SPA is not on 127.0.0.1:3180');
  assert(await portOpen(6767), 'Electron daemon is not on :6767');

  const pairingFile = path.join(USER_DATA, 'pairing-url.txt');
  let rawUrl = '';
  if (existsSync(pairingFile)) {
    rawUrl = readFileSync(pairingFile, 'utf8').trim().split(/\r?\n/)[0];
  }
  if (!rawUrl || !/#offer=/.test(rawUrl)) {
    const home = path.join(USER_DATA, 'chisacode-home');
    assert(existsSync(home), `missing chisacode-home at ${home}`);
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
    rawUrl = pairing?.url || '';
  }
  assert(rawUrl && /#offer=/.test(rawUrl), 'no pairing url');
  const url = loopbackPairing(rawUrl);
  console.log(`[lan-cookie-live] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

  try {
    await check('用 LAN :3180/#offer= 配对进 chat', async () => {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
      try {
        await waitFor(
          page,
          () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
            || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
          'chat or connect error',
          90_000,
        );
      } catch (error) {
        await shot('pair-timeout');
        throw error;
      }
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        error: document.querySelector('#connect-error')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      if (view.error && !view.chat) throw new Error(`connect error: ${view.error}`);
      assert(view.chat, `did not reach chat: ${JSON.stringify(view)}`);
    });
    await shot('01-paired');

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer open', 10_000);
    await waitFor(
      page,
      () => document.querySelectorAll('#session-list .session b').length >= 1
        || (document.querySelector('#session-list')?.textContent || '').includes('无法加载')
        || (document.querySelector('#session-list')?.textContent || '').includes('桌面端未启动')
        || (document.querySelector('#banner')?.textContent || '').includes('无法加载')
        || (document.querySelector('#session-list')?.textContent || '').includes('没有会话'),
      'drawer populated or error',
      25_000,
    );
    await shot('02-drawer');

    const drawer = await dumpDrawer(page);
    await writeFile(path.join(SHOT_DIR, 'drawer.json'), `${JSON.stringify(drawer, null, 2)}\n`, 'utf8');
    console.log(`[lan-cookie-live] titles=${drawer.titles.length} banner=${JSON.stringify(drawer.banner)}`);

    await check('会话目录没有 host HTTP 401', async () => {
      const dump = catalogDump(drawer);
      assert(!/host HTTP 401/i.test(dump), `still 401: ${dump.slice(0, 280)}`);
      assert(!dump.includes('无法加载会话'), `catalog failed: ${dump.slice(0, 280)}`);
    });

    await check('会话目录不是桌面端未启动', async () => {
      const dump = catalogDump(drawer);
      assert(!dump.includes('桌面端未启动'), `harness-down: ${dump.slice(0, 200)}`);
    });
  } finally {
    await browser.close().catch(() => {});
    await writeFile(path.join(SHOT_DIR, 'report.txt'), `${results.join('\n')}\n`, 'utf8');
  }

  console.log(`\n${results.length} checks, ${failures} failed. shots ${SHOT_DIR}`);
  if (failures) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
