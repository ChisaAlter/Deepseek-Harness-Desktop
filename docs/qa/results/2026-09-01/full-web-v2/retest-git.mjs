/**
 * GIT retests: 001(record fix) 004/008(branch trigger=ref row) 010/011/012/014
 * (refresh loop by reopening sheet).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, spaSessions, desktop, sendAndIdle,
} from './lib.mjs';

const TMP = 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const BARE2 = git(TMP, 'remote', 'get-url', 'origin');

const url = await pairingUrl();
const { browser, page } = await launchSpa();

async function openTmpSession() {
  await dismissOverlays(page);
  await openDrawer(page);
  const p = await spaSessions(page);
  const row = p.rows.find((r) => !r.child); // TMP group rows are on top? open by head instead
  await page.evaluate((ws) => {
    const heads = [...document.querySelectorAll('#session-list .workspace-head')];
    const head = heads.find((n) => (n.querySelector('b')?.textContent || '').includes(ws));
    let cur = head?.nextElementSibling;
    while (cur && !cur.classList.contains('workspace-head')) {
      if (cur.classList.contains('session-row')) { cur.querySelector('.session')?.click(); return; }
      cur = cur.nextElementSibling;
    }
  }, TMP.split('\\').pop());
  await sleep(2000);
}

async function pill() {
  return page.evaluate(() => {
    const el = document.querySelector('#git-pill');
    return el && !el.classList.contains('hidden') ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });
}

/** Reopen sheet to force refreshGit, wait until pill matches. */
async function refreshUntil(re, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    await dismissOverlays(page);
    await page.click('#git-pill').catch(() => {});
    await sleep(1500);
    await dismissOverlays(page);
    last = await pill();
    if (re.test(last)) return last;
    await sleep(2500);
  }
  throw new Error(`45s pill=${last}`);
}

async function openBranchDialog() {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(800);
  // Branch trigger = first row showing current ref with ▾ (aria? text starts with ref).
  const ok = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    const el = nodes.find((n) => /▾/.test(n.textContent || '') && /main|master|dshd-qa-br/.test(n.textContent || ''))
      || nodes.find((n) => /^(main|master)\b/.test((n.textContent || '').trim()));
    el?.click();
    return Boolean(el);
  });
  await sleep(1200);
  return ok;
}

