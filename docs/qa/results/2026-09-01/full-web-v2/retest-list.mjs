/**
 * Retest LIST-001/002/003/010 + SRCH-001/003/005 after driver fixes.
 */
import {
  launchSpa, pairInto, pairingUrl, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, spaSessions,
  desktop, desktopSessions, desktopShot,
} from './lib.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function multisetDiff(D, P) {
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cd = count(D); const cp = count(P);
  const missing = []; const extra = [];
  for (const [k, v] of cd) { const got = cp.get(k) || 0; for (let i = got; i < v; i += 1) missing.push(k); }
  for (const [k, v] of cp) { const got = cd.get(k) || 0; for (let i = got; i < v; i += 1) extra.push(k); }
  return { missing, extra };
}

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

try {
  await pairInto(page, url);

  await runCase('LIST-001', async () => {
    const d = await desktopSessions(dPage);
    const p = await spaSessions(page);
    const D = [...d.titles, ...d.childTitles].map(norm).filter((t) => t && t !== '新会话');
    const P = [...p.titles, ...p.childTitles].map(norm);
    const { missing, extra } = multisetDiff(D, P);
    const e1 = await shot(page, 'list-001-phone');
    const e2 = await desktopShot(dPage, 'list-001-desktop');
    if (missing.length || extra.length) {
      throw new Error(`|D|=${D.length} |P|=${P.length} 缺:${missing.slice(0, 6).join('、')} 多:${extra.slice(0, 6).join('、')}`);
    }
    return { status: 'Pass', note: `D=P 全等（${D.length} 行，父+子合并多重集；桌面 blank「新会话」除外）`, evidence: [e1, e2] };
  });

  await runCase('LIST-002', async () => {
    const p = await spaSessions(page);
    const target = p.rows.find((r) => !r.child && r.title && r.title !== '新会话');
    if (!target) throw new Error('无可开的父行');
    await openDrawer(page);
    await page.evaluate((id) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .find((n) => n.dataset.sessionId === id);
      row?.querySelector('.session')?.click();
    }, target.id);
    await waitFor(page, () => (document.querySelector('#log')?.textContent || '').length > 4
      || !document.querySelector('#blank')?.classList.contains('hidden'), 'opened', 25_000);
    const view = await page.evaluate(() => ({
      title: (document.querySelector('#chat-title')?.textContent || '').trim(),
      sid: document.querySelector('#phone')?.dataset.sessionId || '',
    }));
    const e1 = await shot(page, 'list-002-phone');
    if (view.title !== target.title) throw new Error(`标题「${view.title}」≠「${target.title}」`);
    if (view.sid && target.id && view.sid !== target.id) throw new Error(`sid ${view.sid} ≠ ${target.id}`);
    return { status: 'Pass', note: `打开行=会话（${target.title} / ${target.id.slice(0, 16)}…）`, evidence: [e1] };
  });

  await runCase('LIST-003', async () => {
    const beforeP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
    await closeDrawer(page);
    const started = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!started) return { status: 'Blocked', note: '桌面「新建会话」按钮未找到' };
    await sleep(2000);
    const typed = await dPage.evaluate(() => {
      const el = document.querySelector('[data-composer-input]');
      if (!el) return 'no-input';
      el.click();
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, '请只回复一行：LIST-003 反向标记');
      const text = (el.innerText || '').trim();
      if (!text) return 'type-failed';
      const card = document.querySelector('[data-composer-card]');
      const send = card && [...card.querySelectorAll('button')]
        .find((b) => /发送消息|send message/i.test((b.getAttribute('aria-label') || '') + b.textContent));
      if (!send || send.disabled) return 'send-missing';
      send.click();
      return 'sent';
    });
    if (typed !== 'sent') return { status: 'Blocked', note: `桌面输入驱动=${typed}` };
    const deadline = Date.now() + 60_000;
    let afterP = beforeP;
    while (Date.now() < deadline) {
      await sleep(3000);
      afterP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
      if (afterP > beforeP) break;
    }
    const e1 = await shot(page, 'list-003-phone');
    const e2 = await desktopShot(dPage, 'list-003-desktop');
    if (afterP <= beforeP) throw new Error(`60s 手机未新增（${beforeP}→${afterP}）`);
    return { status: 'Pass', note: `桌面新会话+一句 → 手机列表 ${beforeP}→${afterP}`, evidence: [e1, e2] };
  });

  await runCase('LIST-010', async () => {
    // Open a writable session first (the LIST-003 one likely open on phone? open by newest).
    const p = await spaSessions(page);
    const target = p.rows.find((r) => !r.child && /LIST-003|反向标记/.test(r.title))
      || p.rows.find((r) => !r.child && !/子智能体/.test(r.title));
    await openDrawer(page);
    await page.evaluate((id) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .find((n) => n.dataset.sessionId === id);
      row?.querySelector('.session')?.click();
    }, target.id);
    await sleep(2000);
    const readonly = await page.evaluate(() => {
      const note = document.querySelector('#readonly-note');
      return note && !note.classList.contains('hidden');
    });
    if (readonly) return { status: 'Blocked', note: `目标行只读（${target.title}）` };
    await page.click('#draft');
    await page.type('#draft', '请用一句话回答：什么是回归测试？');
    await page.click('#send-btn');
    await sleep(1500);
    const phoneRun = await page.evaluate(() => !document.querySelector('#run-flag')?.classList.contains('hidden')
      || !document.querySelector('#stop-btn')?.classList.contains('hidden'));
    const e1 = await shot(page, 'list-010-phone-running');
    const deskRun = await dPage.evaluate(() => /停止生成|stop generating/i.test(document.body.innerText || ''));
    const e2 = await desktopShot(dPage, 'list-010-desktop-running');
    await waitFor(page, () => document.querySelector('#stop-btn')?.classList.contains('hidden'), 'idle', 180_000);
    if (!phoneRun) throw new Error('手机无运行标识');
    return {
      status: 'Pass',
      note: `手机运行标识可见${deskRun ? '；桌面同时显示停止生成（同会话 running）' : '；桌面采样窗未捕获（1.5s 流式边界）'}`,
      evidence: [e1, e2],
    };
  });

  // ---- SRCH（排除 workspace-head 计数）----
  const searchRows = () => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
    .map((r) => ({
      title: (r.querySelector('.session b')?.textContent || '').trim(),
      full: (r.textContent || '').trim(),
      id: r.dataset.sessionId || '',
    }));

  await runCase('SRCH-001', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => {
      const s = document.querySelector('#search');
      s.value = '验证码';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(page, () => {
      const body = document.querySelector('#session-list')?.textContent || '';
      return !body.includes('正在搜索') && body.length > 0;
    }, 'search settle', 20_000);
    const view = await page.evaluate(searchRows);
    const snippet = view.some((r) => r.full.length > r.title.length + 6);
    const file = await shot(page, 'srch-001');
    if (!view.length) throw new Error('无命中');
    if (view.length > 20) throw new Error(`session 行 ${view.length} > 20（排除头后）`);
    return { status: 'Pass', note: `命中 ${view.length} 行（≤20）${snippet ? '，带 snippet' : ''}`, evidence: [file] };
  });

  await runCase('SRCH-003', async () => {
    const rows = await page.evaluate(searchRows);
    const more = await page.evaluate(() => /更多|还有/.test(document.querySelector('#session-list')?.textContent || ''));
    if (rows.length < 20) return { status: 'NA-pre', note: `命中 ${rows.length} < 20 无法压 cap` };
    if (rows.length > 20) throw new Error(`${rows.length} > 20`);
    return { status: 'Pass', note: `cap=20 生效${more ? '，有更多提示' : ''}` };
  });

  await runCase('SRCH-005', async () => {
    const target = await page.evaluate(() => {
      const row = document.querySelector('#session-list .session-row:not(.workspace-head)');
      const t = (row?.querySelector('.session b')?.textContent || '').trim();
      const id = row?.dataset.sessionId || '';
      row?.querySelector('.session')?.click();
      return { t, id };
    });
    await sleep(1800);
    const view = await page.evaluate(() => ({
      title: (document.querySelector('#chat-title')?.textContent || '').trim(),
      sid: document.querySelector('#phone')?.dataset.sessionId || '',
    }));
    if (!target.t) throw new Error('无命中行');
    if (view.sid && target.id && view.sid !== target.id) throw new Error(`sid 不符`);
    if (!view.sid && view.title !== target.t) throw new Error(`标题「${view.title}」≠「${target.t}」`);
    return { status: 'Pass', note: `命中行打开正确（${target.t}）` };
  });
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
console.log('[retest-list] done');
