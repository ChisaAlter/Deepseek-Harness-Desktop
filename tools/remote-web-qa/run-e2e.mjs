/**
 * Real end-to-end web pairing QA: real daemon child (ChisaCodeRemote), real
 * `generateLocalPairingOffer`, real browser.
 *
 * Away (`remoteMode: 'relay'`): pairing URL is the public nginx SPA
 * (`DEFAULT_PUBLIC_APP_BASE_URL`, not LAN `:3180`, not relay `:8411`). The
 * desktop must not bind `:3180` in this mode.
 *
 * Walks the browser-scan product path from the mobile-remote card: open the
 * pairing URL in Chrome → landing shows the entry-split copy → SPA
 * auto-connects through the relay (E2EE) → paired web client. Then the
 * failure face (garbage offer on the public SPA) and teardown (daemon child
 * exits, `:3180` stays down, no port leaks).
 *
 * Usage:
 *   node tools/remote-web-qa/run-e2e.mjs [--screenshots <dir>] [--relay <host:port>]
 * Requires: puppeteer-core (npm i --no-save puppeteer-core), Chrome, and the
 * vendored server dist (scripts/prepare-chisacode-remote.mjs). Relay defaults
 * to the product default endpoint; pass --relay for a local/test relay.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ChisaCodeRemote } = require('../../src/main/chisacode-remote.js');
const { DEFAULT_PUBLIC_APP_BASE_URL } = require('../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH
  || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    : '/usr/local/bin/google-chrome');
const shotArg = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotArg > -1 ? process.argv[shotArg + 1] : '/tmp/remote-web-e2e';
const relayArg = process.argv.indexOf('--relay');
const RELAY_OVERRIDE = relayArg > -1 ? process.argv[relayArg + 1] : '';

const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`NOT OK - ${name}: ${error?.message || error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(fn, message, timeout = 30_000, step = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await sleep(step);
  }
  throw new Error(`timeout: ${message}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  console.log(`[shot] ${name}.png`);
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-e2e-'));
  const listenPort = 17000 + Math.floor(Math.random() * 20000);
  const config = {
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteListen: `127.0.0.1:${listenPort}`,
    ...(RELAY_OVERRIDE ? { remoteRelayEndpoint: RELAY_OVERRIDE, remoteRelayUseTls: false } : {}),
  };
  const remote = new ChisaCodeRemote({
    getConfig: () => config,
    getHomeDir: () => home,
    readyTimeoutMs: 90_000,
    log: (line) => console.log(`[remote] ${line}`),
  });

  let browser = null;
  try {
    // -- Desktop side up ----------------------------------------------------
    await check('daemon 子进程启动；外出 pairingUrl 走公网 SPA，不启 :3180', async () => {
      await remote.startDaemon();
      const snap = remote.snapshot();
      assert(snap.listening === true, `listening=${snap.listening}`);
      const pairingUrl = snap.urls[0]?.pairingUrl || '';
      assert(/#offer=/.test(pairingUrl), 'no pairing url');
      const u = new URL(pairingUrl);
      assert(u.port !== '8411', `QR must not land on relay :8411: ${u.origin}`);
      assert(u.port !== '3180', `Away QR must not land on LAN :3180: ${u.origin}`);
      const expected = new URL(DEFAULT_PUBLIC_APP_BASE_URL);
      assert(u.origin === expected.origin, `SPA origin ${u.origin} !== ${expected.origin}`);
      assert(u.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, ''), `SPA path ${u.pathname}`);
      const landing = `${u.origin}${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}`;
      const res = await fetch(landing, { redirect: 'manual' });
      assert(res.ok, `public SPA status ${res.status} at ${landing}`);
      let lanUp = false;
      try {
        const lan = await fetch('http://127.0.0.1:3180/', { signal: AbortSignal.timeout(2000) });
        lanUp = lan.ok;
      } catch {
        lanUp = false;
      }
      assert(!lanUp, 'Away must keep :3180 closed');
    });

    await check('daemon 与中继 control socket 已连接（relayConnected）', async () => {
      await waitFor(
        () => remote.snapshot().relayConnected === true,
        `relayConnected (lastError=${remote.snapshot().relayError})`,
        30_000,
      );
    });

    const pairingUrl = remote.snapshot().urls[0]?.pairingUrl || '';
    console.log(`[e2e] pairing url: ${pairingUrl.slice(0, 80)}…`);

    await check('pairingUrl 非 loopback（公网 SPA origin，非 secure context）', async () => {
      const u = new URL(pairingUrl);
      assert(
        !['127.0.0.1', 'localhost', '::1'].includes(u.hostname),
        `loopback origin masks non-secure context bugs: ${u.hostname}`,
      );
    });

    // -- Browser side -------------------------------------------------------
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 414, height: 896 });
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`${msg.text()} @ ${msg.location()?.url || ''}`);
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await check('浏览器打开真实配对 URL：落地页渲染 + 入口分流文案可见', async () => {
      await page.goto(pairingUrl, { waitUntil: 'domcontentloaded' });
      await waitFor(
        () => page.evaluate(() => {
          const hint = document.getElementById('entry-split-hint');
          return Boolean(hint && hint.textContent.includes('web 端') && hint.offsetParent !== null);
        }),
        'entry-split hint visible',
        10_000,
      );
      await shot(page, '01-landing-entry-split');
    });

    await check('SPA 自动 connect()：经中继 E2EE 配对成功进入 web 端', async () => {
      await waitFor(
        () => page.evaluate(() => {
          const line = document.getElementById('device-line');
          return Boolean(line && /已配对|已重连/.test(line.textContent));
        }),
        'paired device line',
        60_000,
      );
      const errorText = await page.evaluate(
        () => document.getElementById('connect-error')?.textContent?.trim() || '',
      );
      assert(!errorText, `connect error visible: ${errorText}`);
      await shot(page, '02-paired-web-client');
    });

    await check('配对后 web 端主界面（hub/会话）可用，无应用级控制台错误', async () => {
      const state = await page.evaluate(() => ({
        deviceLine: document.getElementById('device-line')?.textContent || '',
        connectHidden: document.getElementById('screen-connect')?.classList.contains('hidden') ?? false,
      }));
      assert(state.connectHidden, 'connect screen still visible after pairing');
      const appErrors = consoleErrors.filter((line) => !/favicon|apple-touch-icon|net::ERR_/.test(line));
      assert(appErrors.length === 0, `console errors: ${appErrors.join(' | ')}`);
      await shot(page, '03-web-client-home');
    });

    // -- Failure face ---------------------------------------------------------
    await check('垃圾 offer：可见错误态，不假装配对', async () => {
      const bad = await browser.newPage();
      await bad.setViewport({ width: 414, height: 896 });
      const spaOrigin = new URL(pairingUrl);
      const garbageUrl = `${spaOrigin.origin}${spaOrigin.pathname}#offer=not-a-real-offer`;
      await bad.goto(garbageUrl, { waitUntil: 'domcontentloaded' });
      await waitFor(
        () => bad.evaluate(() => {
          const error = document.getElementById('connect-error');
          return Boolean(error && error.textContent.trim().length > 0);
        }),
        'error visible for garbage offer',
        15_000,
      );
      const errorText = await bad.evaluate(() => document.getElementById('connect-error').textContent.trim());
      console.log(`[e2e] garbage-offer error: ${errorText}`);
      const paired = await bad.evaluate(
        () => /已配对|已重连/.test(document.getElementById('device-line')?.textContent || ''),
      );
      assert(!paired, 'garbage offer must not pair');
      await shot(bad, '04-bad-offer-error');
      await bad.close();
    });

    await check('无 hash 且无 sticky：停留连接页（微信丢 hash）', async () => {
      const context = await browser.createBrowserContext();
      const fresh = await context.newPage();
      await fresh.setViewport({ width: 414, height: 896 });
      const spa = new URL(pairingUrl);
      const landing = `${spa.origin}${spa.pathname.endsWith('/') ? spa.pathname : `${spa.pathname}/`}`;
      await fresh.goto(landing, { waitUntil: 'domcontentloaded' });
      await sleep(3_000);
      const state = await fresh.evaluate(() => ({
        line: document.getElementById('device-line')?.textContent || '',
        wechat: (document.body.textContent || '').includes('微信'),
        connectHidden: document.getElementById('screen-connect')?.classList.contains('hidden') ?? null,
      }));
      assert(!/已配对|已重连/.test(state.line), `must not pair without offer or sticky: ${state.line}`);
      assert(state.wechat, 'WeChat strip warning missing');
      assert(state.connectHidden === false, 'connect screen should stay visible');
      await shot(fresh, '04b-wechat-no-hash');
      await fresh.close();
      await context.close();
    });

    // -- Teardown / no leaks --------------------------------------------------
    await check('stopDaemon：子进程退出、:3180 仍关闭、snapshot 回落', async () => {
      const child = remote.daemon.child;
      await remote.stopDaemon();
      assert(child.exitCode !== null || child.signalCode, 'daemon child still running');
      const snap = remote.snapshot();
      assert(snap.listening === false, 'snapshot still listening');
      assert(snap.error === '', `stale error after deliberate stop: ${snap.error}`);
      let refused = false;
      try {
        await fetch('http://127.0.0.1:3180/', { signal: AbortSignal.timeout(3000) });
      } catch {
        refused = true;
      }
      assert(refused, ':3180 still serving after stopDaemon');
      let daemonRefused = false;
      try {
        await fetch(`http://127.0.0.1:${listenPort}/`, { signal: AbortSignal.timeout(3000) });
      } catch {
        daemonRefused = true;
      }
      assert(daemonRefused, `daemon port ${listenPort} still serving after stopDaemon`);
    });

    await check('断开后浏览器侧可见断线（不得假装在线）', async () => {
      await waitFor(
        () => page.evaluate(() => {
          const banner = document.querySelector('.conn-banner, #banner, .banner');
          const bodyText = document.body.textContent || '';
          return (banner && banner.textContent.trim().length > 0)
            || /断开|重新连接|重连/.test(bodyText);
        }),
        'disconnect visible in web client',
        30_000,
      );
      await shot(page, '05-disconnected');
    });
  } finally {
    if (browser) await browser.close();
    if (remote.daemon) await remote.stopDaemon();
  }

  console.log('\n=== remote web e2e ===');
  for (const line of results) console.log(line);
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('e2e driver crashed:', error);
  process.exit(1);
});
