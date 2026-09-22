import { launchSpa, pairInto, pairingUrl, spaSessions, openDrawer, sleep } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await openDrawer(page);
  const dump = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')];
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const title = (r.querySelector('.session b')?.textContent || '').trim();
      if (/你们好啊|ChisaTerminal 渲染层架构评审/.test(title)) {
        // Walk backwards to nearest parent (non-child) row.
        let parent = '';
        for (let j = i - 1; j >= 0; j -= 1) {
          if (!rows[j].classList.contains('session-child')) {
            parent = (rows[j].querySelector('.session b')?.textContent || '').trim();
            break;
          }
        }
        out.push({
          title,
          child: r.classList.contains('session-child'),
          id: (r.dataset.sessionId || '').slice(0, 24),
          parentAbove: parent,
        });
      }
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 2));
} finally {
  await browser.close().catch(() => {});
}
