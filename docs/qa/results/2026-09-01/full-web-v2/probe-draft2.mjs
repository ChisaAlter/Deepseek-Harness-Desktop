import {
  launchSpa, pairInto, pairingUrl, sleep, waitFor, openDrawer, dismissOverlays, spaSessions, sendAndIdle, switchGrok,
} from './lib.mjs';

const WS = 'dshd-qa-ws-2026-08-30';
const url = await pairingUrl();
const { browser, page } = await launchSpa();
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(localStorage)) if (/draft/i.test(k)) out[k] = localStorage.getItem(k);
    return {
      sid: (document.querySelector('#phone')?.dataset.sessionId || '').slice(0, 20),
      draft: document.querySelector('#draft')?.value || '',
      dataset: document.querySelector('#draft')?.dataset.draftSession || '',
      store: out,
    };
  });
  console.log(label, JSON.stringify(s));
};
async function openSid(id) {
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((n) => n.dataset.sessionId === want);
    row?.querySelector('.session')?.click();
  }, id);
  await sleep(1800);
}
try {
  await pairInto(page, url);
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
  await page.evaluate((want) => {
    [...document.querySelectorAll('#sheet-root .sheet-item')].find((n) => (n.textContent || '').includes(want))?.click();
  }, WS);
  let sid = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !sid) { sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || ''); if (!sid) await sleep(800); }
  await snap('new session');
  await switchGrok(page);
  await sendAndIdle(page, '请只回复：DRAFTPROBE', 180_000);
  await snap('after send');
  await page.click('#draft');
  await page.type('#draft', 'PROBE-DRAFT-2');
  await sleep(500);
  await snap('after type');
  const other = (await spaSessions(page)).rows.find((r) => !r.child && r.id !== sid);
  await openSid(other.id);
  await snap('after open B');
  await openSid(sid);
  await snap('after back to A');
} finally {
  await browser.close().catch(() => {});
}
