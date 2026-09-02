import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 300)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text().slice(0, 300)}`); });
try {
  await pairInto(page, url);
  await sleep(2000);
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await sleep(2500);
  const view = await page.evaluate(() => ({
    sheet: document.querySelector('#sheet-root .sheet-title')?.textContent || '',
    sheetHtml: (document.querySelector('#sheet-root')?.innerText || '').slice(0, 200),
    banner: document.querySelector('#banner')?.textContent || '',
    appSrc: document.querySelector('script[type="module"]')?.src || '',
  }));
  console.log(JSON.stringify(view, null, 2));
  console.log(errors.join('\n') || 'no page errors');
} finally {
  await browser.close().catch(() => {});
}
