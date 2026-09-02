import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
const logs = [];
page.on('console', (m) => logs.push(`${m.type()} ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR ${String(e).slice(0, 400)}`));
page.on('requestfailed', (r) => logs.push(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e) => logs.push(`reload ${e.message}`));
await new Promise((r) => setTimeout(r, 9000));
const state = await page.evaluate(() => ({
  html: document.body.innerHTML.slice(0, 1200),
  scripts: [...document.querySelectorAll('script')].map((s) => s.src || 'inline').slice(0, 10),
}));
console.log(JSON.stringify({ logs: logs.slice(0, 40), state }, null, 2));
browser.disconnect();
