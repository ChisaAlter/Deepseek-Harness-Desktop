import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, switchGrok } from './lib.mjs';

const WS = 'dshd-qa-ws-2026-08-30';
const PROMPT = process.argv[2] || '\u8bf7\u53ea\u56de\u590d\uff1aDRAFTPROBE';
const NEW_SESSION_TITLE = '\u65b0\u4f1a\u8bdd';
const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(2500);
  await dismissOverlays(page);
  await openDrawer(page);
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await sleep(1500);
    const title = await page.evaluate(() => document.querySelector('#sheet-root .sheet-title')?.textContent || '');
    if (title.includes(NEW_SESSION_TITLE)) break;
    console.log(`chooser retry ${i + 1}: sheet=${JSON.stringify(title)}`);
    await dismissOverlays(page);
    await openDrawer(page);
  }
  await page.evaluate((want) => {
    [...document.querySelectorAll('#sheet-root .sheet-item')].find((n) => (n.textContent || '').includes(want))?.click();
  }, WS);
  let sid = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !sid) { sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || ''); if (!sid) await sleep(800); }
  await switchGrok(page);
  const before = await page.evaluate(() => (window.__dshdMux || []).length);
  await page.click('#draft');
  await page.evaluate(() => { const d = document.querySelector('#draft'); if (d) d.value = ''; });
  await page.type('#draft', PROMPT);
  await page.click('#send-btn');
  for (let i = 0; i < 12; i += 1) {
    await sleep(4000);
    const s = await page.evaluate((n, id) => ({
      stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
      run: !document.querySelector('#run-flag')?.classList.contains('hidden'),
      users: document.querySelectorAll('#log .user').length,
      assistants: [...document.querySelectorAll('#log .assistant')].map((x) => x.textContent.slice(0, 20)),
      frames: (window.__dshdMux || []).slice(n).filter((f) => f.sessionId === id).map((f) => `${f.type}${f.key ? ':' + f.key : ''}`),
      logTail: (document.querySelector('#log')?.textContent || '').slice(-80),
    }), before, sid);
    const counts = {};
    for (const f of s.frames) counts[f] = (counts[f] || 0) + 1;
    console.log(`t+${(i + 1) * 4}s stop=${s.stop} run=${s.run} users=${s.users} asst=${JSON.stringify(s.assistants)} tail=${JSON.stringify(s.logTail)} frames=${JSON.stringify(counts)}`);
    if (!s.stop && s.assistants.length > 0) break;
  }
} finally {
  await browser.close().catch(() => {});
}
