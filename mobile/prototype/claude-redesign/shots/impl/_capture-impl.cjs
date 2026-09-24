/**
 * Real-SPA visual capture for the mobile-remote Claude-structure redesign.
 * Serves mobile/web via tools/mobile-web-qa fake host, pairs with #offer=QAFAKE,
 * then captures each redesign state at 412x917 in light and dark.
 */
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const puppeteer = require('puppeteer-core');
const { startQaServer, qaServerUrl } = require('../../../../../tools/mobile-web-qa/server.mjs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, message, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function main() {
  const server = await startQaServer({ port: 0, prefix: '/dshd/' });
  const BASE = qaServerUrl(server).replace(/\/$/, '');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const consoleErrors = [];
  for (const theme of ['light', 'dark']) {
    // Fresh profile per theme so the first run's stored pairing cannot skip
    // the connect screen on the second run.
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 412, height: 917, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    // The SPA persists its own scheme (dsh-phone-scheme); media emulation
    // alone cannot switch a stored/default 'light' choice.
    await page.evaluateOnNewDocument((value) => {
      try { localStorage.setItem('dsh-phone-scheme', value); } catch { /* ignore */ }
    }, theme);
    page.on('console', (m) => {
      const url = m.location()?.url || '';
      if (m.type() === 'error' && !url.includes('favicon')) consoleErrors.push(`[${theme}] ${m.text()} (${url})`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[${theme}] ${String(e)}`));
    const shot = (name) => page.screenshot({ path: join(OUT, `${name}-${theme}.png`) });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await waitFor(page, () => !document.querySelector('#screen-connect').classList.contains('hidden'), 'connect screen');
    await shot('connect');

    await page.type('#paste', `${BASE}/#offer=QAFAKE`);
    await page.click('#paste-enter');
    await waitFor(page, () => !document.querySelector('#screen-chat').classList.contains('hidden'), 'chat visible');
    await waitFor(page, () => !document.querySelector('#blank').classList.contains('hidden'), 'blank hero');
    await shot('blank-home');

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer open');
    await shot('drawer');

    await page.evaluate(() => document.querySelector('#nav-sessions')?.click());
    await waitFor(page, () => !document.querySelector('#sessions-page').classList.contains('hidden'), 'sessions page');
    await shot('sessions-page');
    await page.evaluate(() => document.querySelector('#sessions-back')?.click());
    await waitFor(page, () => document.querySelector('#sessions-page').classList.contains('hidden'), 'sessions closed');

    // Open a real session for the conversation + approval state.
    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer open again');
    await page.evaluate(() => document.querySelector('#nav-sessions')?.click());
    await waitFor(page, () => !document.querySelector('#sessions-page').classList.contains('hidden'), 'sessions page again');
    const opened = await page.evaluate(() => {
      const row = document.querySelector('#session-list .session-row .session:not(.workspace-toggle)');
      if (!row) return false;
      row.click();
      return true;
    });
    if (opened) {
      await waitFor(page, () => document.querySelector('#sessions-page').classList.contains('hidden'), 'session opened');
      await page.evaluate(() => {
        window.__qa.emitMux({
          rpcId: 'r-approve',
          envelope: {
            type: 'server-request', rpcId: 'r-approve',
            payload: { type: 'approval/requested', sessionId: 's-1', approvalId: 'a-1', toolName: 'bash', reason: 'rm -rf build' },
          },
        });
      });
      await waitFor(page, () => !document.querySelector('#approval').classList.contains('hidden'), 'approval card');
      await shot('conversation-approval');
    }

    // Model bottom sheet root + thinking-effort drill page.
    await page.evaluate(() => document.querySelector('#model-chip')?.click());
    await waitFor(page, () => Boolean(document.querySelector('.bottom-layer')), 'model bottom sheet');
    await shot('model-sheet');
    const drilled = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.bottom-layer .drill, .bottom-layer .link-row')]
        .find((node) => node.textContent.includes('思考强度'));
      if (!row) return false;
      row.click();
      return true;
    });
    if (drilled) {
      await sleep(250);
      await shot('model-sheet-effort');
    }
    await page.evaluate(() => document.querySelector('.bottom-layer .sheet-mask')?.click());
    await sleep(150);

    // Settings hub.
    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer for settings');
    await page.evaluate(() => document.querySelector('#nav-settings')?.click());
    await waitFor(page, () => !document.querySelector('#settings').classList.contains('hidden'), 'settings hub');
    await shot('settings-hub');

    // Sub-panes must not clip either.
    const openPane = async (name) => page.evaluate((pane) => {
      const row = pane === '连接详情'
        ? document.querySelector('#options .acct')
        : [...document.querySelectorAll('#options .link-row')]
          .find((node) => node.textContent.includes(pane));
      if (!row) return false;
      row.click();
      return true;
    }, name);
    if (await openPane('连接详情')) {
      await waitFor(page, () => !document.querySelector('#settings-back').classList.contains('hidden'), 'connection pane');
      await shot('settings-connection');
      await page.evaluate(() => document.querySelector('#settings-back')?.click());
      await waitFor(page, () => document.querySelector('#settings-back').classList.contains('hidden'), 'back to hub');
    }
    if (await openPane('外观')) {
      await waitFor(page, () => !document.querySelector('#settings-back').classList.contains('hidden'), 'appearance pane');
      await shot('settings-appearance');
    }

    await context.close();
  }
  await browser.close();
  await server.close();
  console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
}

main().catch((error) => { console.error(error); process.exit(1); });
