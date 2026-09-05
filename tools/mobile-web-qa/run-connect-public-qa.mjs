// Explicit live QA: uses the running desktop and creates one temporary paired
// device, revoked in finally. Never logs offers, secrets, or conversation text.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../src/main/chisacode-remote.js');
const home = join(process.env.APPDATA, 'Deepseek-Harness-Desktop', 'chisacode-home');
const base = 'http://125.124.85.212:3389/dshd/';
const storageKey = 'dsh-chisacode-device-secrets';
const serverId = readFileSync(join(home, 'server-id'), 'utf8').trim();
const publicKey = JSON.parse(readFileSync(join(home, 'daemon-keypair.json'), 'utf8')).publicKeyB64;
const devices = JSON.parse(readFileSync(join(home, 'relay-devices.json'), 'utf8')).devices;
const revoked = devices.filter((device) => device.revokedAt).at(-1);
const qaId = `dev_qa_${randomUUID().replaceAll('-', '')}`;
const api = await loadServerApi();
const cycles = Math.max(1, Number(process.env.DSHD_REMOTE_QA_CYCLES) || 1);
const localAssets = process.env.DSHD_REMOTE_QA_LOCAL === '1';
const direct = process.env.DSHD_REMOTE_QA_DIRECT === '1';
let browser;
let pairingToken;
const publicBundles = new Map();

async function connectionResult(page) {
  await page.waitForFunction(() => (
    !document.querySelector('#screen-chat').classList.contains('hidden')
    || Boolean(document.querySelector('#connect-error').textContent)
  ), { timeout: 120000 });
  return page.evaluate(() => ({
    chat: !document.querySelector('#screen-chat').classList.contains('hidden'),
    error: document.querySelector('#connect-error').textContent,
    banner: document.querySelector('#banner').textContent,
    canRetry: !document.querySelector('.saved-open')?.disabled,
    navigationToResultMs: Math.round(performance.now()),
  }));
}

