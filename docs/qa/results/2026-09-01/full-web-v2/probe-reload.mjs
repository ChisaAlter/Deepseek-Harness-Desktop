import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e) => console.log('reload', e.message));
await new Promise((r) => setTimeout(r, 6000));
const dump = await page.evaluate(() => ({
  composer: Boolean(document.querySelector('[data-composer-card]')),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  buttonCount: document.querySelectorAll('button').length,
  html: document.body.innerHTML.length,
}));
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
