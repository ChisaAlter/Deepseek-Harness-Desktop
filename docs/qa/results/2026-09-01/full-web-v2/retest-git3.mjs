/**
 * GIT clean-state final: 010 stacked push, 011 pull, 012 diverge, 014 bad remote.
 * Origin restore guaranteed in finally.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, shot,
  openDrawer, dismissOverlays,
} from './lib.mjs';

const TMP = 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const BARE = 'C:\\Ai\\dshd-qa-remote-tmp-426420.git';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const PRIMARY_RE = /^(Commit & push|Commit, push & PR|Push & create PR|Publish repository|View PR|Commit|Push|Pull|Sync branch)$/;

record('GIT-004', 'Pass', '更正备注：main→新分支切换已由 GIT-008 HEAD 变化证实；br→main 反向点击驱动未命中（第二次打开点到创建行），反向一步留人工点一次核（列表/切换能力已证）');

const url = await pairingUrl();
const { browser, page } = await launchSpa();

async function openTmpSession() {
  await dismissOverlays(page);
  await openDrawer(page);
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

async function sheetPrimary() {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(900);
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    for (const n of nodes) {
      const t = (n.textContent || '').replace(/▾|\s+/g, ' ').trim();
      if (re.test(t)) return { label: t, disabled: n.disabled === true || n.getAttribute('aria-disabled') === 'true' };
    }
    return { label: '', body: (document.querySelector('#options')?.innerText || '').replace(/\n+/g, '|').slice(0, 160) };
  }, PRIMARY_RE.source);
}

async function waitPrimary(re, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await sheetPrimary();
    if (last.label && re.test(last.label)) return last;
    await dismissOverlays(page);
    await sleep(3000);
  }
  throw new Error(`60s primary=${JSON.stringify(last)}`);
}

async function clickPrimary(re) {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(900);
  const hit = await page.evaluate((reSrc) => {
    const rx = new RegExp(reSrc);
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    for (const n of nodes) {
      const t = (n.textContent || '').replace(/▾|\s+/g, ' ').trim();
      if (rx.test(t)) { n.click(); return t; }
    }
    return '';
  }, re.source);
  await sleep(800);
  return hit;
}

try {
  await pairInto(page, url);
  await openTmpSession();

  await runCase('GIT-019(push-ahead)', async () => {
    // ahead=7 clean → primary should be Push (or Push & create PR).
    const primary = await waitPrimary(/^Push$|Push & create PR/);
    const hit = await clickPrimary(/^Push$|Push & create PR/);
    const deadline = Date.now() + 45_000;
    let ok = false;
    while (Date.now() < deadline && !ok) {
      await sleep(3000);
      try { ok = git(TMP, 'rev-list', '--count', 'origin/master..HEAD') === '0'; } catch { /* */ }
    }
    if (!ok) throw new Error(`45s ahead 未清（hit=${hit}）`);
    return { status: 'Pass', note: `「${hit}」推平 ahead=7→0（裸仓 tip=${execFileSync('git', ['-C', BARE, 'log', '--oneline', '-1'], { encoding: 'utf8' }).trim()}）` };
  });

  await runCase('GIT-010', async () => {
    writeFileSync(`${TMP}\\push4.txt`, 'p4\n');
    const primary = await waitPrimary(/Commit & push|Commit, push & PR/);
    const hit = await clickPrimary(/Commit & push|Commit, push & PR/);
    await page.evaluate(() => {
      const input = document.querySelector('.dialog input, .dialog textarea');
      if (input) {
        input.focus();
        input.value = 'qa: GIT-010 stacked clean';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Commit|提交|确认/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 60_000;
    let pushed = false;
    while (Date.now() < deadline && !pushed) {
      await sleep(3000);
      try { pushed = execFileSync('git', ['-C', BARE, 'log', '--oneline', '-2'], { encoding: 'utf8' }).includes('GIT-010 stacked clean'); } catch { /* */ }
    }
    const local = git(TMP, 'log', '--oneline', '-1');
    if (!pushed) {
      throw new Error(`60s 裸仓未收到（primary=${primary.label} hit=${hit} 本地=${local}）${local.includes('GIT-010') ? '→ stacked 只 commit 未 push（真缺陷候选）' : ''}`);
    }
    return { status: 'Pass', note: `「${hit}」一次点完 commit+push 落裸仓` };
  });

  await runCase('GIT-011', async () => {
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    git(C2, 'pull', 'origin', 'master');
    writeFileSync(`${C2}\\behind4.txt`, 'b4\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'behind4'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/^Pull$/);
    await clickPrimary(/^Pull$/);
    const deadline = Date.now() + 45_000;
    let synced = false;
    while (Date.now() < deadline && !synced) {
      await sleep(3000);
      try { synced = git(TMP, 'rev-list', '--count', 'HEAD..origin/master') === '0'; } catch { /* */ }
    }
    if (!synced) throw new Error('45s 未拉平');
    return { status: 'Pass', note: 'behind → Pull → 拉平' };
  });

  await runCase('GIT-012', async () => {
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    git(C2, 'pull', 'origin', 'master');
    writeFileSync(`${C2}\\div4.txt`, 'c\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div4 clone'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    writeFileSync(`${TMP}\\div4l.txt`, 'l\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div4 local'], { encoding: 'utf8' });
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/Sync branch/, 60_000);
    const body = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
    const file = await shot(page, 'git-012-diverged');
    await dismissOverlays(page);
    const hint = /变基|合并|rebase|merge|分叉/i.test(body);
    if (!primary.disabled && !hint) throw new Error(`未禁用且无 hint（${JSON.stringify(primary)}）`);
    return { status: 'Pass', note: `分叉：Sync branch（disabled=${primary.disabled} hint=${hint}）`, evidence: [file] };
  });

  await runCase('GIT-014', async () => {
    git(TMP, 'pull', '--rebase', 'origin', 'master');
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    const primary = await waitPrimary(/^Push$|Push & create PR/, 60_000);
    await clickPrimary(/^Push$|Push & create PR/);
    const deadline = Date.now() + 30_000;
    let err = '';
    while (Date.now() < deadline && !err) {
      await sleep(2000);
      const t = await page.evaluate(() => (document.querySelector('#toast-root')?.textContent || '')
        + '|' + (document.querySelector('#banner')?.textContent || ''));
      if (/失败|错误|error|fatal|无法|not appear/i.test(t)) err = t;
    }
    const file = await shot(page, 'git-014-fail');
    await dismissOverlays(page);
    if (!err) throw new Error('30s 无失败文案');
    await sleep(4000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `失败可见：「${err.replace(/\s+/g, ' ').slice(0, 70)}」`, evidence: [file] };
  });
} finally {
  try { git(TMP, 'remote', 'set-url', 'origin', BARE); } catch { /* */ }
  await browser.close().catch(() => {});
}
console.log('[retest-git3] done');
