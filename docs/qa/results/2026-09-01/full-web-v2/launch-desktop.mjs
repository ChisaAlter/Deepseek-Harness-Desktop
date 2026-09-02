import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const launcher = (await browser.pages()).find((p) => p.url().includes('launcher.html'));
if (launcher) {
  const clicked = await launcher.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('启动桌面端'));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  console.log('clicked 启动桌面端:', clicked);
} else {
  console.log('no launcher page (maybe already started)');
}
browser.disconnect();
