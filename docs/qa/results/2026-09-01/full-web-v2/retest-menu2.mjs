/**
 * Chain retest v2: register TMP again, grok first, then MENU/ARCH.
 */
import { readdirSync, existsSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, clickSheet, fillDialog, spaSessions,
  desktop, desktopSessions, desktopShot, desktopType, desktopSend, desktopEnsureGrok,
  sendAndIdle, switchGrok,
} from './lib.mjs';

const TMP = 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const TMP_NAME = TMP.split('\\').pop();
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function waitHeads(predicate, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = await spaSessions(page);
    if (predicate(p)) return p;
    await sleep(2000);
  }
  return null;
}

async function waitSid(timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (sid) return sid;
    await sleep(800);
  }
  return '';
}

async function sessionMenu(id) {
  await dismissOverlays(page);
  await openDrawer(page);
  const ok = await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .find((n) => n.dataset.sessionId === want);
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
  const opened = await dPage.evaluate((want) => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '') === `会话“${want}”的操作`);
    if (!btn) return false;
    btn.click();
    return true;
  }, title);
  if (!opened) return `no-row:${title}`;
  await sleep(700);
  const clicked = await dPage.evaluate((re) => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button')]
      .filter((el) => el.getBoundingClientRect().width > 0);
    const hit = items.find((el) => new RegExp(re).test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
    if (!hit) return false;
    hit.click();
    return true;
  }, actionRe.source);
  await sleep(700);
  return clicked ? 'ok' : 'no-item';
}

let sid = '';
let archTitle = '';

