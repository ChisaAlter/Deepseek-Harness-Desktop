import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
const dump = await page.evaluate(() => {
  const classes = new Set();
  for (const el of document.querySelectorAll('[class]')) {
    for (const c of String(el.className).split(/\s+/)) {
      if (/session|workspace|sidebar|folder|archive/i.test(c)) classes.add(c);
    }
  }
  // Find an element containing a known session title like 'pong'
  const holders = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0
    && (el.textContent || '').trim() === 'pong').slice(0, 3).map((el) => {
    const chain = [];
    let cur = el;
    for (let i = 0; i < 6 && cur; i += 1) {
      chain.push(`${cur.tagName}.${String(cur.className).split(/\s+/).slice(0, 2).join('.')}`);
      cur = cur.parentElement;
    }
    return chain;
  });
  return { classes: [...classes].sort().slice(0, 60), holders };
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
