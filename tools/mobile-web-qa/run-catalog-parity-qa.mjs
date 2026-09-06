/** Run local and optional deployed catalog modules against the same fixture; requires playwright-core. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startQaServer } from './server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');

const scratchCwd = '/home/dsh/no-workspace';
const fixture = {
  sessions: { items: [
    { sessionId: 'member', cwd: '/project', blank: false },
    { sessionId: 'task', cwd: scratchCwd, blank: false },
    { sessionId: 'archived-member', cwd: '/project', blank: false },
    { sessionId: 'removed', cwd: '/removed', blank: false },
    { sessionId: 'removed-archive', cwd: '/removed', blank: false },
  ] },
  workspaces: {
    items: [{ workspaceId: 'project', path: '/project', title: 'Project', sessionIds: ['member', 'archived-member'] }],
    archivedSessionIds: ['archived-member', 'removed-archive', 'missing-summary'],
    scratchCwd,
  },
};
const expected = { live: ['member', 'task'], archived: ['archived-member', 'missing-summary'] };
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find(existsSync);
const server = await startQaServer(0);
let browser;
try {
  browser = await chromium.launch({
    executablePath, headless: true,
    args: /msedge\.exe$/i.test(executablePath || '') ? ['--edge-skip-compat-layer-relaunch'] : [],
  });
  const bases = [`http://127.0.0.1:${server.address().port}/`, ...process.argv.slice(2)];
  for (const base of bases) {
    const page = await browser.newPage();
    // Load only the catalog modules, never the pairing app or a user's saved devices.
    await page.route('**/*', async route => {
      if (route.request().isNavigationRequest()) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Catalog QA</title>' });
      } else {
        await route.continue();
      }
    });
    await page.goto(base);
    const actual = await page.evaluate(async ({ input, moduleUrl }) => {
      const catalog = await import(moduleUrl);
      return {
        live: catalog.liveSessionRows(input).map(row => row.sessionId).sort(),
        archived: catalog.archivedSessionRows(input).map(row => row.sessionId).sort(),
      };
    }, { input: fixture, moduleUrl: new URL('host/catalog.js', base).href });
    console.log(JSON.stringify({ base, expected, actual }));
    assert.deepEqual(actual, expected, `Catalog listing differs at ${base}; deploy the current mobile/web assets`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
