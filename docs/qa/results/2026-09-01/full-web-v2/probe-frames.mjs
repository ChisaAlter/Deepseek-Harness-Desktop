import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
for (const page of await browser.pages()) {
  console.log('PAGE', page.url());
  for (const frame of page.frames()) {
    let info = {};
    try {
      info = await frame.evaluate(() => ({
        composer: Boolean(document.querySelector('[data-composer-card]')),
        buttons: document.querySelectorAll('button').length,
        title: document.title,
        marks: [...document.querySelectorAll('[data-composer-card], [data-chat-flow]')].length,
      }));
    } catch (e) { info = { err: String(e).slice(0, 80) }; }
    console.log('  FRAME', frame.url().slice(0, 90), JSON.stringify(info));
  }
}
browser.disconnect();
