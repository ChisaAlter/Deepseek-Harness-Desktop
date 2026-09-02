/**
 * DEF-MOVE-NOOP probe: pick a workspace with ≥3 live rows, call
 * workspace.insertSessionBefore via the SPA debug hook, compare workspace.list
 * sessionIds before/after and the drawer order.
 */
import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  const info = await page.evaluate(() => {
    const ws = window.__dshdDebug.workspaces();
    const sessions = window.__dshdDebug.sessions();
    const live = new Set(sessions.map((s) => s.sessionId));
    const groups = (ws?.items || []).map((w) => ({
      workspaceId: w.workspaceId,
      title: w.title || w.path,
      ids: (w.sessionIds || []).filter((id) => live.has(id)),
      rawCount: (w.sessionIds || []).length,
    }));
    return groups;
  });
  console.log('groups:', JSON.stringify(info.map((g) => ({ t: g.title, live: g.ids.length, raw: g.rawCount }))));
  const target = info.find((g) => g.ids.length >= 3 && /dshd-qa/.test(g.title)) || info.find((g) => g.ids.length >= 3);
  if (!target) { console.log('no group with >=3 live rows'); process.exit(0); }
  const [a, b, c] = target.ids;
  const drawerBefore = await page.evaluate((wid) => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
    .map((r) => r.dataset.sessionId), target.workspaceId);
  console.log('before ids:', target.ids.slice(0, 4).map((x) => x.slice(0, 12)));
  // move c before a
  const res = await page.evaluate((payload) => window.__dshdDebug.hostCall('workspace.insertSessionBefore', payload)
    .then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, err: String(e.message || e) })), { workspaceId: target.workspaceId, sessionId: c, beforeSessionId: a });
  console.log('rpc:', JSON.stringify(res).slice(0, 300));
  await sleep(1500);
  const after = await page.evaluate((payload) => window.__dshdDebug.hostCall('workspace.list', {}).then((v) => v).catch((e) => ({ err: String(e) })), {});
  const afterWs = (after?.items || after?.value?.items || []).find((w) => w.workspaceId === target.workspaceId);
  console.log('after workspace.list ids:', (afterWs?.sessionIds || []).slice(0, 5).map((x) => x.slice(0, 12)));
  const stateWs = await page.evaluate((wid) => (window.__dshdDebug.workspaces()?.items || []).find((w) => w.workspaceId === wid)?.sessionIds || [], target.workspaceId);
  console.log('state.workspaces ids:', stateWs.slice(0, 5).map((x) => x.slice(0, 12)));
  await sleep(2500);
  await dismissOverlays(page);
  await openDrawer(page);
  const drawerAfter = await page.evaluate(() => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
    .map((r) => r.dataset.sessionId));
  console.log('drawer changed:', JSON.stringify(drawerBefore) !== JSON.stringify(drawerAfter));
  // restore: move c back after b (before whatever followed c) — put c before the id that was after it
  const restoreBefore = target.ids[3];
  await page.evaluate((payload) => window.__dshdDebug.hostCall('workspace.insertSessionBefore', payload).catch(() => null),
    restoreBefore ? { workspaceId: target.workspaceId, sessionId: c, beforeSessionId: restoreBefore } : { workspaceId: target.workspaceId, sessionId: c });
} finally {
  await browser.close().catch(() => {});
}
