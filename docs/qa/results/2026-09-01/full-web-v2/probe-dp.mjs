import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  launchSpa, pairInto, pairingUrl, sleep, openDrawer, spaSessions, desktop, desktopSessions, OUT, waitFor,
} from './lib.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();
try {
  await pairInto(page, url);
  const d = await desktopSessions(dPage);
  const p = await spaSessions(page);
  const P_parent = p.titles.map(norm);
  const P_child = p.childTitles.map(norm);
  const D_all = [...d.titles, ...d.childTitles].map(norm).filter((t) => t && t !== '新会话');
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cd = count(D_all); const cp = count(P_parent);
  const dOnly = []; const pOnly = [];
  for (const [k, v] of cd) { const g = cp.get(k) || 0; if (v > g) dOnly.push(`${k} x${v - g}`); }
  for (const [k, v] of cp) { const g = cd.get(k) || 0; if (v > g) pOnly.push(`${k} x${v - g}`); }
  const report = {
    counts: { D_all: D_all.length, P_parent: P_parent.length, P_child: P_child.length },
    dOnly, pOnly,
    dChildHeuristic: d.childTitles.length,
    pChildSample: P_child.slice(0, 10),
  };
  await writeFile(path.join(OUT, 'dp-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // quiet search probe
  await openDrawer(page);
  await page.evaluate(() => {
    const s = document.querySelector('#search');
    s.value = '验证码';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(3000);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].length);
  const text = await page.evaluate(() => (document.querySelector('#session-list')?.textContent || '').slice(0, 150));
  console.log('quiet search rows =', rows, 'text=', text.slice(0, 80));
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
