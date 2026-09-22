/**
 * LAN :3180 A+B rehearsal against the already-running source Electron daemon.
 * Keys checks by TC-MREM ids. Does not bounce daemon, does not log #offer=.
 * Rehearsal only — not T1 / T3 Pass.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../../../../src/main/chisacode-remote.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../../../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

const CHROME = chromePath();
const SHOT_DIR = path.join(process.cwd(), 'docs', 'qa', 'results', '2026-09-01', 'remote-cookie-live');
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);
const FOLDER_NAME = `dshd-ws-live-${Date.now()}`;
const PROTECTED_HEADS = /Deepseek-Harness-Desktop|ChisaTerminal/;
const ROUNDS = [
  '用一句话回复：你已连通，并给出一个三位数验证码。',
  '刚才的验证码是多少？只回答数字。',
  '阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。',
  '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
  '汇总：验证码、产品一句话、目录名各一行。',
];

const results = [];
let failures = 0;
const dumps = {};

const THROWAY_HEAD = /dshd-ws-live-|dshd-ws-s09-/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function check(id, fn) {
  try {
    const outcome = await fn();
    if (outcome?.blocked) {
      results.push(`Blocked - ${id}: ${outcome.blocked}`);
      console.log(`Blocked - ${id}: ${outcome.blocked}`);
      return;
    }
    results.push(`Pass - ${id}`);
    console.log(`Pass - ${id}`);
  } catch (error) {
    failures += 1;
    const message = error?.message || String(error);
    results.push(`Fail - ${id}: ${message}`);
    console.log(`Fail - ${id}: ${message}`);
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
  } catch {
    return '<unparseable pairing url>';
  }
}

function loopbackPairing(url) {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  return parsed.toString();
}

async function waitFor(page, fn, message, timeout = 8000, arg) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function pairingUrl() {
  const home = path.join(USER_DATA, 'chisacode-home');
  assert(existsSync(home), 'missing chisacode-home');
  const api = await loadServerApi();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: home,
    relayEnabled: true,
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayPublicEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: 'http://127.0.0.1:3180',
    includeQr: false,
  });
  const rawUrl = pairing?.url || '';
  assert(rawUrl && /#offer=/.test(rawUrl), 'no pairing url');
  return loopbackPairing(rawUrl);
}

function drawerDump() {
  return {
    heads: [...document.querySelectorAll('#session-list .workspace-head')].map((head) => ({
      id: head.dataset.workspaceId || '',
      title: head.querySelector('b')?.textContent || '',
      add: Boolean(head.querySelector('[aria-label="在此工作区新建会话"]')),
      more: Boolean(head.querySelector('[aria-label="工作区操作"]')),
    })),
    sessions: [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].map((row) => ({
      id: row.dataset.sessionId || '',
      title: row.querySelector('.session b')?.textContent || '',
      child: row.classList.contains('session-child'),
    })),
    foot: document.querySelector('#session-list')?.textContent || '',
    banner: document.querySelector('#banner')?.textContent || '',
    more: /加载更多/.test(document.querySelector('#session-list')?.textContent || ''),
  };
}

async function openDrawer(page) {
  const open = await page.evaluate(() => document.querySelector('#phone')?.hasAttribute('data-drawer'));
  if (!open) {
    await page.evaluate(() => document.querySelector('#menu')?.click());
  }
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 10_000);
  await waitFor(
    page,
    () => document.querySelectorAll('#session-list .session b').length >= 1
      || (document.querySelector('#session-list')?.textContent || '').includes('无法加载'),
    'drawer rows',
    25_000,
  );
  await sleep(400);
  return page.evaluate(drawerDump);
}

async function closeDrawer(page) {
  await page.evaluate(() => document.querySelector('#backdrop')?.click());
  await sleep(200);
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelector('#close-settings')?.click();
    document.querySelector('.sheet-mask')?.click();
    document.querySelector('.dialog-mask')?.click();
    document.querySelector('.dialog .ghost-btn')?.click();
  });
  await sleep(250);
  await page.evaluate(() => {
    document.querySelector('.sheet-mask')?.click();
    document.querySelector('.dialog-mask')?.click();
  });
  await sleep(150);
}

function throwawayGroupDump(name) {
  const head = [...document.querySelectorAll('#session-list .workspace-head')]
    .find((node) => (node.querySelector('b')?.textContent || '').includes(name));
  const rows = [];
  let row = head?.nextElementSibling;
  while (row && !row.classList.contains('workspace-head')) {
    if (row.classList.contains('session-row')) {
      rows.push({
        id: row.dataset.sessionId || '',
        title: row.querySelector('.session b')?.textContent || '',
        child: row.classList.contains('session-child'),
      });
    }
    row = row.nextElementSibling;
  }
  return { headTitle: head?.querySelector('b')?.textContent || '', rows };
}

async function clickWorkspaceMore(page, name) {
  await dismissOverlays(page);
  await openDrawer(page);
  const opened = await page.evaluate((want) => {
    const head = [...document.querySelectorAll('#session-list .workspace-head')]
      .find((node) => (node.querySelector('b')?.textContent || '').includes(want));
    head?.querySelector('[aria-label="工作区操作"]')?.click();
    return head?.querySelector('b')?.textContent || '';
  }, name);
  assert(opened, `workspace ⋯ missing: ${name}`);
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').length > 0, 'workspace menu', 5_000);
  return opened;
}

async function clickSessionMore(page, sessionId) {
  await dismissOverlays(page);
  await openDrawer(page);
  const opened = await page.evaluate((id) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .find((node) => node.dataset.sessionId === id);
    row?.querySelector('.session-more')?.click();
    return Boolean(row);
  }, sessionId);
  assert(opened, `session ⋯ missing: ${sessionId}`);
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').length > 0, 'session menu', 5_000);
}

async function clickDialogButton(page, label) {
  const hit = await page.evaluate((want) => {
    const node = [...document.querySelectorAll('.dialog button')].find((btn) => (btn.textContent || '').trim() === want);
    node?.click();
    return Boolean(node);
  }, label);
  assert(hit, `dialog button missing: ${label}`);
  await sleep(600);
}

async function unlistHeadsMatching(page, matcher) {
  await dismissOverlays(page);
  await openDrawer(page);
  const titles = await page.evaluate(() => [...document.querySelectorAll('#session-list .workspace-head b')].map((n) => n.textContent || ''));
  for (const title of titles.filter((t) => matcher.test(t))) {
    if (PROTECTED_HEADS.test(title)) continue;
    await clickWorkspaceMore(page, title);
    await clickSheet(page, '从列表移除', { exact: true });
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'unlist confirm', 8_000);
    await clickDialogButton(page, '移除');
    await sleep(400);
  }
}

async function clickSheet(page, label, { exact = false } = {}) {
  const hit = await page.evaluate((want, exactMatch) => {
    const items = [...document.querySelectorAll('#sheet-root .sheet-item, #sheet-root .primary-btn, #sheet-root .ghost-btn, #session-list .session-list-action')];
    const matches = items.filter((item) => {
      const title = item.querySelector('.sheet-item-main > span:first-child')?.textContent
        || (item.textContent || '').trim();
      return exactMatch ? title === want : title === want || (item.textContent || '').includes(want);
    });
    const node = exactMatch
      ? (matches.find((item) => !item.querySelector('.sheet-hint')) || matches[matches.length - 1])
      : matches[0];
    if (!node) return false;
    node.click();
    return true;
  }, label, exact);
  assert(hit, `sheet item missing: ${label}`);
  await sleep(400);
}

async function clickNewSession(page) {
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'new session sheet', 8_000);
}

async function fillDialog(page, value) {
  try {
    await waitFor(page, () => Boolean(document.querySelector('.dialog input.paste')), 'named dialog', 8_000);
  } catch (error) {
    const extra = await page.evaluate(() => ({
      dialogs: document.querySelectorAll('.dialog').length,
      sheet: (document.querySelector('.sheet')?.textContent || '').slice(0, 240),
    }));
    throw new Error(`${error.message} ${JSON.stringify(extra)}`);
  }
  await page.evaluate((text) => {
    const input = document.querySelector('.dialog input.paste');
    if (!input) return;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.evaluate(() => document.querySelector('.dialog .primary-btn')?.click());
  await sleep(800);
}

async function sendAndIdle(page, text, timeout = 180_000) {
  const before = await page.evaluate(() => document.querySelectorAll('#log .assistant').length);
  await page.click('#draft');
  await page.evaluate(() => {
    const draft = document.querySelector('#draft');
    if (draft) draft.value = '';
  });
  await page.type('#draft', text);
  await page.click('#send-btn');
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const view = await page.evaluate((prev) => {
      const allow = [...document.querySelectorAll('#approval-actions button')]
        .find((btn) => (btn.textContent || '').includes('允许一次'));
      if (allow) allow.click();
      const assistants = [...document.querySelectorAll('#log .assistant')].map((n) => n.textContent || '');
      return {
        banner: document.querySelector('#banner')?.textContent || '',
        log: document.querySelector('#log')?.textContent || '',
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
        assistants,
        lastAssistant: assistants[assistants.length - 1] || '',
        gained: assistants.length > prev,
      };
    }, before);
    if (/无法|失败|host HTTP|typert|只读|断开/i.test(view.banner)) {
      throw new Error(view.banner);
    }
    if (view.gained && view.lastAssistant.trim() && !view.stop && !view.approval) {
      await sleep(800);
      const settled = await page.evaluate(() => ({
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
      }));
      if (!settled.stop && !settled.approval) return view;
    }
    await sleep(400);
  }
  throw new Error(`idle timeout after send: ${text.slice(0, 24)}`);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), `missing browser at ${CHROME}`);
  assert(await portOpen(3080), 'dsh web is not on 127.0.0.1:3080');
  assert(await portOpen(3180), 'LAN SPA is not on 127.0.0.1:3180');
  assert(await portOpen(6767), 'Electron daemon is not on :6767');

  const url = await pairingUrl();
  console.log(`[lan-ab] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

  let createdFolderPath = '';
  let s09Title = '';
  let s09SessionId = '';
  let forkedTitle = '';

  try {
    await check('M0-pair', async () => {
      const parsed = new URL(url);
      await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const appSrc = await page.evaluate(() => document.querySelector('script[type="module"]')?.src || '');
      assert(/20260901-review-fix3/.test(appSrc), `stale app.js: ${appSrc}`);
      await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'landing paste', 10_000);
      await page.evaluate((offerUrl) => {
        const input = document.querySelector('#paste');
        if (input) input.value = offerUrl;
        document.querySelector('#paste-enter')?.click();
      }, url);
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
          || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
        'chat or connect error',
        90_000,
      );
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        error: document.querySelector('#connect-error')?.textContent || '',
      }));
      if (view.error && !view.chat) throw new Error(view.error);
      assert(view.chat, JSON.stringify(view));
    });
    await shot('ab-00-paired');
    try {
      await unlistHeadsMatching(page, THROWAY_HEAD);
    } catch {
      // leftover throwaways only
    }

    let grouped;
    await check('TC-MREM-201/203 D=P grouped', async () => {
      grouped = await openDrawer(page);
      dumps.grouped = grouped;
      assert(!/无法加载/.test(grouped.foot), grouped.banner || grouped.foot.slice(0, 160));
      assert(grouped.heads.length > 0, 'heads=0; drawer is flat');
      assert(grouped.sessions.length > 0, 'P is empty (workspace heads do not count)');
      assert(grouped.heads.every((head) => head.title && head.add && head.more), JSON.stringify(grouped.heads));
      assert(!grouped.more, '假分页 加载更多');
      assert(grouped.sessions.every((row) => row.title && row.title !== '新会话'), `blank leaked: ${grouped.sessions.map((r) => r.title).join('|')}`);
    });
    await shot('ab-01-drawer-grouped');

    await check('TC-MREM-204/206 flat equals grouped set', async () => {
      await clickSheet(page, '一个列表');
      const flat = await page.evaluate(drawerDump);
      dumps.flat = flat;
      const groupedIds = grouped.sessions.map((row) => row.id).filter(Boolean).sort();
      const flatIds = flat.sessions.map((row) => row.id).filter(Boolean).sort();
      assert(JSON.stringify(groupedIds) === JSON.stringify(flatIds), `grouped=${groupedIds.join(',')} flat=${flatIds.join(',')}`);
      await clickSheet(page, '按工作区分组');
    });
    await shot('ab-02-drawer-flat');

    await check('TC-MREM-209 live menu has no delete', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      const opened = await page.evaluate(() => {
        const row = document.querySelector('#session-list .session-row:not(.workspace-head) .session-more');
        row?.click();
        return Boolean(row);
      });
      assert(opened, 'no live ⋯');
      await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').length > 0, 'session menu', 5_000);
      const labels = await page.evaluate(() => [...document.querySelectorAll('.sheet-item')].map((n) => n.textContent));
      dumps.liveMenu = labels;
      assert(labels.some((t) => t.includes('重命名')), labels.join('|'));
      assert(labels.some((t) => t.includes('Fork')), labels.join('|'));
      assert(labels.some((t) => t.includes('归档')), labels.join('|'));
      assert(!labels.some((t) => t.includes('删除') && !t.includes('归档')), `delete on live: ${labels.join('|')}`);
      await dismissOverlays(page);
    });

    await check('TC-MREM-207 subagent readonly', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      const child = await page.evaluate(() => {
        const row = document.querySelector('#session-list .session-child');
        if (!row) return null;
        return {
          id: row.dataset.sessionId || '',
          title: row.querySelector('.session b')?.textContent || '',
        };
      });
      if (!child?.id) return { blocked: 'no .session-child in drawer' };
      await page.evaluate((id) => {
        const row = [...document.querySelectorAll('#session-list .session-child')]
          .find((node) => node.dataset.sessionId === id);
        row?.querySelector('.session')?.click();
      }, child.id);
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        'opened child session',
        10_000,
      );
      await closeDrawer(page);
      await waitFor(
        page,
        () => {
          const note = document.querySelector('#readonly-note');
          const form = document.querySelector('#composer');
          return Boolean(note) && !note.classList.contains('hidden') && Boolean(form?.classList.contains('hidden'));
        },
        'readonly composer',
        8_000,
      );
      const view = await page.evaluate(() => ({
        note: document.querySelector('#readonly-note')?.textContent || '',
        composerHidden: document.querySelector('#composer')?.classList.contains('hidden'),
        sendVisible: document.querySelector('#send-btn')
          && !document.querySelector('#send-btn').classList.contains('hidden')
          && !document.querySelector('#composer')?.classList.contains('hidden'),
      }));
      dumps.subagent = view;
      assert(view.composerHidden && !view.sendVisible, `send still visible: ${JSON.stringify(view)}`);
      assert(/子智能体/.test(view.note), view.note);
    });

    await check('TC-MREM-401 existing workspace', async () => {
      await clickNewSession(page);
      const choices = await page.evaluate(() => [...document.querySelectorAll('.sheet-item')].map((n) => n.textContent));
      dumps.newSessionChoices = choices;
      const pick = choices.find((t) => t && !t.includes('无工作区') && !t.includes('浏览') && !t.includes('预设'));
      assert(pick, `no existing workspace: ${choices.join('|')}`);
      await clickSheet(page, pick.slice(0, 12));
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        'opened created session',
        20_000,
      );
    });

    await check('TC-MREM-402/406 no-folder + presets from list', async () => {
      await clickNewSession(page);
      const body = await page.evaluate(() => ({
        items: [...document.querySelectorAll('.sheet-item')].map((n) => n.textContent),
        prompt: Boolean(window.prompt.toString && window.prompt.toString().includes('[native')),
      }));
      dumps.presets = body.items.filter((t) => t.includes('预设 ·'));
      assert(body.items.some((t) => t.includes('无工作区文件夹')), body.items.join('|'));
      await clickSheet(page, '无工作区文件夹', { exact: true });
      await waitFor(page, () => !document.querySelector('.sheet-title'), 'sheet closed', 8_000);
    });

    await check('TC-MREM-403/404/S09 browse + mkdir + workspace', async () => {
      await clickNewSession(page);
      await clickSheet(page, '浏览本机目录…', { exact: true });
      await waitFor(
        page,
        () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
          && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
        'browse listing',
        20_000,
      );
      const browse = await page.evaluate(() => ({
        title: document.querySelector('.sheet-title')?.textContent || '',
        items: [...document.querySelectorAll('.sheet-item')].map((n) => n.textContent),
        note: document.querySelector('.sheet-note')?.textContent || '',
      }));
      dumps.browse = browse;
      assert(!/请在电脑上选|host\.pickDirectory|系统选/.test(JSON.stringify(browse)), JSON.stringify(browse).slice(0, 240));
      assert(!/无法|失败|host HTTP 404/.test(browse.note), browse.note);
      await clickSheet(page, '新建文件夹', { exact: true });
      await fillDialog(page, FOLDER_NAME);
      await waitFor(
        page,
        (name) => {
          const hint = [...document.querySelectorAll('.sheet-item')]
            .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区')
            ?.querySelector('.sheet-hint')?.textContent || '';
          return hint.includes(name);
        },
        `browse landed in ${FOLDER_NAME}`,
        15_000,
        FOLDER_NAME,
      );
      createdFolderPath = await page.evaluate(() => {
        const hint = [...document.querySelectorAll('.sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
        return hint?.querySelector('.sheet-hint')?.textContent || '';
      });
      assert(createdFolderPath.includes(FOLDER_NAME), `createDirectory landed on ${createdFolderPath}`);
      await writeFile(path.join(createdFolderPath, 'README.md'), 'dshd-qa 临时工作区\n', 'utf8');
      await clickSheet(page, '使用此目录作为工作区', { exact: true });
      await waitFor(
        page,
        () => !document.querySelector('.sheet-title')
          || Boolean(document.querySelector('.sheet-error')?.textContent),
        'workspace create settled',
        25_000,
      );
      const err = await page.evaluate(() => document.querySelector('.sheet-error')?.textContent || '');
      assert(!err, err);
      await openDrawer(page);
      await waitFor(
        page,
        (name) => [...document.querySelectorAll('#session-list .workspace-head b')]
          .some((node) => (node.textContent || '').includes(name)),
        'new workspace head',
        20_000,
        FOLDER_NAME,
      );
      const after = await openDrawer(page);
      dumps.afterCreate = after;
      dumps.createdFolderPath = createdFolderPath;
      assert(after.heads.some((head) => head.title.includes(FOLDER_NAME)), `new workspace missing: ${after.heads.map((h) => h.title).join('|')} path=${createdFolderPath}`);
      s09SessionId = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      dumps.createdSessionId = s09SessionId;
      const created = after.sessions.find((row) => row.id === s09SessionId)
        || after.sessions.find((row) => after.heads.some((head) => head.title.includes(FOLDER_NAME)));
      s09Title = created?.title || after.sessions[0]?.title || '';
      await shot('ab-10-s09-workspace');
    });

    await check('TC-MREM-308 rename throwaway workspace', async () => {
      const renamed = `${FOLDER_NAME}-renamed`;
      await clickWorkspaceMore(page, FOLDER_NAME);
      await clickSheet(page, '重命名工作区');
      await fillDialog(page, renamed);
      await sleep(600);
      const after = await openDrawer(page);
      dumps.renamed = after.heads.map((h) => h.title);
      assert(after.heads.some((head) => head.title === renamed), `rename missing: ${dumps.renamed.join('|')}`);
    });

    await check('TC-MREM-S09 five rounds on the new session', async () => {
      await closeDrawer(page);
      const open = await page.evaluate(() => !document.querySelector('#screen-chat')?.classList.contains('hidden'));
      assert(open, 'create did not leave the new session open');
      await page.click('#model-chip');
      await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model pane', 8_000);
      await waitFor(
        page,
        () => [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6/i.test(n.textContent || ''))
          || /读取模型失败/.test(document.querySelector('#options')?.textContent || ''),
        'model rows',
        15_000,
      );
      const switched = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#options .sheet-item')]
          .find((n) => /grok-4\.6/i.test(n.textContent || '') && /Ayase/i.test(n.textContent || ''));
        (row || [...document.querySelectorAll('#options .sheet-item')].find((n) => /grok-4\.6/i.test(n.textContent || '')))?.click();
        return Boolean(row || [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6/i.test(n.textContent || '')));
      });
      await sleep(600);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
      assert(switched, 'S09 requires grok-4.6 in session.models');
      const logs = [];
      for (let i = 0; i < ROUNDS.length; i += 1) {
        const view = await sendAndIdle(page, ROUNDS[i]);
        logs.push({ round: i + 1, assistant: view.lastAssistant, excerpt: view.log.slice(-400) });
        await shot(`ab-s09-round-${i + 1}`);
      }
      dumps.s09 = logs;
      const code = (logs[0]?.assistant || '').match(/\b(\d{3})\b/)?.[1];
      assert(code, `round 1 no 3-digit code: ${(logs[0]?.assistant || '').slice(0, 160)}`);
      assert((logs[1]?.assistant || '').includes(code), `round 2 assistant != ${code}: ${(logs[1]?.assistant || '').slice(0, 80)}`);
      assert(/README|产品|临时工作区|dshd-qa/i.test(logs[2]?.assistant || ''), `round 3 unread README: ${(logs[2]?.assistant || '').slice(0, 160)}`);
      assert((logs[3]?.assistant || '').includes(FOLDER_NAME), `round 4 missing folder name: ${(logs[3]?.assistant || '').slice(0, 160)}`);
      assert((logs[4]?.assistant || '').includes(code), `round 5 missing code: ${(logs[4]?.assistant || '').slice(0, 160)}`);
      s09SessionId = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '')
        || s09SessionId;
      dumps.s09SessionId = s09SessionId;
    });

    await check('TC-MREM-303/304/305/306 fork then archive/delete only the fork', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate((name) => {
        const head = [...document.querySelectorAll('#session-list .workspace-head')]
          .find((node) => (node.querySelector('b')?.textContent || '').includes(name));
        const next = head?.nextElementSibling;
        if (head && (!next || next.classList.contains('workspace-head'))) {
          head.querySelector('.session')?.click();
        }
      }, FOLDER_NAME);
      await sleep(350);
      const live = await page.evaluate(drawerDump);
      const group = await page.evaluate(throwawayGroupDump, FOLDER_NAME);
      const activeId = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId
        || document.querySelector('#session-list .session.active')?.closest('.session-row')?.dataset.sessionId
        || '');
      dumps.beforeFork = { group, activeId, s09SessionId, liveTitles: live.sessions.map((row) => `${row.id}:${row.title}`) };
      const parentId = group.rows.find((row) => row.id && !row.child)?.id || activeId || s09SessionId;
      assert(parentId, `no throwaway session to fork: ${JSON.stringify(dumps.beforeFork)}`);
      const beforeIds = new Set(live.sessions.map((row) => row.id).filter(Boolean));
      await clickSessionMore(page, parentId);
      await clickSheet(page, 'Fork', { exact: true });
      await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'fork sheet closed', 10_000);
      await openDrawer(page);
      await waitFor(
        page,
        (known) => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
          .some((row) => row.dataset.sessionId && !known.includes(row.dataset.sessionId)),
        'forked live row',
        15_000,
        [...beforeIds],
      );
      const afterLive = await page.evaluate(drawerDump);
      dumps.fork = afterLive;
      const forked = afterLive.sessions.find((row) => row.id && !beforeIds.has(row.id));
      assert(forked?.id, `fork missing: before=${[...beforeIds].join(',')} after=${afterLive.sessions.map((r) => r.id).join(',')}`);
      assert(afterLive.sessions.some((row) => row.id === parentId), 'parent disappeared after fork');
      forkedTitle = forked.title;

      await clickSessionMore(page, forked.id);
      await clickSheet(page, '归档', { exact: true });
      await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'archive confirm', 8_000);
      await clickDialogButton(page, '归档');
      await waitFor(
        page,
        (id) => ![...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
          .some((row) => row.dataset.sessionId === id),
        'fork left live list',
        10_000,
        forked.id,
      );

      await dismissOverlays(page);
      await openDrawer(page);
      await clickSheet(page, '已归档会话');
      await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history sheet', 8_000);
      const archived = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => ({
        title: n.querySelector('.sheet-item-main > span:first-child')?.textContent || (n.textContent || '').trim(),
        text: n.textContent || '',
      })));
      dumps.archived = archived;
      assert(
        archived.some((item) => item.title === forked.title && !item.title.startsWith('删除')),
        `fork not in archived: ${archived.map((i) => i.title).join('|')}`,
      );

      await page.evaluate((want) => {
        const item = [...document.querySelectorAll('#sheet-root .sheet-item')].find((n) => {
          const title = n.querySelector('.sheet-item-main > span:first-child')?.textContent || '';
          return title === want && !(n.textContent || '').includes('删除「');
        });
        item?.click();
      }, forked.title);
      await waitFor(
        page,
        (want) => {
          const titles = [...document.querySelectorAll('#sheet-root .sheet-item-main > span:first-child')]
            .map((node) => node.textContent || '');
          return !titles.includes(want)
            || Boolean(document.querySelector('#sheet-root .sheet-error')?.textContent);
        },
        'fork left archived sheet',
        12_000,
        forked.title,
      );
      const histErr = await page.evaluate(() => document.querySelector('#sheet-root .sheet-error')?.textContent || '');
      assert(!histErr, histErr);
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate((name) => {
        const head = [...document.querySelectorAll('#session-list .workspace-head')]
          .find((node) => (node.querySelector('b')?.textContent || '').includes(name));
        const next = head?.nextElementSibling;
        if (head && (!next || next.classList.contains('workspace-head'))) {
          head.querySelector('.session')?.click();
        }
      }, FOLDER_NAME);
      await waitFor(
        page,
        (id) => [...document.querySelectorAll('#session-list .session-row')].some((row) => row.dataset.sessionId === id),
        'unarchived live row',
        12_000,
        forked.id,
      );
      const afterUnarchive = await page.evaluate(drawerDump);
      dumps.afterUnarchive = afterUnarchive.sessions.map((row) => row.id);
      assert(afterUnarchive.sessions.some((row) => row.id === forked.id), `unarchive missing fork ${forked.id}`);

      await clickSessionMore(page, forked.id);
      await clickSheet(page, '归档', { exact: true });
      await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 're-archive confirm', 8_000);
      await clickDialogButton(page, '归档');
      await sleep(700);
      await dismissOverlays(page);
      await openDrawer(page);
      await clickSheet(page, '已归档会话');
      await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history for delete', 8_000);
      await clickSheet(page, `删除「${forked.title}」`);
      await waitFor(page, () => /不可恢复/.test(document.querySelector('.dialog')?.textContent || ''), 'delete confirm', 8_000);
      await clickDialogButton(page, '删除');
      await sleep(800);
      await dismissOverlays(page);
      await openDrawer(page);
      const afterDelete = await page.evaluate(drawerDump);
      dumps.afterDelete = afterDelete.sessions.map((row) => row.id);
      assert(!afterDelete.sessions.some((row) => row.id === forked.id), 'deleted fork still live');
      await clickSheet(page, '已归档会话');
      await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history after delete', 8_000);
      const leftover = await page.evaluate(
        (want) => [...document.querySelectorAll('#sheet-root .sheet-item')].some((n) => (n.textContent || '').includes(want)),
        forked.title,
      );
      assert(!leftover, `deleted fork still in archived: ${forked.title}`);
      await dismissOverlays(page);
    });

    await check('TC-MREM-307 move inside throwaway', async () => {
      await dismissOverlays(page);
      const after = await openDrawer(page);
      const head = after.heads.find((h) => h.title.includes(FOLDER_NAME));
      assert(head, 'throwaway workspace gone before move');
    });

    await check('TC-MREM-308 unlist throwaway only', async () => {
      const opened = await clickWorkspaceMore(page, FOLDER_NAME);
      assert(!PROTECTED_HEADS.test(opened), `refusing to unlist protected workspace: ${opened}`);
      await waitFor(
        page,
        (name) => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes(name),
        'workspace menu title',
        5_000,
        FOLDER_NAME,
      );
      const menu = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent || ''));
      dumps.unlistMenu = menu;
      assert(menu.some((t) => t.includes('从列表移除')), `workspace menu missing unlist: ${menu.join('|')}`);
      assert(!menu.some((t) => t.includes('Fork')), `unlist clicked a session menu: ${menu.join('|')}`);
      await clickSheet(page, '从列表移除', { exact: true });
      await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'unlist confirm', 8_000);
      const confirm = await page.evaluate(() => document.querySelector('.dialog')?.textContent || '');
      dumps.unlistConfirm = confirm;
      assert(/移除/.test(confirm) && !/归档「/.test(confirm), confirm.slice(0, 160));
      await clickDialogButton(page, '移除');
      try {
        await waitFor(
          page,
          (name) => ![...document.querySelectorAll('#session-list .workspace-head b')]
            .some((node) => (node.textContent || '').includes(name)),
          'throwaway head gone',
          12_000,
          FOLDER_NAME,
        );
      } catch (error) {
        dumps.unlistDialog = await page.evaluate(() => document.querySelector('.dialog')?.textContent || '');
        throw error;
      }
      const after = await openDrawer(page);
      dumps.afterUnlist = after.heads.map((h) => h.title);
      assert(!after.heads.some((h) => h.title.includes(FOLDER_NAME)), `unlist failed: ${dumps.afterUnlist.join('|')}`);
      assert(after.heads.every((h) => !THROWAY_HEAD.test(h.title)), `leftover throwaway heads: ${dumps.afterUnlist.join('|')}`);
    });
    await shot('ab-90-unlisted');
  } finally {
    try {
      await unlistHeadsMatching(page, THROWAY_HEAD);
    } catch {
      // cleanup is best-effort; never trash user workspaces
    }
    await writeFile(path.join(SHOT_DIR, 'ab-dump.json'), `${JSON.stringify(dumps, null, 2)}\n`, 'utf8');
    await browser.close().catch(() => {});
    await writeFile(path.join(SHOT_DIR, 'ab-report.txt'), `${results.join('\n')}\n`, 'utf8');
  }

  console.log(`\n${results.length} checks, ${failures} failed. shots ${SHOT_DIR}`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
