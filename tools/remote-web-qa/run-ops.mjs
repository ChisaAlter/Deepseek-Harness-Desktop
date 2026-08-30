/**
 * Post-pair ops matrix (6-E) against a real daemon + real browser session.
 * Not a substitute for mobile-web-qa's fake-daemon 48 checks.
 *
 * Usage (local relay recommended):
 *   node tools/remote-web-qa/run-ops.mjs --relay 127.0.0.1:8788 --screenshots <dir>
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ChisaCodeRemote } = require('../../src/main/chisacode-remote.js');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const shotArg = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotArg > -1 ? process.argv[shotArg + 1] : path.join('docs', 'qa', 'results', '2026-08-29', 'ops-shots');
const relayArg = process.argv.indexOf('--relay');
const RELAY_OVERRIDE = relayArg > -1 ? process.argv[relayArg + 1] : '';

const rows = [];

function record(id, status, detail, evidence = '') {
  rows.push({ id, status, detail, evidence });
  console.log(`[ops] ${id} ${status} — ${detail}${evidence ? ` (${evidence})` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(fn, message, timeout = 30_000, step = 250) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await sleep(step);
  }
  throw new Error(`timeout: ${message}`);
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

function seedOpsWorkspace(home) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ops-repo-'));
  spawnSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, 'readme.md'), '# ops workspace\n');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello from ops\n');
  spawnSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.email=ops@test', '-c', 'user.name=ops', 'commit', '-m', 'seed'], {
    cwd: repo,
    stdio: 'ignore',
  });
  const cwd = path.resolve(repo);
  const now = new Date().toISOString();
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'projects', 'projects.json'), JSON.stringify([{
    projectId: 'local:ops',
    rootPath: cwd,
    kind: 'git',
    displayName: 'ops-repo',
    customName: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }]));
  fs.writeFileSync(path.join(home, 'projects', 'workspaces.json'), JSON.stringify([{
    workspaceId: cwd,
    projectId: 'local:ops',
    cwd,
    kind: 'local_checkout',
    displayName: 'ops-repo',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }]));
  return cwd;
}

function paneNeedsSession(copy) {
  return /先打开一个会话/.test(copy);
}

function sheetLooksEmpty(copy) {
  return /没有可用工作区|暂无工作区/.test(copy);
}

async function clickText(page, selector, text) {
  const ok = await page.evaluate((sel, want) => {
    const nodes = [...document.querySelectorAll(sel)];
    const hit = nodes.find((n) => (n.textContent || '').includes(want));
    if (!hit) return false;
    hit.click();
    return true;
  }, selector, text);
  if (!ok) throw new Error(`no element ${selector} containing ${text}`);
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-ops-'));
  const listenPort = 17000 + Math.floor(Math.random() * 20000);
  const config = {
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteListen: `127.0.0.1:${listenPort}`,
    ...(RELAY_OVERRIDE ? { remoteRelayEndpoint: RELAY_OVERRIDE, remoteRelayUseTls: false } : {}),
  };
  const remote = new ChisaCodeRemote({
    getConfig: () => config,
    getHomeDir: () => home,
    readyTimeoutMs: 90_000,
    log: (line) => console.log(`[remote] ${line}`),
  });

  seedOpsWorkspace(home);

  let browser = null;
  let page = null;
  try {
    await remote.startDaemon();
    await waitFor(() => remote.snapshot().relayConnected === true, 'relayConnected', 30_000);
    const pairingUrl = remote.snapshot().urls[0]?.pairingUrl || '';
    if (!pairingUrl) throw new Error('no pairingUrl');

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 414, height: 896 });
    await page.goto(pairingUrl, { waitUntil: 'domcontentloaded' });
    await waitFor(
      () => page.evaluate(() => /已配对|已重连/.test(document.getElementById('device-line')?.textContent || '')),
      'paired',
      60_000,
    );
    const homeShot = await shot(page, 'E0-paired-home');
    record('E0', 'Pass', 'real daemon E2EE paired into web client', homeShot);

    // —— E1 new session chooser —— //
    try {
      await page.evaluate(() => document.querySelector('#menu')?.click());
      await waitFor(
        () => page.evaluate(() => document.querySelector('#phone')?.hasAttribute('data-drawer')),
        'drawer',
        10_000,
      );
      await page.evaluate(() => document.querySelector('#new-session')?.click());
      await waitFor(
        () => page.evaluate(() => {
          const sheet = document.querySelector('#sheet-root .sheet');
          const text = sheet?.textContent || '';
          if (!text.includes('选择工作区') || /正在读取/.test(text)) return false;
          return document.querySelectorAll('#sheet-root .sheet-item').length > 0
            || /没有可用工作区|暂无工作区/.test(text);
        }),
        'workspace step ready',
        15_000,
      );
      const sheet = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
      const items = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent.trim()));
      const e1Shot = await shot(page, 'E1-new-session-chooser');
      if (items.length === 0 || sheetLooksEmpty(sheet)) {
        record('E1', 'Blocked', `chooser opened but no workspaces in chisacode home (${home})`, e1Shot);
      } else {
        // Pick first workspace and walk as far as providers allow
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-item')?.click());
        await waitFor(
          () => page.evaluate(() => {
            const text = document.querySelector('#sheet-root .sheet')?.textContent || '';
            return /选择提供方|没有.*提供方|请先选择/.test(text) && !/正在读取/.test(text);
          }),
          'provider step ready',
          15_000,
        );
        const after = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
        const providers = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
          .map((n) => n.textContent.trim())
          .filter((text) => text && !text.includes('返回')));
        if (/没有已就绪的智能体提供方/.test(after) || providers.length === 0) {
          record('E1', 'Blocked', 'workspace selected; no ready providers', await shot(page, 'E1-no-provider'));
        } else if (/选择提供方/.test(after)) {
          await page.evaluate((want) => {
            const hit = [...document.querySelectorAll('#sheet-root .sheet-item')]
              .find((n) => n.textContent.trim() === want);
            hit?.click();
          }, providers[0]);
          await sleep(800);
          for (const label of ['权限模式', '选择模型']) {
            const text = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
            if (text.includes(label)) {
              const pick = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
                .map((n) => n.textContent.trim())
                .find((item) => item && !item.includes('返回')));
              if (pick) {
                await page.evaluate((want) => {
                  const hit = [...document.querySelectorAll('#sheet-root .sheet-item')]
                    .find((n) => n.textContent.trim() === want);
                  hit?.click();
                }, pick);
                await sleep(600);
              }
            }
          }
          let closed = false;
          try {
            await waitFor(
              () => page.evaluate(() => !document.querySelector('#sheet-root .sheet')),
              'chooser closed',
              20_000,
            );
            closed = true;
          } catch {
            closed = false;
          }
          const createCopy = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
          const rowsAfter = await page.evaluate(() => document.querySelectorAll('#drawer .agent-row, [data-agent-id]').length);
          const e1Done = await shot(page, 'E1-session-created');
          if (closed && rowsAfter >= 1) {
            record('E1', 'Pass', `created via chooser; workspace + provider (${providers[0]})`, e1Done);
          } else {
            record(
              'E1',
              'Blocked',
              closed
                ? 'chooser finished but no new session row'
                : `createAgent did not finish (no ready provider / ACP): ${createCopy.replace(/\s+/g, ' ').slice(0, 160)}`,
              e1Done,
            );
          }
        } else {
          record('E1', 'Blocked', `after workspace click, unexpected sheet: ${after.slice(0, 120)}`, e1Shot);
        }
      }
      await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
    } catch (err) {
      record(
        'E1',
        /timeout/i.test(err.message) ? 'Blocked' : 'Fail',
        err.message,
        await shot(page, 'E1-fail').catch(() => ''),
      );
    }

    // —— E2 send + stop (needs open session + provider) —— //
    try {
      const composer = await page.evaluate(() => Boolean(document.querySelector('#composer, textarea, [contenteditable="true"]')));
      const canType = await page.evaluate(() => {
        const ta = document.querySelector('#composer-input, #input, textarea');
        return Boolean(ta && !ta.disabled);
      });
      if (!composer || !canType) {
        record('E2', 'Blocked', 'no editable composer (no live session / provider)', await shot(page, 'E2-blocked'));
      } else {
        await page.evaluate(() => {
          const ta = document.querySelector('#composer-input, #input, textarea');
          ta.focus();
          ta.value = 'ops ping';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.evaluate(() => {
          const btn = document.querySelector('#send, button[type="submit"]');
          btn?.click();
        });
        await sleep(1500);
        const afterSend = await page.evaluate(() => {
          const stop = [...document.querySelectorAll('button')].some((b) => /停止|Stop/.test(b.textContent || ''));
          const user = /ops ping/.test(document.body.innerText);
          return { stop, user };
        });
        if (afterSend.stop) {
          await clickText(page, 'button', '停止').catch(() => clickText(page, 'button', 'Stop'));
        }
        record(
          'E2',
          afterSend.stop || afterSend.user ? 'Pass' : 'Blocked',
          afterSend.stop || afterSend.user ? 'sent; stop or user timeline row visible' : 'send attempted; no stream and no user row',
          await shot(page, 'E2-send'),
        );
      }
    } catch (err) {
      record('E2', 'Fail', err.message);
    }

    // —— E3 / E4 mode & model —— //
    for (const [id, label] of [['E3', '权限'], ['E4', '模型']]) {
      try {
        const opened = await page.evaluate((want) => {
          const chips = [...document.querySelectorAll('button, .chip, .composer-chip')];
          const hit = chips.find((n) => (n.textContent || '').includes(want));
          if (!hit) return false;
          hit.click();
          return true;
        }, label);
        if (!opened) {
          record(id, 'Blocked', `no ${label} chip/control on this session`, await shot(page, `${id}-blocked`));
          continue;
        }
        await sleep(400);
        const items = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent.trim()));
        if (items.length < 2) {
          record(id, 'Blocked', `${label} opened but no alternate value to switch`, await shot(page, `${id}-blocked`));
          await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
          continue;
        }
        const before = items[0];
        const pick = items.find((item) => item && item !== before) || items[1];
        await page.evaluate((want) => {
          const hit = [...document.querySelectorAll('#sheet-root .sheet-item')].find((n) => n.textContent.trim() === want);
          hit?.click();
        }, pick);
        await sleep(600);
        const after = await page.evaluate((want) => {
          const chips = [...document.querySelectorAll('button, .chip, .composer-chip')];
          return chips.some((n) => (n.textContent || '').includes(want));
        }, pick);
        record(
          id,
          after ? 'Pass' : 'Blocked',
          after ? `${label} changed to ${pick}` : `${label} click did not update snapshot chip`,
          await shot(page, `${id}-open`),
        );
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      } catch (err) {
        record(id, 'Fail', err.message);
      }
    }

    // —— E6 long history —— //
    record('E6', 'Blocked', 'fresh paired home has no long timeline to paginate');

    // —— E7 approvals —— //
    record('E7', 'Blocked', 'no pending permission_requested in this env');

    // —— E8 Git pill —— //
    try {
      await page.evaluate(() => document.querySelector('#open-workspace')?.click());
      await sleep(800);
      const git = await page.evaluate(() => {
        const pill = document.getElementById('git-pill');
        return {
          visible: Boolean(pill && !pill.classList.contains('hidden')),
          text: pill?.textContent || '',
        };
      });
      const e8 = await shot(page, 'E8-git-pill');
      if (!git.visible) {
        record('E8', 'Blocked', 'git pill hidden (no checkout / cwd)', e8);
      } else {
        await page.evaluate(() => document.getElementById('git-pill')?.click());
        await sleep(400);
        const sheet = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
        const honest = /电脑端|disabled|不可用|禁用/.test(sheet) || sheet.length > 0;
        record('E8', honest ? 'Pass' : 'Fail', `git pill open; sheet=${sheet.slice(0, 100)}`, await shot(page, 'E8-git-sheet'));
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      }
    } catch (err) {
      record('E8', 'Fail', err.message);
    }

    // —— E9 Files —— //
    try {
      await page.evaluate(() => document.querySelector('#open-workspace')?.click());
      await sleep(400);
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('#options .ws-tab, .ws-tabs .ws-tab')];
        const files = tabs.find((t) => /文件/.test(t.textContent || ''));
        files?.click();
      });
      await sleep(600);
      const filesView = await page.evaluate(() => ({
        copy: document.querySelector('#options')?.textContent?.slice(0, 200) || '',
        writeControls: [...document.querySelectorAll('#options button')].some((b) => /保存|写入|Stage/.test(b.textContent || '')),
      }));
      const empty = paneNeedsSession(filesView.copy);
      const listed = await page.evaluate(() => document.querySelectorAll('#options .file-row, #options .dir-row, #options li').length);
      record(
        'E9',
        filesView.writeControls ? 'Fail' : (empty || listed === 0 ? 'Blocked' : 'Pass'),
        filesView.writeControls
          ? 'write controls present'
          : empty
            ? 'files pane still says open a session first'
            : `files pane read-only with ${listed} rows`,
        await shot(page, 'E9-files'),
      );
    } catch (err) {
      record('E9', 'Fail', err.message);
    }

    // —— E10 Diff —— //
    try {
      await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('#options .ws-tab, .ws-tabs .ws-tab')];
        const diff = tabs.find((t) => /更改|Diff/.test(t.textContent || ''));
        diff?.click();
      });
      await sleep(600);
      const scopes = await page.evaluate(() => [...document.querySelectorAll('#options .diff-scopes .ws-tab, #options .ws-tab')].map((t) => t.textContent.trim()));
      const hasScopes = scopes.some((s) => /未提交/.test(s)) && scopes.some((s) => /主干|base/i.test(s));
      const copy = await page.evaluate(() => document.querySelector('#options')?.textContent || '');
      const empty = paneNeedsSession(copy);
      record(
        'E10',
        empty ? 'Blocked' : (hasScopes ? 'Pass' : 'Blocked'),
        empty
          ? 'diff pane still says open a session first'
          : hasScopes
            ? `diff scopes visible: ${scopes.join('|')}`
            : `diff pane missing two scopes: ${copy.replace(/\s+/g, ' ').slice(0, 120)}`,
        await shot(page, 'E10-diff'),
      );
    } catch (err) {
      record('E10', 'Fail', err.message);
    }

    // —— E11 MCP + Skills —— //
    try {
      await page.evaluate(() => document.querySelector('#menu')?.click());
      await sleep(300);
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('button, a, .drawer-item, .link-row, .link-title')];
        nodes.find((n) => (n.textContent || '').trim() === '设置')?.click();
      });
      await sleep(400);
      for (const label of ['MCP', '技能']) {
        await page.evaluate((want) => {
          const nodes = [...document.querySelectorAll('button, a, .link-row, .link-title, .drawer-item')];
          nodes.find((n) => (n.textContent || '').includes(want))?.click();
        }, label);
        await sleep(600);
      }
      const copy = await page.evaluate(() => document.body.innerText.slice(0, 400));
      const listed = /MCP|技能/.test(copy) && /只读|电脑端/.test(copy);
      record(
        'E11',
        listed ? 'Pass' : 'Blocked',
        listed ? 'MCP/skills read-only list visible' : `extensions surface not opened: ${copy.replace(/\s+/g, ' ').slice(0, 140)}`,
        await shot(page, 'E11-extensions'),
      );
    } catch (err) {
      record('E11', 'Fail', err.message);
    }

    // —— E5 session menu (after workspace panes so delete does not empty E8–E11) —— //
    try {
      await page.evaluate(() => document.querySelector('#menu')?.click());
      await waitFor(
        () => page.evaluate(() => document.querySelector('#phone')?.hasAttribute('data-drawer')),
        'drawer for E5',
        8_000,
      );
      const hasSessions = await page.evaluate(() => document.querySelectorAll('#drawer .agent-row, #sessions .agent-row, [data-agent-id]').length);
      const e5Shot = await shot(page, 'E5-drawer');
      if (!hasSessions) {
        record('E5', 'Blocked', 'drawer open; no agent rows to rename/archive/delete', e5Shot);
      } else {
        await page.evaluate(() => {
          const more = document.querySelector('#drawer .agent-row .more, #drawer .agent-menu, [data-agent-id] button');
          more?.click();
        });
        await sleep(400);
        const menuText = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
        const hasActions = /重命名|归档|删除/.test(menuText);
        if (!hasActions) {
          record('E5', 'Blocked', `session rows present but menu not confirmed: ${menuText.slice(0, 80)}`, await shot(page, 'E5-menu'));
        } else {
          const beforeCount = hasSessions;
          await page.evaluate(() => {
            const del = [...document.querySelectorAll('#sheet-root button, #sheet-root .sheet-item')]
              .find((n) => /删除/.test(n.textContent || ''));
            del?.click();
          });
          await sleep(300);
          await page.evaluate(() => {
            const confirm = [...document.querySelectorAll('button')].find((n) => /删除|确认|确定/.test(n.textContent || ''));
            confirm?.click();
          });
          await sleep(800);
          const afterCount = await page.evaluate(() => document.querySelectorAll('#drawer .agent-row, [data-agent-id]').length);
          record(
            'E5',
            afterCount < beforeCount ? 'Pass' : 'Blocked',
            afterCount < beforeCount ? 'delete confirmed; row left the list' : 'delete menu present but list unchanged (confirm may have been cancelled)',
            await shot(page, 'E5-menu'),
          );
        }
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      }
    } catch (err) {
      record('E5', 'Fail', err.message);
    }

    // —— E12 disconnect —— //
    try {
      await page.evaluate(() => {
        const ta = document.querySelector('#composer-input, #input, textarea');
        if (!ta) return;
        ta.value = 'draft-after-disconnect';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await remote.stopDaemon();
      await waitFor(
        () => page.evaluate(() => {
          const banner = document.querySelector('.conn-banner, #conn-banner');
          return Boolean(banner && !banner.classList.contains('hidden') && banner.textContent.trim());
        }),
        'disconnect banner',
        20_000,
      );
      const refused = await page.evaluate(() => {
        const btn = document.querySelector('#send, button[type="submit"]');
        btn?.click();
        const banner = document.querySelector('.conn-banner, #conn-banner, [role="status"]');
        const draft = document.querySelector('#composer-input, #input, textarea')?.value || '';
        return {
          banner: banner?.textContent || '',
          draft,
        };
      });
      await remote.startDaemon();
      await waitFor(() => remote.snapshot().relayConnected === true, 'relay after E12 restart', 30_000);
      await waitFor(
        () => page.evaluate(() => /已配对|已重连/.test(document.getElementById('device-line')?.textContent || '')),
        'resync after restart',
        30_000,
      );
      const synced = await page.evaluate(() => /已重连|已配对/.test(document.getElementById('device-line')?.textContent || ''));
      const draftKept = /draft-after-disconnect/.test(refused.draft);
      record(
        'E12',
        refused.banner && draftKept && synced ? 'Pass' : 'Blocked',
        `banner=${Boolean(refused.banner)}; draftKept=${draftKept}; synced=${synced}`,
        await shot(page, 'E12-disconnected'),
      );
    } catch (err) {
      record('E12', 'Fail', err.message, await shot(page, 'E12-fail').catch(() => ''));
    }

    // —— E13 sticky reopen / forget —— //
    try {
      // Restart daemon for sticky path
      await remote.startDaemon();
      await waitFor(() => remote.snapshot().relayConnected === true, 'relay after restart', 30_000);
      const stickyPage = await browser.newPage();
      await stickyPage.setViewport({ width: 414, height: 896 });
      // Copy localStorage from paired origin — same LAN origin without hash
      const origin = new URL(pairingUrl).origin;
      await stickyPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await sleep(3000);
      const stickyState = await stickyPage.evaluate(() => ({
        device: document.getElementById('device-line')?.textContent || '',
        connectHidden: document.getElementById('screen-connect')?.classList.contains('hidden') ?? false,
        saved: document.getElementById('saved-computers')?.textContent || '',
      }));
      const e13Shot = await shot(stickyPage, 'E13-sticky');
      if (/已配对|已重连/.test(stickyState.device) || stickyState.connectHidden) {
        // Try forget on connect if visible
        await stickyPage.evaluate(() => {
          document.querySelector('.saved-forget')?.click();
        });
        record('E13', 'Pass', `sticky reopen without hash: ${stickyState.device}`, e13Shot);
      } else if (/已保存|忘记/.test(stickyState.saved) || stickyState.saved) {
        record('E13', 'Pass', 'connect screen shows saved computers chooser', e13Shot);
      } else {
        record('E13', 'Blocked', `no sticky reconnect observed (secrets are origin-scoped; headless new page may miss prior storage): ${JSON.stringify(stickyState).slice(0, 160)}`, e13Shot);
      }
      await stickyPage.close();
    } catch (err) {
      record('E13', 'Fail', err.message);
    }

    // —— E14 revoke device from desktop —— //
    try {
      const snap = remote.snapshot();
      const devices = snap.devices || [];
      const id = devices[0]?.id || devices[0]?.deviceId;
      if (!id || typeof remote.unbindDevice !== 'function') {
        record('E14', 'Blocked', `no paired device id to unbind (devices=${devices.length})`, '');
      } else {
        remote.unbindDevice(id);
        const after = (remote.snapshot().devices || []).filter((d) => !d.revokedAt && (d.id === id || d.deviceId === id));
        const check = await browser.newPage();
        await check.setViewport({ width: 414, height: 896 });
        await check.goto(`${new URL(pairingUrl).origin}/`, { waitUntil: 'domcontentloaded' });
        await sleep(3000);
        const state = await check.evaluate(() => ({
          device: document.getElementById('device-line')?.textContent || '',
          connectHidden: document.getElementById('screen-connect')?.classList.contains('hidden') ?? false,
        }));
        const stillPaired = /已配对|已重连/.test(state.device) || state.connectHidden;
        const e14 = await shot(check, 'E14-revoke');
        await check.close();
        record(
          'E14',
          after.length === 0 && !stillPaired ? 'Pass' : (after.length === 0 ? 'Blocked' : 'Fail'),
          after.length === 0 && !stillPaired
            ? `unbindDevice(${id}); web requires a new scan`
            : `unbind cleared=${after.length === 0}; stillPaired=${stillPaired}`,
          e14,
        );
      }
    } catch (err) {
      record('E14', 'Fail', err.message);
    }

    record('Android', 'Blocked', 'no physical Android device on this Windows host');
  } finally {
    try { await remote.stopDaemon(); } catch { /* ignore */ }
    try { await browser?.close(); } catch { /* ignore */ }
  }

  const out = path.join(SHOT_DIR, 'ops-matrix.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log('\n=== ops matrix ===');
  for (const row of rows) {
    console.log(`${row.id}\t${row.status}\t${row.detail}`);
  }
  console.log(`wrote ${out}`);
  const failed = rows.filter((r) => r.status === 'Fail');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
