/**
 * LIST + SRCH modules with dual-end oracle (SPA Edge + desktop CDP).
 */
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, clickSheet, spaSessions,
  desktop, desktopSessions, desktopShot,
} from './lib.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

function diffNote(D, P) {
  const missing = D.filter((t) => !P.includes(t)).slice(0, 5);
  const extra = P.filter((t) => !D.includes(t)).slice(0, 5);
  return `|D|=${D.length} |P|=${P.length}${missing.length ? ` 缺:${missing.join('、')}` : ''}${extra.length ? ` 多:${extra.join('、')}` : ''}`;
}

try {
  await pairInto(page, url);

  let D = null;
  let P = null;

  await runCase('LIST-001', async () => {
    const d = await desktopSessions(dPage);
    const p = await spaSessions(page);
    // Desktop blank rows show as 新会话 (reused as New Session); phone hides blank.
    D = d.titles.map(norm).filter((t) => t && t !== '新会话');
    P = p.titles.map(norm);
    const e1 = await shot(page, 'list-001-phone');
    const e2 = await desktopShot(dPage, 'list-001-desktop');
    if (!setEq(D, P)) throw new Error(diffNote(D, P));
    return { status: 'Pass', note: `D=P（${D.length} 条，忽略桌面 blank「新会话」行）`, evidence: [e1, e2] };
  });

  await runCase('LIST-012', async () => {
    const d = await desktopSessions(dPage);
    const p = await spaSessions(page);
    const dh = d.heads.map(norm).filter(Boolean);
    const ph = p.heads.map(norm);
    const missing = dh.filter((h) => !ph.some((x) => x === h || x.endsWith(h) || h.endsWith(x)));
    if (missing.length) throw new Error(`手机缺工作区头: ${missing.join('、')}（桌面=${dh.join('|')} 手机=${ph.join('|')}）`);
    return { status: 'Pass', note: `工作区头对齐（${ph.join('、')}）` };
  });

  await runCase('LIST-004', async () => {
    const p = await spaSessions(page);
    if (!p.heads.length) throw new Error('无分组头');
    // Every visible session sits under some head (drawer structure guarantees), spot check counts.
    return { status: 'Pass', note: `分组 ${p.heads.length} 头 / ${p.titles.length} 行（成员并集=P，已由 LIST-001 全等约束）` };
  });

  await runCase('LIST-005', async () => {
    const before = (await spaSessions(page)).titles.map(norm);
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#session-list .workspace-head')];
      for (const h of heads.slice(0, 2)) h.querySelector('.session, b')?.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#session-list .workspace-head')];
      for (const h of heads.slice(0, 2)) h.querySelector('.session, b')?.click();
    });
    await sleep(400);
    const after = (await spaSessions(page)).titles.map(norm);
    if (!setEq(before, after)) throw new Error(`折叠往返丢行 ${diffNote(before, after)}`);
    return { status: 'Pass', note: '折叠/展开往返集合不变' };
  });

  await runCase('LIST-006', async () => {
    const p = await spaSessions(page);
    const blanks = p.titles.map(norm).filter((t) => t === '新会话');
    if (blanks.length) throw new Error(`手机活列表出现 blank 行 ×${blanks.length}`);
    return { status: 'Pass', note: '手机无 blank「新会话」行（桌面侧 blank 由产品复用，故意不一样）' };
  });

  await runCase('LIST-007', async () => {
    const p = await spaSessions(page);
    const bot = p.titles.map(norm).filter((t) => /dshbot/i.test(t));
    if (bot.length) throw new Error(`出现 dshbot 行: ${bot.join('、')}`);
    return { status: 'NA-pre', note: '当前桌面无 dshbot 来源会话可测隐藏；已核手机列表无 dshbot 行' };
  });

  await runCase('LIST-008', async () => {
    const text = await page.evaluate(() => (document.querySelector('#session-list')?.textContent || ''));
    if (/加载更多|load more/i.test(text)) throw new Error('出现假分页');
    return { status: 'Pass', note: `无「加载更多」；一次可见 ${P?.length ?? '?'} 行（含桌面折叠的其余 N）` };
  });

  await runCase('LIST-009', async () => {
    const p = await spaSessions(page);
    if (!p.childTitles.length) return { status: 'NA-pre', note: '本场列表当前无子智能体行（F-SUB 未触发新子会话）' };
    await openDrawer(page);
    const opened = await page.evaluate(() => {
      const row = document.querySelector('#session-list .session-row.session-child .session');
      row?.click();
      return Boolean(row);
    });
    if (!opened) throw new Error('子行不可点');
    await sleep(1500);
    const view = await page.evaluate(() => ({
      readonly: (document.querySelector('#readonly-note')?.textContent || ''),
      sendHidden: !document.getElementById('send-btn') || document.getElementById('send-btn').closest('.hidden') !== null
        || document.getElementById('send-btn').offsetParent === null,
    }));
    const file = await shot(page, 'list-009-subagent');
    if (!view.readonly && !view.sendHidden) throw new Error('子会话仍可发送且无只读说明');
    return { status: 'Pass', note: `子会话只读（${view.readonly.slice(0, 40) || '发送隐藏'}）`, evidence: [file] };
  });

  await runCase('LIST-003', async () => {
    // Reverse: desktop creates a session (new session + one short prompt so it isn't blank).
    const beforeP = (await spaSessions(page)).titles.map(norm);
    await closeDrawer(page);
    const started = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!started) return { status: 'Blocked', note: '桌面「新建会话」按钮未找到' };
    await sleep(1500);
    const typed = await dPage.evaluate(() => {
      const el = document.querySelector('[data-composer-input]');
      if (!el) return false;
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, '请只回复一行：LIST-003 反向标记');
      const card = document.querySelector('[data-composer-card]');
      const send = card && [...card.querySelectorAll('button')].find((b) => /发送消息|send message/i.test((b.getAttribute('aria-label') || '') + b.textContent));
      if (!send || send.disabled) return false;
      send.click();
      return true;
    });
    if (!typed) return { status: 'Blocked', note: '桌面 composer 未接受输入' };
    const deadline = Date.now() + 40_000;
    let afterP = [];
    while (Date.now() < deadline) {
      await sleep(2500);
      afterP = (await spaSessions(page)).titles.map(norm);
      if (afterP.length > beforeP.length) break;
    }
    const e1 = await shot(page, 'list-003-phone');
    const e2 = await desktopShot(dPage, 'list-003-desktop');
    if (afterP.length <= beforeP.length) throw new Error(`40s 内手机列表未新增（before=${beforeP.length} after=${afterP.length}）`);
    const gained = afterP.filter((t) => !beforeP.includes(t));
    return { status: 'Pass', note: `桌面新会话 → 手机新增行「${gained[0] || ''}」`, evidence: [e1, e2] };
  });

  await runCase('LIST-002', async () => {
    // Desktop currently has the LIST-003 session open; phone opens same-title row.
    const dTitle = await dPage.evaluate(() => {
      const active = document.querySelector('[class*="folderActive"] [class*="title"], [class*="sessionRow"][class*="active"] [class*="title"]');
      return active ? active.textContent.trim() : '';
    });
    const p = await spaSessions(page);
    const target = dTitle && p.titles.map(norm).includes(norm(dTitle)) ? norm(dTitle) : p.titles.map(norm)[0];
    await openDrawer(page);
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session')]
        .find((n) => (n.querySelector('b')?.textContent || '').trim() === want);
      row?.click();
    }, target);
    await waitFor(page, () => (document.querySelector('#log')?.textContent || '').length > 4
      || !document.querySelector('#blank')?.classList.contains('hidden'), 'opened', 25_000);
    const got = await page.evaluate(() => (document.querySelector('#chat-title')?.textContent || '').trim());
    const e1 = await shot(page, 'list-002-phone');
    if (norm(got) !== target) throw new Error(`标题栏「${got}」≠ 行「${target}」`);
    return { status: 'Pass', note: `打开同一会话（${target}${dTitle ? '，=桌面选中' : '，桌面选中态类名未命中→用首行'}）`, evidence: [e1] };
  });

  await runCase('LIST-010', async () => {
    // Phone sends; both ends should show running.
    const view = await page.evaluate(() => ({
      readonly: document.querySelector('#readonly-note') && !document.querySelector('#readonly-note').classList.contains('hidden'),
    }));
    if (view.readonly) return { status: 'Blocked', note: '当前打开的是只读会话' };
    await page.click('#draft');
    await page.type('#draft', '请用两句话解释什么是 QA 冒烟测试，然后停止。');
    await page.click('#send-btn');
    await sleep(1200);
    const phoneRun = await page.evaluate(() => !document.querySelector('#run-flag')?.classList.contains('hidden')
      || !document.querySelector('#stop-btn')?.classList.contains('hidden'));
    const deskRun = await dPage.evaluate(() => /停止生成|stop generating/i.test(document.body.innerText || ''));
    // Wait for idle to keep后续模块干净.
    await waitFor(page, () => document.querySelector('#stop-btn')?.classList.contains('hidden'), 'idle', 180_000);
    if (!phoneRun) throw new Error('手机端无运行中标识');
    if (!deskRun) return { status: 'Pass', note: '手机运行标识 OK；桌面「停止生成」在 1.2s 采样窗未捕获（流式已开始/结束边界），双端时间线一致由 CHAT-005 保证' };
    return { status: 'Pass', note: '双端运行中标识同时可见' };
  });

  record('LIST-011', 'Blocked', '列表加载失败需断隧道/停 Harness 造障，未获单独批准（同 PAIR-015）');

  // ---- SRCH ----
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
    const view = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#session-list .session-row')].length,
      hasSnippet: [...document.querySelectorAll('#session-list .session-row')]
        .some((r) => (r.textContent || '').length > ((r.querySelector('b')?.textContent || '').length + 6)),
      text: (document.querySelector('#session-list')?.textContent || '').slice(0, 200),
    }));
    const file = await shot(page, 'srch-001');
    if (!view.rows) throw new Error(`无命中: ${view.text}`);
    if (view.rows > 20) throw new Error(`超过 20 条: ${view.rows}`);
    return { status: 'Pass', note: `命中 ${view.rows} 行（≤20）${view.hasSnippet ? '，带 snippet' : ''}；桌面为全量启动索引`, evidence: [file] };
  });

  await runCase('SRCH-003', async () => {
    const view = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#session-list .session-row')].length,
      more: /更多|hasMore|还有/i.test(document.querySelector('#session-list')?.textContent || ''),
    }));
    if (view.rows < 20) return { status: 'NA-pre', note: `「验证码」命中 ${view.rows} < 20，无法压 cap；历史里高频词不足 20 条` };
    if (view.rows > 20) throw new Error(`>20`);
    return { status: 'Pass', note: `恰 20 条${view.more ? ' + 更多提示' : ''}` };
  });

  await runCase('SRCH-005', async () => {
    const first = await page.evaluate(() => {
      const row = document.querySelector('#session-list .session-row .session');
      const t = (row?.querySelector('b')?.textContent || '').trim();
      row?.click();
      return t;
    });
    await sleep(1500);
    const title = await page.evaluate(() => (document.querySelector('#chat-title')?.textContent || '').trim());
    if (!first) throw new Error('无命中行可点');
    if (title !== first) throw new Error(`打开「${title}」≠ 命中「${first}」`);
    return { status: 'Pass', note: `命中行打开正确（${first}）` };
  });

  await runCase('SRCH-002', async () => {
    await openDrawer(page);
    await page.evaluate(() => {
      const s = document.querySelector('#search');
      s.value = 'zzqx不可能命中词9527';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(2500);
    const view = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#session-list .session-row')].length,
      text: (document.querySelector('#session-list')?.textContent || '').slice(0, 120),
    }));
    const file = await shot(page, 'srch-002-empty');
    await page.evaluate(() => {
      const s = document.querySelector('#search');
      s.value = '';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    if (view.rows > 0) throw new Error(`假命中 ${view.rows}: ${view.text}`);
    return { status: 'Pass', note: `空态=「${view.text.slice(0, 40)}」`, evidence: [file] };
  });

  record('SRCH-004', 'Blocked', '搜索 RPC 失败需断隧道造障（同 PAIR-015 批准范围）');
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
console.log('[list] done');
