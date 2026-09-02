import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(localStorage)) {
      if (/draft/i.test(k)) out[k] = localStorage.getItem(k);
    }
    return { sid: document.querySelector('#phone')?.dataset.sessionId || '', draft: document.querySelector('#draft')?.value || '', store: out };
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
  const p = await spaSessions(page);
  const [A, B] = p.rows.filter((r) => !r.child).slice(0, 2);
  await openSid(A.id);
  await snap('after open A');
  await page.click('#draft');
  await page.type('#draft', 'PROBE-DRAFT-A');
  await sleep(500);
  await snap('after type in A');
  await openSid(B.id);
  await snap('after open B');
  await openSid(A.id);
  await snap('after back to A');
} finally {
  await browser.close().catch(() => {});
}
