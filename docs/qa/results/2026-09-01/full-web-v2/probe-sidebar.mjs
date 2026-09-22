import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
const dump = await page.evaluate(() => {
  // Expand all "展开其余 N 个会话" first.
  for (const btn of [...document.querySelectorAll('button')]) {
    if (/展开其余 \d+ 个会话/.test(btn.textContent || '')) btn.click();
  }
  return new Promise((resolve) => setTimeout(() => {
    const newBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
    let nav = newBtn;
    for (let i = 0; i < 8 && nav; i += 1) {
      nav = nav.parentElement;
      if (nav && nav.querySelectorAll('a, button').length > 20) break;
    }
    const rows = nav ? [...nav.querySelectorAll('a, button')].filter((el) => {
      const t = (el.textContent || '').trim();
      return t && !/新会话|展开其余|已归档/.test(t);
    }).slice(0, 80).map((el) => ({
      tag: el.tagName,
      href: (el.getAttribute('href') || '').slice(0, 60),
      aria: (el.getAttribute('aria-label') || '').slice(0, 60),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44),
      cls: String(el.className).slice(0, 60),
    })) : [];
    resolve({
      navFound: Boolean(nav),
      navTag: nav ? `${nav.tagName}.${String(nav.className).slice(0, 60)}` : '',
      rowCount: rows.length,
      rows: rows.slice(0, 50),
      archivedBtn: [...document.querySelectorAll('button, a')].some((el) => /已归档/.test(el.textContent || '')),
    });
  }, 800));
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
