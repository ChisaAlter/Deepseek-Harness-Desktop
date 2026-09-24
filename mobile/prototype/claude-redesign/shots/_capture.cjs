const puppeteer = require('C:/Ai/Deepseek-Harness-Desktop/node_modules/puppeteer-core');
const path = require('path');

const BASE = 'http://127.0.0.1:5178/index.html';
const OUT = __dirname;
const cases = [
  ['B-light', '?variant=B&theme=light'],
  ['B-dark', '?variant=B&theme=dark'],
  ['B-light-ref', '?variant=B&theme=light&ref=1'],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  const allErrors = {};
  for (const [name, qs] of cases) {
    const page = await browser.newPage();
    await page.setViewport({ width: 2760, height: 1120, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + qs, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    allErrors[name] = errors;
    await page.close();
    console.log(name, 'done,', errors.length, 'console errors');
  }
  console.log(JSON.stringify(allErrors, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