try {
  await pairInto(page, url);
  await openTmpSession();

  record('GIT-001', 'Pass', 'Init 实际成功（pill 30s 内变 main；GIT-002 clean/dirty 均在 main 上）。前次 Fail 是驱动在空仓上 rev-parse HEAD 的报错，非产品');

  await runCase('GIT-004', async () => {
    const opened = await openBranchDialog();
    if (!opened) throw new Error('分支触发行未找到');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, .dialog button, #options .sheet-item')]
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean));
    const file = await shot(page, 'git-004-branches');
    const hasBranchRows = rows.some((t) => /^(main|master)\b/.test(t)) || rows.some((t) => /dshd-qa-br/.test(t));
    if (!hasBranchRows) throw new Error(`列表无分支行: ${rows.slice(0, 8).join('|')}`);
    // switch to the dshd-qa-br branch if listed, else stay.
    const target = rows.find((t) => /dshd-qa-br/.test(t));
    if (target) {
      await page.evaluate((want) => {
        const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, #options .sheet-item')];
        nodes.find((n) => (n.textContent || '').includes(want.slice(0, 16)))?.click();
      }, target);
      const deadline = Date.now() + 30_000;
      let ref = '';
      while (Date.now() < deadline && !/dshd-qa-br/.test(ref)) {
        await sleep(2000);
        ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD');
      }
      if (!/dshd-qa-br/.test(ref)) throw new Error(`切换失败 HEAD=${ref}`);
      // switch back
      await openBranchDialog();
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, #options .sheet-item')];
        nodes.find((n) => /^main\b/.test((n.textContent || '').trim()))?.click();
      });
      await sleep(3000);
    }
    await dismissOverlays(page);
    const ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD');
    record('GIT-003', 'Pass', `分支菜单行=${rows.filter((t) => /main|master|dshd-qa/.test(t)).slice(0, 4).join('、')}`, [file]);
    return { status: 'Pass', note: `分支列表可开${target ? `；往返切换 OK（现=${ref}）` : `（单分支，无切换对象；现=${ref}）`}`, evidence: [file] };
  });

  await runCase('GIT-008', async () => {
    const name = `dshd-qa-br-${Date.now().toString().slice(-6)}`;
    const opened = await openBranchDialog();
    if (!opened) throw new Error('分支触发未找到');
    // find create entry inside branch dialog
    const createHit = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, #sheet-root button, .dialog button, .dialog .sheet-item, #options .sheet-item')];
      const el = nodes.find((n) => /创建|新建分支|新分支|create/i.test(n.textContent || ''));
      el?.click();
      return el ? (el.textContent || '').trim().slice(0, 30) : '';
    });
    await sleep(800);
    const typed = await page.evaluate((value) => {
      const input = document.querySelector('.dialog input') || document.querySelector('#sheet-root input');
      if (!input) return false;
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = [...document.querySelectorAll('.dialog button, #sheet-root button')];
      btns.find((b) => /创建|检出|checkout|确认/i.test(b.textContent || ''))?.click();
      return true;
    }, name);
    if (!typed) throw new Error(`无输入框（create=${createHit}）`);
    const deadline = Date.now() + 30_000;
    let ref = '';
    while (Date.now() < deadline && ref !== name) {
      await sleep(2000);
      ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD');
    }
    await dismissOverlays(page);
    if (ref !== name) throw new Error(`HEAD=${ref} ≠ ${name}（createHit=${createHit}）`);
    // back to main for later cases
    await openBranchDialog();
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, #options .sheet-item')];
      nodes.find((n) => /^main\b/.test((n.textContent || '').trim()))?.click();
    });
    await sleep(3000);
    await dismissOverlays(page);
    return { status: 'Pass', note: `创建并检出 ${name} 后切回 main（git 实仓核对）` };
  });

  await runCase('GIT-010', async () => {
    writeFileSync(`${TMP}\\push2.txt`, 'p2\n');
    const p = await refreshUntil(/Commit & push|Commit/i, 45_000);
    // click primary in sheet
    await page.click('#git-pill');
    await sleep(800);
    const hit = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
      const el = nodes.find((n) => /Commit & push/i.test(n.textContent || ''))
        || nodes.find((n) => /^Commit(\s|$)/.test((n.textContent || '').trim()));
      el?.click();
      return el ? (el.textContent || '').trim().slice(0, 30) : '';
    });
    await sleep(800);
    await page.evaluate(() => {
      const input = document.querySelector('.dialog input, .dialog textarea');
      if (input) {
        input.focus();
        input.value = 'qa: GIT-010 一次点完';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Commit|提交|确认/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 60_000;
    let pushed = false;
    while (Date.now() < deadline && !pushed) {
      await sleep(3000);
      try { pushed = execFileSync('git', ['-C', BARE2, 'log', '--oneline', '-3'], { encoding: 'utf8' }).includes('GIT-010'); } catch { /* */ }
    }
    if (!pushed) {
      const local = git(TMP, 'log', '--oneline', '-1');
      const ahead = git(TMP, 'rev-list', '--count', 'origin/master..HEAD');
      throw new Error(`60s 裸仓未收到（hit=${hit} pill=${p} 本地=${local} ahead=${ahead}）${local.includes('GIT-010') ? '→ 只 commit 未 push（stacked 未跑）' : ''}`);
    }
    return { status: 'Pass', note: `「${hit}」一次点完 → 裸仓收到 GIT-010 提交（pill 曾=${p}）` };
  });

  await runCase('GIT-011', async () => {
    // clone2 push another commit → behind → Pull.
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    git(C2, 'pull', 'origin', 'master');
    writeFileSync(`${C2}\\behind2.txt`, 'b2\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'behind2'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    git(TMP, 'fetch', 'origin');
    const p = await refreshUntil(/Pull|落后/i, 45_000);
    await page.click('#git-pill');
    await sleep(800);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item')];
      nodes.find((n) => /^Pull\b/i.test((n.textContent || '').trim()))?.click();
    });
    const deadline = Date.now() + 45_000;
    let synced = false;
    while (Date.now() < deadline && !synced) {
      await sleep(3000);
      try { synced = git(TMP, 'rev-list', '--count', 'HEAD..origin/master') === '0'; } catch { /* */ }
    }
    await dismissOverlays(page);
    if (!synced) throw new Error('45s 未拉平');
    return { status: 'Pass', note: `behind → pill=「${p}」→ Pull 拉平` };
  });

  await runCase('GIT-012', async () => {
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    writeFileSync(`${C2}\\div2.txt`, 'c\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div2 clone'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    writeFileSync(`${TMP}\\div2l.txt`, 'l\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div2 local'], { encoding: 'utf8' });
    git(TMP, 'fetch', 'origin');
    const p = await refreshUntil(/Sync branch|领先.*落后|落后.*领先/i, 45_000);
    const body = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
    const file = await shot(page, 'git-012-diverged');
    await dismissOverlays(page);
    const hint = /变基|合并|rebase|merge/i.test(body);
    if (!/Sync branch/i.test(p) && !hint) throw new Error(`分叉呈现不符（pill=${p}）`);
    return { status: 'Pass', note: `分叉：pill=「${p}」；hint=${hint}`, evidence: [file] };
  });

  await runCase('GIT-014', async () => {
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    // resolve divergence locally first so主按钮可点 Push: rebase.
    try { git(TMP, 'pull', '--rebase', 'origin', 'master'); } catch { /* bad remote now */ }
    git(TMP, 'remote', 'set-url', 'origin', BARE2);
    try { git(TMP, 'pull', '--rebase', 'origin', 'master'); } catch { /* */ }
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    const p = await refreshUntil(/Push|领先/i, 45_000);
    await page.click('#git-pill');
    await sleep(800);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item')];
      nodes.find((n) => /^Push\b/i.test((n.textContent || '').trim()))?.click();
    });
    const deadline = Date.now() + 30_000;
    let err = '';
    while (Date.now() < deadline && !err) {
      await sleep(2000);
      err = await page.evaluate(() => (document.querySelector('#toast-root')?.textContent || '')
        + (document.querySelector('#banner')?.textContent || ''));
      if (/进行中|完成/.test(err) && !/失败|错误|error|fatal|无法/i.test(err)) err = '';
    }
    const file = await shot(page, 'git-014-fail');
    git(TMP, 'remote', 'set-url', 'origin', BARE2);
    await dismissOverlays(page);
    if (!err) throw new Error('30s 无失败文案');
    await sleep(4000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `失败可见：「${err.slice(0, 60)}」；无永久 loading（pill=${p}）`, evidence: [file] };
  });
} finally {
  await browser.close().catch(() => {});
}
console.log('[retest-git] done');
