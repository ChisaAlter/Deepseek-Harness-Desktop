import {
  launchSpa, pairInto, pairingUrl, sleep, desktop, desktopType, desktopSend, desktopEnsureGrok,
} from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(1500);
  // open first live row so startLiveFollow() subscribes mux
  await page.evaluate(() => document.querySelector('#menu')?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('#session-list .session-row:not(.workspace-head) .session')?.click());
  await sleep(4000);
  console.log('subscribed?', await page.evaluate(() => Boolean(window.__dshdMux)), 'frames so far', await page.evaluate(() => (window.__dshdMux || []).length));
  const before = await page.evaluate(() => (window.__dshdMux || []).length);
  await dPage.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
    btn?.click();
  });
  await sleep(1500);
  await desktopEnsureGrok(dPage);
  await desktopType(dPage, '请只回复一行：MUXPROBE');
  await desktopSend(dPage);
  await sleep(25_000);
  const frames = await page.evaluate((n) => (window.__dshdMux || []).slice(n), before);
  const counts = {};
  for (const f of frames) {
    const k = `${f.type}${f.event ? ':' + f.event : ''}${f.key ? ':' + f.key : ''}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(JSON.stringify({ total: frames.length, counts, sample: frames.slice(0, 12) }, null, 2));
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
