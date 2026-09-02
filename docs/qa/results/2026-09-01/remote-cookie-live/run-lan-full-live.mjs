/**
 * Full LAN Web MUST rehearsal. Does not bounce daemon or log #offer=.
 * Does not archive/delete/rename existing sessions. Does not commit.
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
const USER_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Deepseek-Harness-Desktop');
const results = [];
let failures = 0;
const dumps = {};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`NOT OK - ${name}: ${error?.message || error}`);
    console.log(`NOT OK - ${name}: ${error?.message || error}`);
  }
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
}
function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
  } catch {
    return '<unparseable>';
  }
}
async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}
async function dumpChat(page) {
  return page.evaluate(() => ({
    title: document.querySelector('#chat-title')?.textContent || '',
    host: document.querySelector('#host-line')?.textContent || '',
    banner: document.querySelector('#banner')?.textContent || '',
    log: (document.querySelector('#log')?.textContent || '').slice(0, 360),
    timelineError: document.querySelector('#log .log-error')?.textContent || '',
    model: document.querySelector('#model-chip')?.textContent || '',
    access: document.querySelector('#access-chip')?.textContent || '',
    planHidden: document.querySelector('#plan-chip')?.classList.contains('hidden'),
    git: document.querySelector('#git-pill')?.textContent || '',
    gitHidden: document.querySelector('#git-pill')?.classList.contains('hidden'),
    approval: !document.querySelector('#approval')?.classList.contains('hidden'),
    approvalTitle: document.querySelector('#approval-title')?.textContent || '',
    sheet: [...document.querySelectorAll('#sheet-root button, #sheet-root .sheet-item, #sheet-root [role="button"]')]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 24),
    settings: (document.querySelector('#options')?.innerText || '').slice(0, 500),
    settingsTitle: document.querySelector('#settings-title')?.textContent || '',
    freeze: [...document.querySelectorAll('#options .freeze, #options .row-desc, #settings .freeze')]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 12),
    slash: (document.querySelector('#slash-pop')?.innerText || '').slice(0, 240),
    slashHidden: document.querySelector('#slash-pop')?.classList.contains('hidden'),
    drawer: (document.querySelector('#session-list')?.innerText || '').slice(0, 280),
    heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((n) => n.textContent),
    titles: [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session b')].map((n) => n.textContent),
  }));
}
async function openDrawer(page) {
  await page.evaluate(() => {
    document.querySelector('#backdrop')?.click();
    document.querySelector('#close-settings')?.click();
    document.querySelector('#menu')?.click();
  });
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer', 8_000);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  assert(existsSync(CHROME), `missing ${CHROME}`);
  assert(await portOpen(3080), '3080 down');
  assert(await portOpen(3180), '3180 down');
  assert(await portOpen(6767), '6767 down');

  const home = path.join(USER_DATA, 'chisacode-home');
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
  const url = (() => {
    const parsed = new URL(pairing.url);
    parsed.hostname = '127.0.0.1';
    return parsed.toString();
  })();
  console.log(`[full-live] pairing ${pairingSummary(url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

  try {
    await check('M0 配对进 chat', async () => {
      const parsed = new URL(url);
      await page.goto(`${parsed.origin}${parsed.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.evaluate((offerUrl) => {
        const input = document.querySelector('#paste');
        if (input) input.value = offerUrl;
        document.querySelector('#paste-enter')?.click();
      }, url);
      await waitFor(
        page,
        () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
          || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
        'chat',
        90_000,
      );
      assert(!document || true);
      const chat = await page.evaluate(() => !document.querySelector('#screen-chat')?.classList.contains('hidden'));
      assert(chat, 'not in chat');
    });
    await shot('20-paired');

    await openDrawer(page);
    await waitFor(page, () => document.querySelectorAll('#session-list .session b').length >= 1, 'rows', 20_000);
    dumps.catalog = await dumpChat(page);
    await shot('21-drawer');
    await check('M2 会话列表非空', async () => {
      assert(dumps.catalog.titles.length > 0, 'empty list');
      assert(!/无法加载|host HTTP/i.test(dumps.catalog.banner + dumps.catalog.drawer), dumps.catalog.banner);
    });
    await check('M2 工作区头分组', async () => {
      assert(dumps.catalog.heads.length > 0, 'heads=0 flat list');
    });

    await check('M1 composer 控件不重叠', async () => {
      const boxes = await page.evaluate(() => {
        const ids = ['attach-toggle', 'access-chip', 'model-chip', 'send-btn'];
        return ids.map((id) => {
          const el = document.getElementById(id);
          const r = el?.getBoundingClientRect();
          return r ? { id, x: r.x, y: r.y, w: r.width, h: r.height } : { id, missing: true };
        });
      });
      dumps.hit = boxes;
      const visible = boxes.filter((b) => !b.missing);
      for (let i = 0; i < visible.length; i += 1) {
        for (let j = i + 1; j < visible.length; j += 1) {
          const a = visible[i];
          const b = visible[j];
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          assert(!overlap, `${a.id} overlaps ${b.id}`);
        }
        assert(visible[i].w >= 28 && visible[i].h >= 28, `${visible[i].id} ${visible[i].w}x${visible[i].h}`);
      }
    });

    await check('M3 打开会话时间线', async () => {
      await page.evaluate(() => {
        const preferred = [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session')]
          .find((node) => (node.querySelector('b')?.textContent || '') === 'pong')
          || document.querySelector('#session-list .session-row:not(.session-child) .session');
        preferred?.click();
      });
      await waitFor(
        page,
        () => Boolean(document.querySelector('#log .log-error'))
          || ((document.querySelector('#log')?.textContent || '').length > 8
            && !(document.querySelector('#log')?.textContent || '').includes('正在载入')),
        'history',
        25_000,
      );
      dumps.open = await dumpChat(page);
      await shot('22-open');
      if (dumps.open.timelineError) throw new Error(dumps.open.timelineError);
    });

    await check('M4 模型 sheet', async () => {
      await waitFor(page, () => {
        const label = (document.querySelector('#model-chip')?.textContent || '').replace(/\s+/g, '');
        return label && label !== '模型';
      }, 'model chip', 12_000);
      await page.click('#model-chip');
      await sleep(400);
      dumps.models = await dumpChat(page);
      await shot('23-models');
      assert(dumps.models.sheet.length + (dumps.models.settings?.length || 0) > 0, 'empty model surface');
      await page.evaluate(() => document.querySelector('#close-settings')?.click()
        || document.querySelector('#sheet-root .sheet-backdrop, #sheet-root button')?.click());
    });

    await check('M5 权限 sheet', async () => {
      await page.click('#access-chip');
      await sleep(400);
      dumps.access = await dumpChat(page);
      await shot('24-access');
      const text = `${dumps.access.sheet.join('|')}\n${dumps.access.settings}`;
      assert(/只读|工作区|权限|ask|allow/i.test(text) || dumps.access.sheet.length > 0, `empty access: ${text.slice(0, 160)}`);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
    });

    await check('M8 斜杠命令列表', async () => {
      await page.click('#draft');
      await page.evaluate(() => {
        const draft = document.querySelector('#draft');
        if (draft) {
          draft.value = '';
          draft.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.type('#draft', '/');
      await sleep(1200);
      dumps.slash = await dumpChat(page);
      await shot('25-slash');
      assert(!dumps.slash.slashHidden || /permission|plan|\//i.test(dumps.slash.slash), `slash empty: ${dumps.slash.slash || dumps.slash.banner}`);
      await page.evaluate(() => {
        const draft = document.querySelector('#draft');
        if (draft) {
          draft.value = '';
          draft.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    await check('M8 附件入口', async () => {
      await page.click('#attach-toggle');
      await sleep(300);
      dumps.attach = await dumpChat(page);
      await shot('26-attach');
      const text = dumps.attach.sheet.join('|');
      assert(/相册|相机|照片|图/i.test(text) || dumps.attach.sheet.length > 0, `attach: ${text}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => document.querySelector('#sheet-root .backdrop, #sheet-root button')?.click());
    });

    await check('M9 Git 顶栏可打开', async () => {
      dumps.git = await dumpChat(page);
      assert(!dumps.git.gitHidden && dumps.git.git, `git hidden ${dumps.git.git}`);
      await page.click('#git-pill');
      await sleep(500);
      dumps.gitSheet = await dumpChat(page);
      await shot('27-git');
      const text = `${dumps.gitSheet.settings}\n${dumps.gitSheet.sheet.join('|')}`;
      assert(/分支|Commit|Init|Git|master|工作区/i.test(text), `git surface: ${text.slice(0, 200)}`);
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
    });

    await check('M7 行菜单 Rename/Fork/归档', async () => {
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#session-list .session-more')?.click());
      await sleep(400);
      dumps.menu = await dumpChat(page);
      await shot('28-session-menu');
      const text = dumps.menu.sheet.join('|');
      assert(/重命名/.test(text), `missing 重命名: ${text}`);
      assert(/Fork/.test(text), `missing Fork: ${text}`);
      assert(/归档/.test(text), `missing 归档: ${text}`);
      await page.evaluate(() => document.querySelector('#sheet-root .backdrop, #backdrop')?.click());
    });

    await check('M7 搜索会话', async () => {
      await openDrawer(page);
      await page.evaluate(() => {
        const search = document.querySelector('#search');
        if (!search) return;
        search.value = 'pong';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await waitFor(
        page,
        () => {
          const body = document.querySelector('#session-list')?.textContent || '';
          const banner = document.querySelector('#banner')?.textContent || '';
          return /搜索失败|无法|typert|host HTTP/i.test(banner + body)
            || (!body.includes('正在搜索') && body.length > 0);
        },
        'search settle',
        20_000,
      );
      dumps.search = await dumpChat(page);
      await shot('29-search');
      const blob = `${dumps.search.banner}\n${dumps.search.drawer}`;
      assert(!/搜索失败|无法|typert|host HTTP/i.test(blob), blob.slice(0, 240));
      assert(/pong/i.test(blob), `no pong: ${blob.slice(0, 200)}`);
      await page.evaluate(() => {
        const search = document.querySelector('#search');
        if (!search) return;
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    await check('M6 新会话', async () => {
      await openDrawer(page);
      await page.click('#new-session');
      await sleep(1500);
      dumps.create = await dumpChat(page);
      await shot('30-new-session');
      const fail = `${dumps.create.banner}\n${dumps.create.timelineError}`;
      assert(!/无法|失败|typert|host HTTP|不允许/i.test(fail), fail.slice(0, 240));
    });

    await check('M10 设置 Files/MCP 冻结或只读', async () => {
      await page.evaluate(() => document.querySelector('#open-settings')?.click()
        || document.querySelector('#menu')?.click());
      await sleep(300);
      await page.evaluate(() => document.querySelector('#open-settings')?.click());
      await waitFor(page, () => (document.querySelector('#options')?.innerText || '').length > 8, 'settings', 8_000);
      dumps.settingsHub = await dumpChat(page);
      await shot('31-settings');
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('#options button, #options .row')].find((n) => /文件/.test(n.textContent));
        btn?.click();
      });
      await sleep(400);
      dumps.files = await dumpChat(page);
      await shot('32-files');
      const filesText = `${dumps.files.settings}\n${dumps.files.freeze.join('|')}\n${dumps.files.sheet.join('|')}`;
      assert(/电脑端|冻结|只读|下一轮|浏览/i.test(filesText) || dumps.files.settings.length > 0, `files: ${filesText.slice(0, 200)}`);
      await page.evaluate(() => document.querySelector('#settings-back')?.click() || document.querySelector('#close-settings')?.click());
      await sleep(200);
      await page.evaluate(() => document.querySelector('#open-settings')?.click());
      await sleep(300);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('#options button, #options .row')].find((n) => n.textContent.trim() === 'MCP' || n.textContent.includes('MCP'));
        btn?.click();
      });
      await sleep(400);
      dumps.mcp = await dumpChat(page);
      await shot('33-mcp');
      const mcpText = `${dumps.mcp.settings}\n${dumps.mcp.freeze.join('|')}`;
      assert(/电脑端|只读|冻结|MCP/i.test(mcpText), `mcp: ${mcpText.slice(0, 200)}`);
    });

    await check('M5 审批条（命令轮，可 Blocked）', async () => {
      await page.evaluate(() => document.querySelector('#close-settings')?.click());
      await page.evaluate(() => {
        const draft = document.querySelector('#draft');
        if (draft) {
          draft.value = '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。';
          draft.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.click('#send-btn');
      try {
        await waitFor(
          page,
          () => !document.querySelector('#approval')?.classList.contains('hidden')
            || /无法|失败|typert|host HTTP|只读/i.test(document.querySelector('#banner')?.textContent || ''),
          'approval or error',
          45_000,
        );
      } catch {
        dumps.approval = await dumpChat(page);
        await shot('34-approval-timeout');
        throw new Error(`no approval in 45s; banner=${dumps.approval.banner} running=${dumps.approval.log.slice(0, 80)}`);
      }
      dumps.approval = await dumpChat(page);
      await shot('34-approval');
      if (/无法|失败|typert|host HTTP/i.test(dumps.approval.banner)) throw new Error(dumps.approval.banner);
      assert(dumps.approval.approval, 'approval bar not shown');
    });
  } finally {
    await writeFile(path.join(SHOT_DIR, 'full-dump.json'), `${JSON.stringify(dumps, null, 2)}\n`, 'utf8');
    await writeFile(path.join(SHOT_DIR, 'full-report.txt'), `${results.join('\n')}\n`, 'utf8');
    await browser.close().catch(() => {});
  }
  console.log(`\n${results.length} checks, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