try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(existsSync),
    headless: true,
    args: direct ? ['--no-proxy-server'] : [],
  });
  const page = await browser.newPage();
  {
    const webRoot = fileURLToPath(new URL('../../mobile/web/', import.meta.url));
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/dshd/')) {
        void request.continue();
        return;
      }
      const relative = url.pathname.slice('/dshd/'.length) || 'index.html';
      if (!localAssets && relative !== 'chisacode/daemon-client.bundle.js') {
        void request.continue();
        return;
      }
      const file = resolve(webRoot, relative);
      if (!file.startsWith(webRoot) || !existsSync(file)) {
        void request.respond({ status: 404, body: '' });
        return;
      }
      const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
      let body;
      if (localAssets) {
        body = readFileSync(file);
      } else {
        try {
          // Reuse the same fetched public build, like a browser module cache.
          // Re-downloading it for every navigation distorts relay measurements.
          if (!publicBundles.has(request.url())) {
            const response = await fetch(request.url(), { signal: AbortSignal.timeout(90000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            publicBundles.set(request.url(), Buffer.from(await response.arrayBuffer()));
          }
          body = publicBundles.get(request.url());
        } catch (error) {
          console.error('Unable to instrument public bundle:', error.message);
          void request.abort();
          return;
        }
      }
      if (relative === 'chisacode/daemon-client.bundle.js') {
        body = Buffer.concat([body, Buffer.from(`
const rawHostRpc = DaemonClient.prototype.hostRpc;
DaemonClient.prototype.hostRpc = async function(method, ...args) {
  window.__qaHostClient = this;
  const start = performance.now();
  window.__qaRpcTimes ??= [];
  try {
    const value = await rawHostRpc.call(this, method, ...args);
    if (method === 'session.list') {
      const totals = {};
      for (const item of value.value?.items || []) {
        for (const [key, field] of Object.entries(item)) totals[key] = (totals[key] || 0) + JSON.stringify(field).length;
        for (const [key, field] of Object.entries(item.projections?.values || {})) totals['projection:'+key] = (totals['projection:'+key] || 0) + JSON.stringify(field).length;
      }
      window.__qaCatalogSizes = totals;
    }
    window.__qaRpcTimes.push({ method, ms: Math.round(performance.now()-start), items: value.value?.items?.length, ok: value.ok, bytes: new TextEncoder().encode(JSON.stringify(value)).length });
    return value;
  } catch (error) {
    window.__qaRpcTimes.push({ method, ms: Math.round(performance.now()-start), error: error.message });
    throw error;
  }
};`)]);
      }
      void request.respond({ status: 200, contentType: mime[extname(file)] || 'application/octet-stream', body });
    });
  }
  page.on('requestfailed', (request) => {
    console.log('Request failed:', new URL(request.url()).pathname, request.failure()?.errorText);
  });
  await page.setViewport({ width: 390, height: 844 });
  console.log(`Rehearsal source: ${localAssets ? 'local SPA with real public relay' : 'deployed public SPA; bundle timing instrumentation only'}`);
  console.log(`Browser routing: ${direct ? 'direct (QA browser only)' : 'inherited system proxy settings'}`);
  if (revoked) {
    const seed = await page.evaluateOnNewDocument((key, record) => {
      localStorage.setItem(key, JSON.stringify(record));
    }, storageKey, { [serverId]: {
      deviceId: revoked.deviceId, deviceSecret: revoked.secret,
      daemonPublicKeyB64: publicKey, relayEndpoint: '125.124.85.212:8411',
      useTls: false, savedAt: Date.now(),
    } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const rejected = await connectionResult(page);
    assert.equal(rejected.chat, false);
    assert.ok(rejected.error);
    assert.equal(rejected.canRetry, true);
    console.log('PASS public revoked-device rejection restores saved-device controls');
    console.log('Connection error:', rejected.error);
    await page.removeScriptToEvaluateOnNewDocument(seed.identifier);
  } else {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.evaluate((key, id, deviceId) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify({ [id]: { deviceId } }));
  }, storageKey, serverId, qaId);
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: home, relayEnabled: true,
    relayEndpoint: '125.124.85.212:8411', relayPublicEndpoint: '125.124.85.212:8411',
    relayUseTls: false, relayPublicUseTls: false, appBaseUrl: base, includeQr: false,
  });
  const offer = JSON.parse(Buffer.from(new URL(pairing.url).hash.slice(7), 'base64url'));
  pairingToken = offer.authBootstrap.pairingToken;
  // A hash-only navigation does not rerun app.js. Simulate reopening the
  // landing page, not changing the address of the already-failed page.
  await page.goto('about:blank');
  await page.goto(pairing.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const paired = await connectionResult(page);
  console.log('Pair result', JSON.stringify(paired));
  console.log('Pair RPC timings', JSON.stringify(await page.evaluate(() => window.__qaRpcTimes || [])));
  if (localAssets) console.log('Catalog field sizes', JSON.stringify(await page.evaluate(() => window.__qaCatalogSizes || {})));
  assert.equal(paired.chat, true, paired.error);
  assert.equal(paired.banner, '', paired.banner);
  assert.equal(await page.evaluate((key, id) => JSON.parse(localStorage.getItem(key))[id].deviceId, storageKey, serverId), qaId);
  console.log('PASS public fresh offer pairs and loads the real host catalog');
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await page.goto('about:blank');
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const reconnected = await connectionResult(page);
    console.log('Reconnect result', JSON.stringify(reconnected));
    console.log('RPC timings', JSON.stringify(await page.evaluate(() => window.__qaRpcTimes || [])));
    if (reconnected.banner && localAssets) {
      console.log('Retrying catalog probe on the same authenticated connection');
      console.log('Probe', JSON.stringify(await page.evaluate(async () => {
        const client = window.__qaHostClient;
          const results = await Promise.all(['workspace.list', 'session.list'].map(async (method) => {
            const start = performance.now();
            try {
              const result = await client.hostRpc(method, {});
              return { method, ms: Math.round(performance.now()-start), ok: result.ok, bytes: JSON.stringify(result).length };
            } catch (error) { return { method, error: error.message }; }
          }));
          return results;
      })));
    }
    assert.equal(reconnected.chat, true, reconnected.error);
    assert.equal(reconnected.banner, '', reconnected.banner);
    console.log(`PASS saved-device reconnect ${cycle}/${cycles}`);
  }
} catch (error) {
  console.error(String(error?.message || error).replace(/#offer=[A-Za-z0-9_-]+/g, '#offer=<redacted>'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  const store = new api.RelayDeviceCredentialStore(home);
  if (store.getDevice(qaId)) {
    store.revokeDevice(qaId);
    console.log('Temporary QA device revoked');
  }
  if (pairingToken) store.consumePairingToken(pairingToken);
}
