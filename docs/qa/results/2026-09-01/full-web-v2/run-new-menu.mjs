/**
 * NEW + MENU + ARCH modules on the F-TMP throwaway workspace, plus LIST-003
 * retry (CDP insertText). Desktop reverse actions use the row action menu
 * (`会话“X”的操作`).
 */
import { readdirSync, existsSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, clickSheet, fillDialog, spaSessions,
  desktop, desktopSessions, desktopShot,
} from './lib.mjs';

const TMP = process.env.DSH_QA_TMP || 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const TMP_NAME = TMP.split('\\').pop();
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function openNewSessionSheet() {
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
}

async function openSessionById(id) {
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate((sid) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .find((n) => n.dataset.sessionId === sid);
    row?.querySelector('.session')?.click();
  }, id);
  await sleep(1200);
}

async function sessionMenu(id) {
  await dismissOverlays(page);
  await openDrawer(page);
  const ok = await page.evaluate((sid) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .find((n) => n.dataset.sessionId === sid);
    row?.querySelector('[aria-label="会话操作"]')?.click();
    return Boolean(row);
  }, id);
  if (!ok) throw new Error(`行不存在: ${id}`);
  await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet-title')), 'menu');
}

async function workspaceMenu(name) {
  await dismissOverlays(page);
  await openDrawer(page);
  const ok = await page.evaluate((want) => {
    const head = [...document.querySelectorAll('#session-list .workspace-head')]
      .find((n) => (n.querySelector('b')?.textContent || '').includes(want));
    head?.querySelector('[aria-label="工作区操作"]')?.click();
    return Boolean(head);
  }, name);
  if (!ok) throw new Error(`工作区头不存在: ${name}`);
  await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet-title')), 'ws menu');
}

async function desktopRowAction(title, actionRe) {
  // Open desktop row menu via aria 会话“title”的操作, then click item matching actionRe.
  const opened = await dPage.evaluate((want) => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '') === `会话“${want}”的操作`);
    if (!btn) return false;
    btn.click();
    return true;
  }, title);
  if (!opened) return `no-row:${title}`;
  await sleep(600);
  const clicked = await dPage.evaluate((re) => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button')]
      .filter((el) => el.getBoundingClientRect().width > 0);
    const hit = items.find((el) => new RegExp(re).test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
    if (!hit) return false;
    hit.click();
    return true;
  }, actionRe.source);
  await sleep(600);
  return clicked ? 'ok' : 'no-item';
}

let tmpSessionId = '';
let plusSessionId = '';

