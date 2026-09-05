import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startQaServer } from './server.mjs';

const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const output = join(process.env.TEMP || '.', 'dshd-connect-qa');
await mkdir(output, { recursive: true });
const server = await startQaServer(0);
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fakeSource = await readFile(new URL('./fake-daemon-client.mjs', import.meta.url), 'utf8');
  assert.ok(fakeSource.includes('  async connect() {'));
  const controlledSource = fakeSource.replace('  async connect() {', `
  async connect() {
    await new Promise((resolve, reject) => {
      window.__connectGate = { resolve, reject };
    });`);
  for (const width of [390, 1280]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/chisacode/daemon-client.bundle.js') {
        void request.respond({ status: 200, contentType: 'text/javascript', body: controlledSource });
      } else void request.continue();
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('dsh-chisacode-device-secrets', JSON.stringify({
        srv_saved: {
          deviceId: 'dev_qa', deviceSecret: 'secret_qa', daemonPublicKeyB64: 'key_qa',
          relayEndpoint: 'relay.example:8411', useTls: false, savedAt: 1,
        },
      }));
    });
    await page.goto(base, { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#device-line', (node) => node.textContent), '正在连接电脑…');
    assert.equal(await page.$eval('.saved-open', (node) => node.disabled), true);
    await page.screenshot({ path: join(output, `${width}-connecting.png`), fullPage: true });
    await page.evaluate(() => window.__connectGate.reject(new Error('Connection timed out')));
    await page.waitForFunction(() => !document.querySelector('.saved-open').disabled);
    assert.equal(await page.$eval('#device-line', (node) => node.textContent), '连接失败');
    assert.match(await page.$eval('#connect-error', (node) => node.textContent), /Connection timed out/);
    assert.equal(await page.$eval('#paste-enter', (node) => node.disabled), false);
    assert.equal(await page.evaluate(() => window.__qa.calls.filter((call) => call.method === 'close').length), 1);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets')).srv_saved));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, `${width}-failed.png`), fullPage: true });
    await page.click('.saved-open');
    await page.waitForFunction(() => document.querySelector('.saved-open').disabled);
    await page.evaluate(() => {
      window.__oldConnectGate = window.__connectGate;
      location.hash = '#offer=QAFAKE';
    });
    await page.waitForFunction(() => window.__qa.clients.length === 3);
    assert.equal(await page.evaluate(() => window.__qa.calls.filter((call) => call.method === 'close').length), 2);
    await page.evaluate(() => window.__oldConnectGate.resolve());
    await page.evaluate(() => window.__connectGate.resolve());
    await page.waitForFunction(() => !document.querySelector('#screen-chat').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.__qa.clients.at(-1).reconnectEnabled), true);
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: auto-connect, failure, cleanup, saved credentials, retry superseded by a new offer, chat, consumed fragment cleared`);
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
