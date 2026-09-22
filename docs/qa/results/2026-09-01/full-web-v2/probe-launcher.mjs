import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('launcher.html'));
if (!page) { console.log('no launcher page'); process.exit(0); }
const dump = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s{2,}/g, ' | ').slice(0, 800),
  buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => ({
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    aria: b.getAttribute('aria-label') || '',
    disabled: b.disabled,
  })).slice(0, 20),
}));
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
