import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions, switchGrok } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await dismissOverlays(page);
  await openDrawer(page);
  const p = await spaSessions(page);
  const target = p.rows.find((r) => !r.child && /DRAFTPROBE|请只回复：DRAFT/.test(r.title)) || p.rows.find((r) => !r.child);
  await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((n) => n.dataset.sessionId === want);
    row?.querySelector('.session')?.click();
  }, target.id);
  await sleep(3000);
  const view = await page.evaluate(() => ({
    title: document.querySelector('#chat-title')?.textContent,
    users: document.querySelectorAll('#log .user').length,
    assistants: [...document.querySelectorAll('#log .assistant')].map((n) => n.textContent.slice(0, 40)),
    stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
    run: !document.querySelector('#run-flag')?.classList.contains('hidden'),
    banner: document.querySelector('#banner')?.textContent,
    log: (document.querySelector('#log')?.textContent || '').slice(-200),
  }));
  console.log(JSON.stringify(view, null, 2));
  await switchGrok(page);
  const before = await page.evaluate(() => (window.__dshdMux || []).length);
  await page.click('#draft');
  await page.type('#draft', '请只回复：PING2');
  await page.click('#send-btn');
  for (let i = 0; i < 12; i += 1) {
    await sleep(5000);
    const s = await page.evaluate((n) => ({
      stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
      assistants: document.querySelectorAll('#log .assistant').length,
      last: ([...document.querySelectorAll('#log .assistant')].pop()?.textContent || '').slice(0, 30),
      frames: (window.__dshdMux || []).slice(n).map((f) => `${f.type}${f.event ? ':' + f.event : ''}${f.key ? ':' + f.key : ''}`),
      banner: document.querySelector('#banner')?.textContent,
    }), before);
    const counts = {};
    for (const f of s.frames) counts[f] = (counts[f] || 0) + 1;
    console.log(`t+${(i + 1) * 5}s stop=${s.stop} assistants=${s.assistants} last=${JSON.stringify(s.last)} banner=${JSON.stringify(s.banner)} frames=${JSON.stringify(counts)}`);
    if (!s.stop && s.assistants > 0 && s.last) break;
  }
} finally {
  await browser.close().catch(() => {});
}
