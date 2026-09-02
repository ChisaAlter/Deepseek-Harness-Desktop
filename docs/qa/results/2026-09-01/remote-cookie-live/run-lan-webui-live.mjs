/**
 * Remote Web UI pane walk. Every settings page + chat chrome.
 * Does not bounce daemon, does not log #offer=, does not logout.
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
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((file) => existsSync(file));
}

const CHROME = chromePath();
const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
const USER_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Deepseek-Harness-Desktop');
const PANES = ['连接详情', '通用设置', '权限', '模型', '工作区', '文件', '外观', '电脑外观', '界面设置', 'MCP', '技能', '插件', '市场', '关于'];

const results = [];
let failures = 0;
const dumps = {};

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`NOT OK - ${name}: ${error.message || error}`);
    console.log(`NOT OK - ${name}: ${error.message || error}`);
  }
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
}
function pairingSummary(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
}
async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}
async function dumpPane(page) {
  return page.evaluate(() => ({
    title: document.querySelector('#settings-title')?.textContent || '',
    body: (document.querySelector('#options')?.innerText || '').replace(/\s+/g, ' ').slice(0, 420),
    error: document.querySelector('#banner')?.textContent || '',
  }));
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), 'no browser');
  assert(await portOpen(3080) && await portOpen(3180) && await portOpen(6767), 'desktop remote not up');

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
  console.log(`[webui] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `webui-${name}.png`) });

  try {
    await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.evaluate((offerUrl) => {
      const input = document.querySelector('#paste');
      if (input) input.value = offerUrl;
      document.querySelector('#paste-enter')?.click();
    }, url);
    await waitFor(page, () => !document.querySelector('#screen-chat')?.classList.contains('hidden'), 'chat', 90_000);
    await shot('00-chat');

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 8_000);
    await page.evaluate(() => document.querySelector('#open-settings')?.click());
    await waitFor(page, () => (document.querySelector('#options')?.innerText || '').length > 8, 'hub', 8_000);
    dumps.hub = await dumpPane(page);
    await shot('01-hub');
    await check('设置 Hub 列出全部入口', async () => {
      const missing = PANES.filter((name) => !dumps.hub.body.includes(name) && name !== '通用设置');
      // 通用设置 may be listed
      const hubMissing = ['连接详情', '权限', '模型', '工作区', '文件', '外观', '电脑外观', '界面设置', 'MCP', '技能', '插件', '市场', '关于']
        .filter((name) => !dumps.hub.body.includes(name));
      assert(hubMissing.length === 0, `hub missing ${hubMissing.join(',')}; ${dumps.hub.body.slice(0, 200)}`);
    });

    for (const [index, pane] of PANES.entries()) {
      await check(`WebUI ${pane}`, async () => {
        await page.evaluate(() => {
          document.querySelector('#settings-back')?.click();
        });
        await sleep(200);
        if (!(await page.evaluate(() => (document.querySelector('#options')?.innerText || '').includes('连接详情')))) {
          await page.evaluate(() => document.querySelector('#open-settings')?.click());
          await sleep(250);
        }
        const clicked = await page.evaluate((name) => {
          const nodes = [...document.querySelectorAll('#options button, #options .row, #options [role="button"]')];
          const hit = nodes.find((node) => node.textContent.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')));
          if (!hit) return false;
          hit.click();
          return true;
        }, pane);
        assert(clicked, `no hub row for ${pane}`);
        await sleep(500);
        const dump = await dumpPane(page);
        dumps[pane] = dump;
        await shot(`${String(index + 2).padStart(2, '0')}-${pane}`);
        assert(!/host HTTP 401|host HTTP 404|typert gateway/i.test(dump.body + dump.error), dump.error || dump.body.slice(0, 180));
        assert(dump.body.length > 0 || dump.title === pane, `empty pane ${pane}`);
      });
    }
  } finally {
    await writeFile(path.join(SHOT_DIR, 'webui-dump.json'), `${JSON.stringify(dumps, null, 2)}\n`, 'utf8');
    await writeFile(path.join(SHOT_DIR, 'webui-report.txt'), `${results.join('\n')}\n`, 'utf8');
    await browser.close().catch(() => {});
  }
  console.log(`\n${results.length} checks, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
