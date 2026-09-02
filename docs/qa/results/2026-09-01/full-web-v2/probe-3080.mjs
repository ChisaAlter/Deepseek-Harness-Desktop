import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
const dump = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
  buttons: [...document.querySelectorAll('button, [role="button"]')].map((el) => ({
    aria: el.getAttribute('aria-label') || '',
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  })),
}));
console.log(JSON.stringify(dump, null, 2));
await page.screenshot({ path: 'docs/qa/results/2026-09-01/full-web-v2/desktop-3080-now.png' });
browser.disconnect();
