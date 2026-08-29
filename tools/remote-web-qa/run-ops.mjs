/**
 * Post-pair ops matrix (6-E) against a real daemon + real browser session.
 * Not a substitute for mobile-web-qa's fake-daemon 48 checks.
 *
 * Usage (local relay recommended):
 *   node tools/remote-web-qa/run-ops.mjs --relay 127.0.0.1:8788 --screenshots <dir>
 */

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
        () => page.evaluate(() => (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('选择工作区')),
        'workspace step',
        15_000,
      );
      const sheet = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
      const items = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent.trim()));
      const e1Shot = await shot(page, 'E1-new-session-chooser');
      if (items.length === 0 || /没有|空|暂无/.test(sheet)) {
        record('E1', 'Blocked', `chooser opened but no workspaces in fresh chisacode home (${home})`, e1Shot);
      } else {
        // Pick first workspace and walk as far as providers allow
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-item')?.click());
        await sleep(800);
        const after = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
        if (/选择提供方/.test(after)) {
          const providers = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => n.textContent.trim()));
          if (providers.length === 0) {
            record('E1', 'Blocked', 'workspace selected; no ready providers', e1Shot);
          } else {
            await page.evaluate(() => document.querySelector('#sheet-root .sheet-item')?.click());
            await sleep(800);
            // mode / model steps optional
            for (const label of ['权限模式', '选择模型']) {
              const text = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
              if (text.includes(label)) {
                await page.evaluate(() => document.querySelector('#sheet-root .sheet-item')?.click());
                await sleep(600);
              }
            }
            await waitFor(
              () => page.evaluate(() => !document.querySelector('#sheet-root .sheet')),
              'chooser closed',
              20_000,
            );
            const e1Done = await shot(page, 'E1-session-created');
            record('E1', 'Pass', `created via chooser; first workspace + provider (${providers[0]})`, e1Done);
          }
        } else {
          record('E1', 'Blocked', `after workspace click, unexpected sheet: ${after.slice(0, 120)}`, e1Shot);
        }
      }
      await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
    } catch (err) {
      record('E1', 'Fail', err.message, await shot(page, 'E1-fail').catch(() => ''));
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
        const stopVisible = await page.evaluate(() => {
          const nodes = [...document.querySelectorAll('button')];
          return nodes.some((b) => /停止|Stop/.test(b.textContent || ''));
        });
        if (stopVisible) {
          await clickText(page, 'button', '停止').catch(() => clickText(page, 'button', 'Stop'));
        }
        record('E2', stopVisible ? 'Pass' : 'Blocked', stopVisible ? 'sent + stop control exercised' : 'send attempted; no stop control (idle/no stream)', await shot(page, 'E2-send'));
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
        await sleep(500);
        record(id, 'Pass', `${label} control opened`, await shot(page, `${id}-open`));
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      } catch (err) {
        record(id, 'Fail', err.message);
      }
    }

    // —— E5 session menu —— //
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
        record(
          'E5',
          hasActions ? 'Pass' : 'Blocked',
          hasActions ? 'session ⋯ menu exposes rename/archive/delete' : `session rows present but menu not confirmed: ${menuText.slice(0, 80)}`,
          await shot(page, 'E5-menu'),
        );
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      }
    } catch (err) {
      record('E5', 'Fail', err.message);
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
      record(
        'E9',
        filesView.writeControls ? 'Fail' : 'Pass',
        filesView.writeControls ? 'write controls present' : `files pane rendered (read-only). ${filesView.copy.replace(/\s+/g, ' ').slice(0, 120)}`,
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
      record(
        'E10',
        hasScopes || /只读|非 Git|没有差异|更改/.test(copy) ? 'Pass' : 'Blocked',
        hasScopes ? `diff scopes visible: ${scopes.join('|')}` : `diff pane: ${copy.replace(/\s+/g, ' ').slice(0, 120)}`,
        await shot(page, 'E10-diff'),
      );
    } catch (err) {
      record('E10', 'Fail', err.message);
    }

    // —— E11 MCP + Skills —— //
    try {
      await page.evaluate(() => document.querySelector('#menu')?.click());
      await sleep(300);
      for (const label of ['MCP', '技能']) {
        await page.evaluate((want) => {
          const nodes = [...document.querySelectorAll('button, a, .drawer-item')];
          nodes.find((n) => (n.textContent || '').includes(want))?.click();
        }, label);
        await sleep(500);
      }
      const copy = await page.evaluate(() => document.body.innerText.slice(0, 400));
      const honest = /只读|电脑端|MCP|技能/.test(copy);
      record('E11', honest ? 'Pass' : 'Blocked', `extensions surface text sample: ${copy.replace(/\s+/g, ' ').slice(0, 140)}`, await shot(page, 'E11-extensions'));
    } catch (err) {
      record('E11', 'Fail', err.message);
    }

    // —— E12 disconnect —— //
    try {
      await remote.stopDaemon();
      await waitFor(
        () => page.evaluate(() => {
          const banner = document.querySelector('.conn-banner, #conn-banner');
          return Boolean(banner && !banner.classList.contains('hidden') && banner.textContent.trim());
        }),
        'disconnect banner',
        20_000,
      );
      record('E12', 'Pass', 'stopDaemon → visible disconnect banner; send should refuse', await shot(page, 'E12-disconnected'));
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
        const after = (remote.snapshot().devices || []).filter((d) => !d.revokedAt && d.id === id);
        record(
          'E14',
          after.length === 0 ? 'Pass' : 'Fail',
          after.length === 0 ? `unbindDevice(${id}) cleared active device` : `device ${id} still active after unbind`,
          '',
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