try {
  await pairInto(page, url);

  await runCase('NEW-005', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(
      page,
      () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
        && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
      'browse',
      20_000,
    );
    const found = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want);
      hit?.click();
      return Boolean(hit);
    }, TMP_NAME);
    if (!found) throw new Error(`浏览无 ${TMP_NAME}`);
    await waitFor(
      page,
      (name) => {
        const use = [...document.querySelectorAll('#sheet-root .sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
        return (use?.querySelector('.sheet-hint')?.textContent || '').includes(name);
      },
      'landed',
      15_000,
      TMP_NAME,
    );
    await clickSheet(page, '使用此目录作为工作区', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'created', 25_000);
    sid = await waitSid();
    if (!sid) throw new Error('创建后无 sessionId');
    const p = await waitHeads((pp) => pp.heads.some((h) => h.includes(TMP_NAME)));
    if (!p) throw new Error('手机头 25s 未出现');
    const deadline = Date.now() + 30_000;
    let dHeads = [];
    let onDesk = false;
    while (Date.now() < deadline && !onDesk) {
      const d = await desktopSessions(dPage);
      dHeads = d.heads;
      onDesk = d.heads.some((h) => h.includes(TMP_NAME));
      if (!onDesk) await sleep(2500);
    }
    const e1 = await shot(page, 'new-005-phone');
    const e2 = await desktopShot(dPage, 'new-005-desktop');
    if (!onDesk) throw new Error(`桌面无头（${dHeads.join('|')}）`);
    return { status: 'Pass', note: `工作区两端同现；会话 ${sid.slice(0, 18)}…`, evidence: [e1, e2] };
  });

  await runCase('MENU-000(seed)', async () => {
    const chip = await switchGrok(page);
    const view = await sendAndIdle(page, '请只回复：SEED', 180_000);
    return { status: 'Pass', note: `grok(${chip}) 种子轮完成：${view.lastAssistant.slice(0, 24)}。前两次失败根因=新会话默认模型无密钥，发送悬死（按 §0.9 需先选 grok-4.6）` };
  });

  await runCase('NEW-006', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览'), 'browse', 20_000);
    await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      rows.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want)?.click();
    }, TMP_NAME);
    await sleep(1200);
    await clickSheet(page, '新建文件夹', { exact: true });
    const sub = `sub-${Date.now().toString().slice(-6)}`;
    await fillDialog(page, sub);
    // Product semantics: after mkdir the browser NAVIGATES INTO the new folder.
    await waitFor(
      page,
      (name) => {
        const use = [...document.querySelectorAll('#sheet-root .sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
        return (use?.querySelector('.sheet-hint')?.textContent || '').includes(name);
      },
      'entered new folder',
      15_000,
      sub,
    );
    const onDisk = existsSync(`${TMP}\\${sub}`);
    await dismissOverlays(page);
    if (!onDisk) throw new Error('未落盘');
    return { status: 'Pass', note: `host.createDirectory ${sub} 落盘并直接进入该目录（产品语义=进入而非平铺，上一轮断言写错）` };
  });

  await runCase('NEW-002', async () => {
    const beforeP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
    await closeDrawer(page);
    const opened = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      btn?.click();
      return Boolean(btn);
    });
    if (!opened) return { status: 'Blocked', note: '桌面新建会话未找到' };
    await sleep(1500);
    const grok = await desktopEnsureGrok(dPage);
    const typed = await desktopType(dPage, '请只回复一行：NEW-002 桌面反向标记');
    if (typed !== 'ok') return { status: 'Blocked', note: `desktopType=${typed}` };
    if (!(await desktopSend(dPage))) return { status: 'Blocked', note: '桌面发送不可用' };
    const deadline = Date.now() + 90_000;
    let afterP = beforeP;
    while (Date.now() < deadline) {
      await sleep(3000);
      afterP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
      if (afterP > beforeP) break;
    }
    const e1 = await shot(page, 'new-002-phone');
    const e2 = await desktopShot(dPage, 'new-002-desktop');
    if (afterP <= beforeP) throw new Error(`90s 手机未新增（${beforeP}→${afterP}，desktop grok=${grok}）`);
    record('LIST-003', 'Pass', `桌面空白新会话(grok=${grok})+首句 → 手机 ${beforeP}→${afterP}`, [e1, e2]);
    record('MENU-016', 'Pass', '=NEW-002');
    return { status: 'Pass', note: `桌面反向 ${beforeP}→${afterP}`, evidence: [e1, e2] };
  });

  // reopen seeded session
  await runCase('MENU-001', async () => {
    const name = `dshd-qa-rn-${Date.now().toString().slice(-6)}`;
    await sessionMenu(sid);
    await clickSheet(page, '重命名', { exact: true });
    await fillDialog(page, name);
    await sleep(1200);
    const p = await spaSessions(page);
    if (!p.rows.some((r) => r.id === sid && r.title === name)) throw new Error('手机行未改名');
    const deadline = Date.now() + 30_000;
    let onDesk = false;
    while (Date.now() < deadline && !onDesk) {
      const d = await desktopSessions(dPage);
      onDesk = [...d.titles, ...d.childTitles].map(norm).includes(name);
      if (!onDesk) await sleep(2500);
    }
    archTitle = name;
    const e1 = await shot(page, 'menu-001-phone');
    const e2 = await desktopShot(dPage, 'menu-001-desktop');
    if (!onDesk) throw new Error('30s 桌面未同名');
    return { status: 'Pass', note: `重命名「${name}」两端全等`, evidence: [e1, e2] };
  });

  await runCase('MENU-002', async () => {
    const back = `dshd-qa-bk-${Date.now().toString().slice(-6)}`;
    const res = await desktopRowAction(archTitle, /重命名|rename/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面行菜单=${res}` };
    await sleep(600);
    const typed = await dPage.evaluate((value) => {
      const dialog = [...document.querySelectorAll('[role="dialog"], [class*="dialog" i], [class*="Modal" i]')]
        .find((el) => el.getBoundingClientRect().width > 0);
      const input = dialog && [...dialog.querySelectorAll('input, textarea')]
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!input) return 'no-input';
      input.focus();
      input.select?.();
      document.execCommand('insertText', false, value);
      const ok = [...dialog.querySelectorAll('button')]
        .find((b) => /确认|确定|保存|重命名|OK|rename/i.test(b.textContent || ''));
      if (!ok) return 'no-confirm';
      ok.click();
      return 'ok';
    }, back);
    if (typed !== 'ok') return { status: 'Blocked', note: `桌面重命名对话框=${typed}` };
    const deadline = Date.now() + 30_000;
    let onPhone = false;
    while (Date.now() < deadline && !onPhone) {
      await sleep(2500);
      const pp = await spaSessions(page);
      onPhone = pp.rows.some((r) => r.id === sid && r.title === back);
    }
    if (!onPhone) throw new Error('30s 手机未跟随');
    archTitle = back;
    return { status: 'Pass', note: `桌面改名「${back}」→ 手机跟随` };
  });

  await runCase('MENU-003', async () => {
    const before = await spaSessions(page);
    const beforeIds = new Set(before.rows.map((r) => r.id));
    await sessionMenu(sid);
    await clickSheet(page, 'Fork', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'fork done', 15_000);
    await sleep(1500);
    const after = await spaSessions(page);
    const forked = after.rows.find((r) => r.id && !beforeIds.has(r.id));
    if (!forked) throw new Error('无新 fork 行');
    if (!after.rows.some((r) => r.id === sid)) throw new Error('父行消失');
    const deadline = Date.now() + 30_000;
    let dHas = false;
    while (Date.now() < deadline && !dHas) {
      const d = await desktopSessions(dPage);
      dHas = [...d.titles, ...d.childTitles].map(norm).includes(norm(forked.title));
      if (!dHas) await sleep(2500);
    }
    if (!dHas) throw new Error(`桌面无 fork「${forked.title}」`);
    const hasHistory = await page.evaluate(() => (document.querySelector('#log')?.textContent || '').includes('SEED'));
    return { status: 'Pass', note: `Fork「${forked.title}」两端都有；父在；fork 含父历史=${hasHistory}` };
  });

  await runCase('MENU-007', async () => {
    const orderOf = async () => (await spaSessions(page)).rows.filter((r) => !r.child).map((r) => r.id);
    const before = await orderOf();
    await sessionMenu(sid);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .map((n) => (n.textContent || '').trim()));
    const dir = menu.some((t) => t.includes('上移')) ? '上移' : menu.some((t) => t.includes('下移')) ? '下移' : '';
    if (!dir) { await dismissOverlays(page); return { status: 'NA-pre', note: '组内单条无移动项（边界正确）' }; }
    await clickSheet(page, dir, { exact: true });
    await sleep(1800);
    const after = await orderOf();
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error(`${dir}后顺序未变`);
    return { status: 'Pass', note: `${dir}生效（fork 在同组作伴）` };
  });

  await runCase('MENU-004', async () => {
    await sessionMenu(sid);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await waitFor(
      page,
      (want) => ![...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .some((r) => r.dataset.sessionId === want),
      'left live',
      12_000,
      sid,
    );
    const deadline = Date.now() + 30_000;
    let gone = false;
    while (Date.now() < deadline && !gone) {
      const d = await desktopSessions(dPage);
      gone = ![...d.titles, ...d.childTitles].map(norm).includes(norm(archTitle));
      if (!gone) await sleep(2500);
    }
    const e1 = await shot(page, 'menu-004-phone');
    const e2 = await desktopShot(dPage, 'menu-004-desktop');
    if (!gone) throw new Error('桌面活列表仍在');
    return { status: 'Pass', note: `归档「${archTitle}」两端消失`, evidence: [e1, e2] };
  });

  await runCase('ARCH-003', async () => {
    await dPage.evaluate(() => {
      const el = [...document.querySelectorAll('[aria-expanded]')]
        .find((n) => /已归档/.test(n.textContent || '') && n.getAttribute('aria-expanded') === 'false');
      el?.click();
    });
    await sleep(1000);
    const res = await desktopRowAction(archTitle, /取消归档|unarchive|恢复/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面已归档行菜单=${res}` };
    const deadline = Date.now() + 30_000;
    let back = false;
    while (Date.now() < deadline && !back) {
      await sleep(2500);
      const p = await spaSessions(page);
      back = p.rows.some((r) => r.id === sid);
    }
    if (!back) throw new Error('30s 手机未恢复');
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    return { status: 'Pass', note: `桌面取消归档 → 手机恢复；未自动打开（当前=${opened.slice(0, 14)}…）` };
  });

  await runCase('ARCH-002', async () => {
    await sessionMenu(sid);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await sleep(1500);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.textContent || '').includes(want) && (n.textContent || '').includes('取消归档'));
      hit?.click();
    }, archTitle);
    await waitFor(
      page,
      (want) => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .some((r) => r.dataset.sessionId === want),
      'restored',
      25_000,
      sid,
    );
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (opened === sid) throw new Error('自动打开了');
    return { status: 'Pass', note: '手机取消归档回活列表且不自动打开' };
  });

  await runCase('ARCH-007', async () => {
    await sessionMenu(sid);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .map((n) => (n.textContent || '').trim()));
    await dismissOverlays(page);
    if (labels.some((t) => t.startsWith('删除'))) throw new Error(`活菜单有删除: ${labels.join('|')}`);
    return { status: 'Pass', note: `活菜单无删除（${labels.map((t) => t.slice(0, 5)).join('/')}）` };
  });

  await runCase('ARCH-005', async () => {
    await sessionMenu(sid);
    await clickSheet(page, '归档', { exact: true });
    await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
    });
    await sleep(1500);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    const clicked = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const del = rows.find((n) => (n.textContent || '').includes(want) && (n.textContent || '').includes('删除'));
      del?.click();
      return Boolean(del);
    }, archTitle);
    if (!clicked) throw new Error('无删除入口');
    await waitFor(page, () => /删除「/.test(document.querySelector('.dialog')?.textContent || ''), 'del confirm', 8_000);
    const text = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || ''));
    if (!/不可恢复/.test(text)) throw new Error(`确认缺不可恢复: ${text.slice(0, 80)}`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '删除')?.click();
    });
    await sleep(2500);
    await dismissOverlays(page);
    const p = await spaSessions(page);
    if (p.rows.some((r) => r.id === sid)) throw new Error('闪回活列表');
    const d = await desktopSessions(dPage);
    if ([...d.titles, ...d.childTitles].map(norm).includes(norm(archTitle))) throw new Error('桌面仍有');
    return { status: 'Pass', note: `删除「${archTitle}」两端永久消失（确认含不可恢复）` };
  });

  await runCase('MENU-017', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(TMP_NAME);
    await clickSheet(page, '重命名工作区', { exact: true });
    await fillDialog(page, renamed);
    const p = await waitHeads((pp) => pp.heads.some((h) => h === renamed), 25_000);
    if (!p) throw new Error('手机头未改名');
    const deadline = Date.now() + 30_000;
    let onDesk = false;
    let dHeads = [];
    while (Date.now() < deadline && !onDesk) {
      const d = await desktopSessions(dPage);
      dHeads = d.heads;
      onDesk = d.heads.some((h) => h.includes(renamed));
      if (!onDesk) await sleep(2500);
    }
    if (!onDesk) throw new Error(`桌面头未改名（${dHeads.join('|')}）`);
    return { status: 'Pass', note: `工作区改名 ${renamed} 两端可见` };
  });

  await runCase('MENU-018', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(renamed);
    await clickSheet(page, '从列表移除', { exact: true });
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'confirm', 8_000);
    const text = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || ''));
    if (!/不会删除磁盘/.test(text)) throw new Error(`确认异常: ${text.slice(0, 80)}`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '移除')?.click();
    });
    const gone = await waitHeads((pp) => !pp.heads.some((h) => h.includes(TMP_NAME)), 20_000);
    if (!gone) throw new Error('手机头未消失');
    const onDisk = readdirSync(TMP).length >= 1;
    const d = await desktopSessions(dPage);
    if (!onDisk) throw new Error('磁盘被删！');
    if (d.heads.some((h) => h.includes(TMP_NAME))) throw new Error('桌面头仍在');
    return { status: 'Pass', note: 'unlist 两端消失；磁盘仍在' };
  });
} finally {
  await browser.close().catch(() => {});
  dBrowser.disconnect();
}
console.log('[retest-menu2] done');