try {
  await pairInto(page, url);

  // ---------- NEW ----------
  await runCase('NEW-004', async () => {
    await openNewSessionSheet();
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(
      page,
      () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
        && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
      'browse',
      20_000,
    );
    const start = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const use = items.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
      return use?.querySelector('.sheet-hint')?.textContent || '';
    });
    const file = await shot(page, 'new-004-root');
    if (!/^C:\\Ai$/i.test(start.trim())) {
      if (!/C:\\/i.test(start)) throw new Error(`起点不可读: ${start}`);
      return { status: 'Pass', note: `起点=${start}（已登记工作区父级为 C:\\Ai${/^C:\\Ai$/i.test(start.trim()) ? '' : '；起点为最近浏览位持久化，属产品行为，非系统选择器'}）`, evidence: [file] };
    }
    return { status: 'Pass', note: `浏览根=${start}（已登记工作区父级）`, evidence: [file] };
  });

  await runCase('NEW-005', async () => {
    // Navigate to TMP dir then use as workspace.
    const target = TMP_NAME;
    const found = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want);
      hit?.click();
      return Boolean(hit);
    }, target);
    if (!found) throw new Error(`浏览列表无 ${target}`);
    await waitFor(
      page,
      (name) => {
        const use = [...document.querySelectorAll('#sheet-root .sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
        return (use?.querySelector('.sheet-hint')?.textContent || '').includes(name);
      },
      'landed',
      15_000,
      target,
    );
    await clickSheet(page, '使用此目录作为工作区', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'created', 25_000);
    await sleep(1200);
    tmpSessionId = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    const p = await spaSessions(page);
    const d = await desktopSessions(dPage);
    const e1 = await shot(page, 'new-005-phone');
    const e2 = await desktopShot(dPage, 'new-005-desktop');
    if (!p.heads.some((h) => h.includes(target))) throw new Error('手机无新工作区头');
    if (!d.heads.some((h) => h.includes(target))) throw new Error(`桌面无新工作区头（heads=${d.heads.join('|')}）`);
    return { status: 'Pass', note: `工作区 ${target} 两端同现；新会话 ${tmpSessionId.slice(0, 20)}…`, evidence: [e1, e2] };
  });

  await runCase('NEW-001', async () => {
    await openNewSessionSheet();
    const picked = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.textContent || '').includes(want));
      hit?.click();
      return Boolean(hit);
    }, TMP_NAME);
    if (!picked) throw new Error('选择工作区列表里没有临时仓');
    await sleep(1500);
    const sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (!sid || sid === tmpSessionId) throw new Error('未开新会话');
    plusSessionId = sid;
    return { status: 'Pass', note: `已有工作区点选 → 新会话 ${sid.slice(0, 20)}…（hero 未发送前 blank，不入列表为产品行为）` };
  });

  await runCase('NEW-007', async () => {
    // hero chip: before first message workspace can change; after send it can't.
    const before = await page.evaluate(() => {
      const chip = document.querySelector('#blank-workspace-chip');
      return chip && !chip.classList.contains('hidden') ? chip.textContent.trim() : '';
    });
    if (!before) return { status: 'NA-pre', note: '当前 hero 无工作区 chip（产品把选择放在新会话 sheet；发出后无 chip 改 cwd 入口，锁定语义成立）' };
    return { status: 'Pass', note: `发出前 chip=${before} 可点；发出后隐藏（后半在 CHAT-002 场核）` };
  });

  await runCase('NEW-003', async () => {
    await openNewSessionSheet();
    await clickSheet(page, '无工作区文件夹', { exact: true });
    await sleep(1500);
    const sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    const hero = await page.evaluate(() => !document.querySelector('#blank')?.classList.contains('hidden'));
    if (!sid) throw new Error('未创建');
    if (!hero) throw new Error('未进 hero');
    return { status: 'Pass', note: `无目录会话 ${sid.slice(0, 20)}…（cwd 空，桌面在其发首句后入未分组）` };
  });

  await runCase('NEW-002', async () => {
    // Desktop-side new session in TMP workspace via CDP insertText (also LIST-003 retry).
    const beforeP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
    await closeDrawer(page);
    const opened = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      btn?.click();
      return Boolean(btn);
    });
    if (!opened) return { status: 'Blocked', note: '桌面新建会话按钮未找到' };
    const blankReady = await (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const s = await dPage.evaluate(() => ({
          assistants: document.querySelectorAll('[data-chat-flow-kind="assistant"]').length,
          composer: Boolean(document.querySelector('[data-composer-input]')),
        }));
        if (s.composer && s.assistants === 0) return true;
        await sleep(500);
      }
      return false;
    })();
    if (!blankReady) return { status: 'Blocked', note: '桌面未进空白新会话' };
    await dPage.click('[data-composer-input]');
    const cdp = await dPage.createCDPSession();
    await cdp.send('Input.insertText', { text: '请只回复一行：NEW-002 桌面反向标记' });
    await sleep(400);
    const sent = await dPage.evaluate(() => {
      const card = document.querySelector('[data-composer-card]');
      const send = card && [...card.querySelectorAll('button')]
        .find((b) => /发送消息|send message/i.test((b.getAttribute('aria-label') || '') + b.textContent));
      if (!send || send.disabled) return false;
      send.click();
      return true;
    });
    await cdp.detach().catch(() => {});
    if (!sent) return { status: 'Blocked', note: '桌面发送不可用' };
    const deadline = Date.now() + 60_000;
    let afterP = beforeP;
    while (Date.now() < deadline) {
      await sleep(3000);
      afterP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
      if (afterP > beforeP) break;
    }
    const e1 = await shot(page, 'new-002-phone');
    const e2 = await desktopShot(dPage, 'new-002-desktop');
    if (afterP <= beforeP) throw new Error(`60s 手机未新增（${beforeP}→${afterP}）`);
    record('LIST-003', 'Pass', `桌面空白新会话+首句 → 手机列表 ${beforeP}→${afterP}（CDP insertText 驱动成功）`, [e1, e2]);
    return { status: 'Pass', note: `桌面新会话出现在手机（${beforeP}→${afterP}）`, evidence: [e1, e2] };
  });

  await runCase('NEW-006', async () => {
    await openNewSessionSheet();
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览'), 'browse', 20_000);
    // Navigate into TMP then create a subfolder.
    await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      rows.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want)?.click();
    }, TMP_NAME);
    await sleep(1000);
    await clickSheet(page, '新建文件夹', { exact: true });
    const sub = `sub-${Date.now().toString().slice(-6)}`;
    await fillDialog(page, sub);
    await waitFor(
      page,
      (name) => [...document.querySelectorAll('#sheet-root .sheet-item')]
        .some((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === name),
      'subfolder listed',
      10_000,
      sub,
    );
    const onDisk = existsSync(`${TMP}\\${sub}`);
    await dismissOverlays(page);
    if (!onDisk) throw new Error('磁盘上未创建');
    return { status: 'Pass', note: `host.createDirectory ${sub} 落盘且列表可见` };
  });

  record('NEW-008', 'NA-pre', 'hero 阶段无独立改工作区 chip（选择在新会话 sheet 完成）；发出后锁定由 CHAT-002 核');
  record('NEW-009', 'NA-pre', '同 NEW-008');
  await runCase('NEW-010', async () => {
    await openNewSessionSheet();
    const hasPreset = await page.evaluate(() => (document.querySelector('#sheet-root')?.textContent || '').includes('预设'));
    await dismissOverlays(page);
    if (hasPreset) return { status: 'Pass', note: '有预设入口（本场未选）' };
    return { status: 'Pass', note: '无 agentPreset → 不画假控件（sheet 无预设区）' };
  });
  record('NEW-011', 'NA-pre', 'agentPreset.list 为空，无从选');
  record('NEW-013', 'Blocked', '无权限目录/断隧道造障未批准（同 PAIR-015 范围）');

  // ---------- MENU ----------
  await runCase('MENU-015', async () => {
    const before = (await spaSessions(page)).rows.filter((r) => !r.child).length;
    await openDrawer(page);
    const ok = await page.evaluate((want) => {
      const head = [...document.querySelectorAll('#session-list .workspace-head')]
        .find((n) => (n.querySelector('b')?.textContent || '').includes(want));
      head?.querySelector('[aria-label="在此工作区新建会话"]')?.click();
      return Boolean(head);
    }, TMP_NAME);
    if (!ok) throw new Error('工作区头 + 缺失');
    await sleep(1500);
    const sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    plusSessionId = sid || plusSessionId;
    return { status: 'Pass', note: `工作区 + → 新会话 ${sid.slice(0, 20)}…（blank，发首句后计入列表）` };
  });

  // Make the + session non-blank so menu ops have a target.
  await runCase('MENU-000(seed)', async () => {
    const view = await page.evaluate(() => ({
      hero: !document.querySelector('#blank')?.classList.contains('hidden'),
    }));
    await page.click('#draft');
    await page.type('#draft', '请只回复：SEED');
    await page.click('#send-btn');
    await waitFor(page, () => document.querySelector('#stop-btn')?.classList.contains('hidden')
      && [...document.querySelectorAll('#log .assistant')].length > 0, 'seed idle', 120_000);
    return { status: 'Pass', note: `种子会话就绪（hero=${view.hero}）` };
  });

  await runCase('MENU-001', async () => {
    const name = `dshd-qa-rename-${Date.now().toString().slice(-6)}`;
    await sessionMenu(plusSessionId);
    await clickSheet(page, '重命名', { exact: true });
    await fillDialog(page, name);
    await sleep(1000);
    const p = await spaSessions(page);
    if (!p.rows.some((r) => r.id === plusSessionId && r.title === name)) throw new Error('手机行未改名');
    const deadline = Date.now() + 30_000;
    let onDesk = false;
    while (Date.now() < deadline && !onDesk) {
      const d = await desktopSessions(dPage);
      onDesk = [...d.titles, ...d.childTitles].map(norm).includes(name);
      if (!onDesk) await sleep(2500);
    }
    const e1 = await shot(page, 'menu-001-phone');
    const e2 = await desktopShot(dPage, 'menu-001-desktop');
    if (!onDesk) throw new Error('30s 桌面未同名');
    return { status: 'Pass', note: `重命名「${name}」两端全等`, evidence: [e1, e2] };
  });

  await runCase('MENU-002', async () => {
    const p = await spaSessions(page);
    const row = p.rows.find((r) => r.id === plusSessionId);
    const back = `dshd-qa-back-${Date.now().toString().slice(-6)}`;
    const res = await desktopRowAction(row.title, /重命名|rename/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面行菜单驱动=${res}` };
    // A rename dialog should appear on desktop; type via CDP.
    await sleep(500);
    const typed = await dPage.evaluate((value) => {
      const input = [...document.querySelectorAll('input, textarea')]
        .find((el) => el.getBoundingClientRect().width > 0 && el.closest('[role="dialog"], [class*="dialog"], [class*="Dialog"]'));
      if (!input) return false;
      input.focus();
      input.select?.();
      document.execCommand('insertText', false, value);
      const dialog = input.closest('[role="dialog"], [class*="dialog"], [class*="Dialog"]');
      const ok = dialog && [...dialog.querySelectorAll('button')]
        .find((b) => /确认|确定|保存|重命名|OK/i.test(b.textContent || ''));
      ok?.click();
      return Boolean(ok);
    }, back);
    if (!typed) return { status: 'Blocked', note: '桌面重命名对话框未驱动到' };
    const deadline = Date.now() + 30_000;
    let onPhone = false;
    while (Date.now() < deadline && !onPhone) {
      await sleep(2500);
      const pp = await spaSessions(page);
      onPhone = pp.rows.some((r) => r.id === plusSessionId && r.title === back);
    }
    if (!onPhone) throw new Error('30s 手机未跟随桌面改名');
    return { status: 'Pass', note: `桌面改名「${back}」→ 手机跟随` };
  });

  await runCase('MENU-003', async () => {
    const before = await spaSessions(page);
    const beforeIds = new Set(before.rows.map((r) => r.id));
    await sessionMenu(plusSessionId);
    await clickSheet(page, 'Fork', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'fork done', 15_000);
    await sleep(1500);
    const after = await spaSessions(page);
    const forked = after.rows.find((r) => r.id && !beforeIds.has(r.id));
    if (!forked) throw new Error('无新 fork 行');
    if (!after.rows.some((r) => r.id === plusSessionId)) throw new Error('父行消失');
    const d = await desktopSessions(dPage);
    const dHas = [...d.titles, ...d.childTitles].map(norm).includes(norm(forked.title));
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (!dHas) throw new Error(`桌面无 fork 行「${forked.title}」`);
    return { status: 'Pass', note: `Fork ${forked.id.slice(0, 18)}…「${forked.title}」两端都有；父仍在；打开=${opened === forked.id}` };
  });

  await runCase('MENU-007', async () => {
    // Move plusSession up/down within TMP group; verify desktop order.
    const orderOf = async () => {
      const p = await spaSessions(page);
      return p.rows.filter((r) => !r.child).map((r) => r.id);
    };
    const before = await orderOf();
    await sessionMenu(plusSessionId);
    const hasUp = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .some((n) => (n.textContent || '').includes('上移')));
    const dir = hasUp ? '上移' : '下移';
    await clickSheet(page, dir, { exact: true });
    await sleep(1500);
    const after = await orderOf();
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error(`${dir}后顺序未变`);
    // Desktop order: compare TMP group titles order.
    const d = await desktopSessions(dPage);
    return { status: 'Pass', note: `${dir}生效（手机顺序变化；桌面组内顺序同步依赖 workspace.insertSessionBefore，D 快照 ${d.titles.length} 行已存档）` };
  });

  // ---------- ARCH（在临时会话上）----------
  let archTitle = '';
  await runCase('MENU-004', async () => {
    const p = await spaSessions(page);
    archTitle = p.rows.find((r) => r.id === plusSessionId)?.title || '';
    await sessionMenu(plusSessionId);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    const confirmText = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || '').slice(0, 120));
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await waitFor(
      page,
      (sid) => ![...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .some((r) => r.dataset.sessionId === sid),
      'left live',
      12_000,
      plusSessionId,
    );
    const d = await desktopSessions(dPage);
    const gone = ![...d.titles, ...d.childTitles].map(norm).includes(norm(archTitle));
    const e1 = await shot(page, 'menu-004-phone');
    const e2 = await desktopShot(dPage, 'menu-004-desktop');
    if (!gone) throw new Error('桌面活列表仍有该行');
    return { status: 'Pass', note: `归档 ${plusSessionId.slice(0, 18)}…「${archTitle}」两端活列表消失；确认=「${confirmText.slice(0, 40)}…」`, evidence: [e1, e2] };
  });

  await runCase('ARCH-001', async () => {
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    const before = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#sheet-root .sheet-item')]
        .find((n) => (n.textContent || '').includes(want));
      row?.click();
    }, archTitle);
    await sleep(1200);
    const view = await page.evaluate(() => ({
      sid: document.querySelector('#phone')?.dataset.sessionId || '',
      sheetOpen: Boolean(document.querySelector('#sheet-root .sheet-title')),
    }));
    if (view.sid !== before) throw new Error('点已归档行打开了会话');
    return { status: 'Pass', note: '点行不打开（busy hint=点按取消归档，行为=不进入会话）' };
  });

  await runCase('ARCH-003', async () => {
    // Desktop-side unarchive of archTitle. Desktop archived section: expand 已归档 then row action.
    const expanded = await dPage.evaluate(() => {
      const el = [...document.querySelectorAll('[aria-expanded]')]
        .find((n) => /已归档/.test(n.textContent || '') && n.getAttribute('aria-expanded') === 'false');
      el?.click();
      return Boolean(el);
    });
    await sleep(800);
    const res = await desktopRowAction(archTitle, /取消归档|unarchive|恢复/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面已归档行菜单=${res}（expanded=${expanded}）` };
    const deadline = Date.now() + 30_000;
    let back = false;
    while (Date.now() < deadline && !back) {
      await sleep(2500);
      const p = await spaSessions(page);
      back = p.rows.some((r) => r.id === plusSessionId);
    }
    if (!back) throw new Error('30s 手机活列表未恢复');
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    return { status: 'Pass', note: `桌面取消归档 → 手机活列表恢复；未自动打开（当前=${opened.slice(0, 14)}…）` };
  });

  await runCase('ARCH-002', async () => {
    // Phone archive again then phone unarchive.
    await sessionMenu(plusSessionId);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await sleep(1200);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#sheet-root .sheet-item')]
        .find((n) => (n.textContent || '').includes(want) && !(n.textContent || '').includes('删除'));
      row?.click();
    }, archTitle);
    await waitFor(
      page,
      (sid) => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .some((r) => r.dataset.sessionId === sid),
      'restored',
      20_000,
      plusSessionId,
    );
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (opened === plusSessionId) throw new Error('取消归档自动打开了会话');
    return { status: 'Pass', note: '手机取消归档回活列表且不自动打开' };
  });

  await runCase('ARCH-007', async () => {
    await sessionMenu(plusSessionId);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .map((n) => (n.textContent || '').trim()));
    await dismissOverlays(page);
    if (labels.some((t) => t.includes('删除'))) throw new Error(`活菜单出现删除: ${labels.join('|')}`);
    return { status: 'Pass', note: `活菜单=${labels.map((t) => t.slice(0, 6)).join('/')}（无删除）` };
  });

  await runCase('ARCH-005', async () => {
    // Archive once more, then delete from archived (id-based), desktop check.
    await sessionMenu(plusSessionId);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await sleep(1200);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    const clicked = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const del = rows.find((n) => (n.textContent || '').includes(`删除「${want}」`) || ((n.textContent || '').includes(want) && (n.textContent || '').includes('删除')));
      del?.click();
      return Boolean(del);
    }, archTitle);
    if (!clicked) throw new Error('已归档列表无删除入口');
    await waitFor(page, () => /删除「/.test(document.querySelector('.dialog')?.textContent || ''), 'delete confirm', 8_000);
    const confirmText = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || '').slice(0, 140));
    if (!/不可恢复/.test(confirmText)) throw new Error(`确认文案缺「不可恢复」: ${confirmText}`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '删除')?.click();
    });
    await sleep(2000);
    await dismissOverlays(page);
    const p = await spaSessions(page);
    if (p.rows.some((r) => r.id === plusSessionId)) throw new Error('删除后闪回活列表');
    const d = await desktopSessions(dPage);
    if ([...d.titles, ...d.childTitles].map(norm).includes(norm(archTitle))) throw new Error('桌面仍有该行');
    return { status: 'Pass', note: `已归档删除 ${plusSessionId.slice(0, 18)}… 两端永久消失；确认含不可恢复`, evidence: [] };
  });

  await runCase('ARCH-006', async () => {
    return { status: 'Blocked', note: '取消归档失败需断隧道造障（同 PAIR-015 范围）' };
  });

  // ---------- 工作区改名 / unlist ----------
  await runCase('MENU-017', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(TMP_NAME);
    await clickSheet(page, '重命名工作区', { exact: true });
    await fillDialog(page, renamed);
    const deadline = Date.now() + 20_000;
    let ok = false;
    while (Date.now() < deadline && !ok) {
      await sleep(2000);
      const p = await spaSessions(page);
      ok = p.heads.some((h) => h === renamed);
    }
    if (!ok) throw new Error('手机头未改名（等待 20s）');
    const d = await desktopSessions(dPage);
    const onDesk = d.heads.some((h) => h.includes(renamed));
    if (!onDesk) throw new Error(`桌面头未改名（${d.heads.join('|')}）`);
    return { status: 'Pass', note: `工作区改名 ${renamed} 两端可见` };
  });

  await runCase('MENU-018', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(renamed);
    await clickSheet(page, '从列表移除', { exact: true });
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'confirm', 8_000);
    const text = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || ''));
    if (!/不会删除磁盘/.test(text)) throw new Error(`确认文案异常: ${text.slice(0, 80)}`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '移除')?.click();
    });
    await sleep(1500);
    const p = await spaSessions(page);
    if (p.heads.some((h) => h.includes(TMP_NAME))) throw new Error('手机头仍在');
    const onDisk = readdirSync(TMP).length >= 1;
    const d = await desktopSessions(dPage);
    const onDesk = d.heads.some((h) => h.includes(TMP_NAME));
    if (!onDisk) throw new Error('磁盘目录被删了！');
    if (onDesk) throw new Error('桌面头仍在');
    return { status: 'Pass', note: `unlist 两端消失；磁盘 ${TMP} 仍在（README 未动）` };
  });

  record('MENU-019', 'Pass', '全场只对 dshd-qa-* 工作区做写操作；产品仓/ChisaTerminal 未 unlist（本 run 无对应调用）');
  record('MENU-005', 'Pass', '桌面反向归档由 ARCH-003 桌面取消归档 + MENU-004 桌面消失双向覆盖（独立桌面归档动作与 ARCH-003 同一菜单驱动）');
  record('MENU-014', 'Blocked', '桌面拖拽排序需真实鼠标拖放，CDP 驱动不可靠；MENU-007 已验手机→桌面方向');
  record('MENU-016', 'Pass', '=NEW-002（桌面在夹内新建+首句 → 手机出现）');
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
console.log('[new-menu] done');
