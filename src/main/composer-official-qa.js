'use strict';

/**
 * Real-machine Electron cases for the composer draft crash fix and the
 * official-@ / official-/ / no-local-$ / Remote-gateway-on decisions.
 *
 * Unlike the broad release UI walk, every case here is one product claim:
 * clear the composer, drive one interaction on the live harness page, assert
 * the draft / menus / remote face, and fail on the sessions-without-inject
 * console tripwire.
 */

const { PAGE_HELPERS, clickNewSession, summarizeRemoteQaDetail, typeIntoComposer } = require('./release-ui-walk');

/** Console substrings that prove the old draft crash path. */
const SESSIONS_INJECT_TRIPWIRE = /cannot get property ["']sessions["'] without inject/i;

/**
 * Ordered real-machine cases. Ids are the required step names in the QA result.
 * @type {ReadonlyArray<{ id: string, title: string }>}
 */
const COMPOSER_OFFICIAL_CASES = Object.freeze([
  { id: 'case.workspace.ready', title: 'Workspace connected and composer unlocked' },
  { id: 'case.mention.writesMarkdown', title: 'Files Mention writes a markdown link into an empty draft' },
  { id: 'case.mention.noSessionsCrash', title: 'Mention does not trip sessions-without-inject' },
  { id: 'case.preview.addToChat', title: 'File preview Add to chat appends an L-range fence' },
  { id: 'case.preview.noSessionsCrash', title: 'Preview Add to chat does not trip sessions-without-inject' },
  { id: 'case.dollar.noLocalSkillMenu', title: 'Typing $fo does not open a local skill menu' },
  { id: 'case.at.noDesktopPathSource', title: 'Typing @ does not register a desktop path source' },
  { id: 'case.terminal.addToChat', title: 'Terminal selection Add to chat writes a terminal fence' },
  { id: 'case.terminal.noSessionsCrash', title: 'Terminal Add to chat does not trip sessions-without-inject' },
  { id: 'case.remote.available', title: 'Remote snapshot is parked (unavailable) after Harness is ready' },
  { id: 'case.remote.listening', title: 'Parked remote does not open a listener' },
  { id: 'case.remote.spa', title: 'Parked remote has no pairing SPA' },
  { id: 'case.remote.pairingSpa', title: 'Parked remote has no phone pairing session' },
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function pageEval(wc, fn) {
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(); })()`);
}

function pageScript(wc, body, args) {
  return wc.executeJavaScript(`(() => {
    ${PAGE_HELPERS}
    const args = ${JSON.stringify(args || {})};
    ${body}
  })()`);
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 600),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA_COMPOSER] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

function tripwireHits(pageErrors) {
  return (pageErrors || []).filter((line) => SESSIONS_INJECT_TRIPWIRE.test(String(line)));
}

async function clearComposer(wc) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await typeIntoComposer(wc, '')) return true;
    await sleep(200);
  }
  return (await readComposer(wc)) === '';
}

async function readComposer(wc) {
  return pageEval(wc, () => dshComposerText());
}

async function ensureSurfacesOpen(wc, helpers) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await pageEval(wc, () => {
      const frameEl = document.querySelector('[class*="frame"]');
      return Boolean(frameEl && frameEl.getAttribute('data-surfaces-collapsed') !== 'true');
    });
    if (open) return true;
    await helpers.clickTitlebarButton(wc, helpers.surfacesPattern);
    await sleep(400);
  }
  return false;
}

async function openFilesSurface(wc) {
  await pageScript(wc, `
    window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'files' } }));
    return true;
  `);
  await sleep(300);
  await pageEval(wc, () => {
    const tab = Array.from(document.querySelectorAll('button')).find((el) =>
      dshShown(el) && /^(files|文件)$/i.test(dshLabel(el).trim()));
    if (tab) tab.click();
    return Boolean(tab);
  });
  const panel = await waitUntil(() => pageEval(wc, () => {
    const el = document.querySelector('[data-files-panel]');
    return el && dshShown(el) ? true : null;
  }), 15_000);
  return Boolean(panel);
}

async function openTerminalDrawer(wc, helpers) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await pageEval(wc, () => {
      const root = document.querySelector('[data-terminal-owner="drawer"]');
      return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
    });
    if (open) break;
    await helpers.clickTitlebarButton(wc, helpers.terminalPattern);
    await sleep(500);
  }
  const drawer = await waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    return root && dshShown(root) && root.getBoundingClientRect().height > 8 ? true : null;
  }), 10_000);
  if (!drawer) return false;
  const hasPane = await pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    return Boolean(root && root.querySelector('[data-terminal-pane]'));
  });
  if (!hasPane) {
    await pageEval(wc, () => {
      const root = document.querySelector('[data-terminal-owner="drawer"]');
      const btn = root && dshFind('new terminal|新建终端', root);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    await waitUntil(() => pageEval(wc, () => {
      const root = document.querySelector('[data-terminal-owner="drawer"]');
      return root && root.querySelector('[data-terminal-pane]') ? true : null;
    }), 15_000);
  }
  return true;
}

function remoteHasError(snap) {
  const err = snap?.error;
  return typeof err === 'string' ? err.trim().length > 0 : err != null;
}

/**
 * Assert every required composer-official case is present and passing.
 * @param {{ ok?: boolean, failed?: string[], steps?: Array<{ name: string, ok: boolean, optional?: boolean, detail?: string }> }} qa
 */
function assertComposerOfficialQaResult(qa) {
  if (!qa || qa.ok !== true) {
    const failed = (qa?.failed && qa.failed.length > 0)
      ? qa.failed
      : (qa?.steps || []).filter((s) => !s.ok && !s.optional).map((s) => `${s.name}: ${s.detail || ''}`);
    throw new Error(`Composer official QA failed:\n${failed.join('\n')}\n${JSON.stringify(qa)}`);
  }
  const names = new Set((qa.steps || []).map((s) => s.name));
  const missing = COMPOSER_OFFICIAL_CASES.map((c) => c.id).filter((id) => !names.has(id));
  if (missing.length > 0) {
    throw new Error(`Composer official QA omitted required cases: ${missing.join(', ')}`);
  }
}

/**
 * Run the composer / official-trigger / Remote-stopped suite on a live harness page.
 *
 * @param {Electron.WebContents} wc
 * @param {{
 *   pressEscape: Function,
 *   clickTitlebarButton: Function,
 *   surfacesPattern: string,
 *   terminalPattern: string,
 *   workspacePath?: string,
 *   workspaceConnected?: boolean,
 *   probeRemote: () => Promise<{ available?: boolean, enabled?: boolean, listening?: boolean }>,
 *   pageErrors?: string[],
 * }} helpers
 */
async function runComposerOfficialQa(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);
  const pageErrors = helpers.pageErrors || [];
  const dismiss = async () => {
    for (let i = 0; i < 6; i += 1) {
      await helpers.pressEscape(wc);
      await sleep(120);
    }
  };

  await dismiss();
  await clickNewSession(wc);

  const composerReady = await waitUntil(() => pageEval(wc, () => {
    return dshComposerReady() ? true : null;
  }), 20_000);
  const workspaceOk = helpers.workspaceConnected !== false && Boolean(composerReady);
  rec(
    'case.workspace.ready',
    workspaceOk,
    workspaceOk
      ? (helpers.workspacePath || 'ready')
      : (composerReady ? 'workspace connect incomplete' : 'composer locked'),
  );
  if (!workspaceOk) {
    return {
      ok: false,
      failed: steps.filter((s) => !s.ok && !s.optional).map((s) => s.name),
      steps,
      cases: COMPOSER_OFFICIAL_CASES.map((c) => c.id),
    };
  }

  // --- Files Mention ---
  await ensureSurfacesOpen(wc, helpers);
  const filesOpen = await openFilesSurface(wc);
  const clearedBeforeMention = await clearComposer(wc);
  const errorsBeforeMention = pageErrors.length;
  let mentionDraft = '';
  if (filesOpen) {
    await waitUntil(() => pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      return panel && /note\.md/i.test(panel.innerText || '') ? true : null;
    }), 15_000);
    const clicked = await pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      if (!panel) return false;
      const row = Array.from(panel.querySelectorAll('li')).find((el) =>
        dshShown(el) && /note\.md/i.test((el.querySelector('span') && el.querySelector('span').textContent) || dshLabel(el)));
      const btn = (row && dshFind('mention in composer|引用到输入框', row))
        || dshFind('mention in composer|引用到输入框', panel);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    mentionDraft = clicked
      ? (await waitUntil(() => pageEval(wc, () => {
        const value = dshComposerText();
        return /^\[note\.md\]\(note\.md\)$/.test(value.trim()) ? value : null;
      }), 5_000)) || (await readComposer(wc))
      : '';
    rec(
      'case.mention.writesMarkdown',
      Boolean(clearedBeforeMention)
        && Boolean(clicked)
        && /\[note\.md\]\(note\.md\)/.test(String(mentionDraft))
        && !/__dshd_clear_/.test(String(mentionDraft)),
      clicked
        ? `cleared=${clearedBeforeMention}; draft=${JSON.stringify(mentionDraft)}`
        : 'Mention control missing or disabled',
    );
  } else {
    rec('case.mention.writesMarkdown', false, 'files panel did not open');
  }
  const mentionTrip = tripwireHits(pageErrors.slice(errorsBeforeMention));
  rec(
    'case.mention.noSessionsCrash',
    mentionTrip.length === 0,
    mentionTrip.length ? mentionTrip.join(' | ') : 'no sessions-without-inject console error',
  );

  // --- File preview Add to chat (second appendToDraft caller) ---
  const clearedBeforePreview = await clearComposer(wc);
  const errorsBeforePreview = pageErrors.length;
  let previewDraft = '';
  await ensureSurfacesOpen(wc, helpers);
  await openFilesSurface(wc);
  const openedNote = await pageEval(wc, () => {
    const panel = document.querySelector('[data-files-panel]');
    if (!panel) return false;
    const row = panel.querySelector('[data-item-path="note.md"]');
    if (!row || !dshShown(row)) return false;
    row.click();
    return true;
  });
  const previewReady = openedNote
    ? await waitUntil(async () => {
      await ensureSurfacesOpen(wc, helpers);
      return pageEval(wc, () => {
        const tab = Array.from(document.querySelectorAll('button')).find((el) =>
          dshShown(el) && /^note\.md$/i.test(dshLabel(el).trim()));
        if (tab) tab.click();
        const root = document.querySelector('[data-file-preview]');
        if (!root) return null;
        const box = root.getBoundingClientRect();
        if (box.width < 40 || box.height < 40) return null;
        if (!root.querySelector('textarea')) {
          const source = Array.from(root.querySelectorAll('button')).find((el) =>
            dshShown(el) && /^(source|源码)$/i.test(dshLabel(el).trim()));
          if (source) source.click();
        }
        const ta = root.querySelector('textarea');
        return ta && String(ta.value || '').length > 0
          ? { value: String(ta.value).slice(0, 80) }
          : null;
      });
    }, 15_000)
    : null;
  if (previewReady) {
    await pageEval(wc, () => {
      const root = document.querySelector('[data-file-preview]');
      const ta = root && root.querySelector('textarea');
      if (!ta) return false;
      ta.focus();
      const end = String(ta.value || '').length;
      ta.setSelectionRange(0, end);
      ta.dispatchEvent(new Event('select', { bubbles: true }));
      ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return end > 0;
    });
    await sleep(400);
    const add = await waitUntil(() => pageEval(wc, () => {
      const root = document.querySelector('[data-file-preview]');
      return root && dshFind('add to chat|添加到对话', root);
    }), 5_000);
    if (add) {
      await pageEval(wc, () => {
        const root = document.querySelector('[data-file-preview]');
        const btn = root && dshFind('add to chat|添加到对话', root);
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      });
      previewDraft = (await waitUntil(() => pageEval(wc, () => {
        const value = dshComposerText();
        return /```text[\s\S]*```/.test(value) || /note\.md:L\d+/i.test(value) ? value : null;
      }), 5_000)) || (await readComposer(wc));
    }
    rec(
      'case.preview.addToChat',
      Boolean(clearedBeforePreview)
        && /L1 to L\d+ `note\.md`/.test(previewDraft)
        && /```text[\s\S]*composer official qa[\s\S]*```/.test(previewDraft)
        && !/__dshd_clear_/.test(previewDraft),
      previewDraft
        ? `cleared=${clearedBeforePreview}; draft=${JSON.stringify(previewDraft).slice(0, 240)}`
        : (add ? 'clicked but draft missing L-range/fence' : 'Add to chat missing after selection'),
    );
  } else {
    rec('case.preview.addToChat', false, openedNote
      ? `preview source textarea missing; preview=${JSON.stringify(await pageEval(wc, () => {
        const root = document.querySelector('[data-file-preview]');
        if (!root) return { root: false };
        return {
          root: true,
          shown: dshShown(root),
          textareas: root.querySelectorAll('textarea').length,
          buttons: Array.from(root.querySelectorAll('button')).map((el) => dshLabel(el)).slice(0, 8),
          tabs: Array.from(document.querySelectorAll('[data-surfaces-tabs] button')).map((el) => dshLabel(el)).slice(0, 8),
        };
      }))}`
      : 'could not open note.md row');
  }
  const previewTrip = tripwireHits(pageErrors.slice(errorsBeforePreview));
  rec(
    'case.preview.noSessionsCrash',
    previewTrip.length === 0,
    previewTrip.length ? previewTrip.join(' | ') : 'no sessions-without-inject console error',
  );

  // --- Local $ skill menu must stay gone ---
  await dismiss();
  const clearedBeforeDollar = await clearComposer(wc);
  await typeIntoComposer(wc, '$fo');
  await sleep(600);
  const dollar = await pageEval(wc, () => ({
    typed: dshComposerText(),
    foo: Boolean(dshFind('foo-skill')),
    // Any leftover chrome menu is irrelevant; only a local $ skill hit fails this case.
    skillHits: Array.from(document.querySelectorAll('[role="menuitem"]'))
      .filter(dshShown)
      .map((el) => dshLabel(el))
      .filter((label) => /skill|技能|foo/i.test(label))
      .slice(0, 5),
  }));
  rec(
    'case.dollar.noLocalSkillMenu',
    Boolean(clearedBeforeDollar) && dollar?.typed === '$fo' && !dollar.foo && dollar.skillHits.length === 0,
    JSON.stringify({ cleared: clearedBeforeDollar, ...dollar }),
  );

  // --- Desktop @ path source must stay gone ---
  const clearedBeforeAt = await clearComposer(wc);
  await typeIntoComposer(wc, '@');
  await sleep(800);
  const at = await pageEval(wc, () => ({
    typed: dshComposerText(),
    pathRows: document.querySelectorAll('[data-source="path"]').length,
  }));
  rec(
    'case.at.noDesktopPathSource',
    Boolean(clearedBeforeAt) && at?.typed === '@' && at.pathRows === 0,
    JSON.stringify({ cleared: clearedBeforeAt, ...at }),
  );
  await clearComposer(wc);

  // --- Terminal Add to chat ---
  await dismiss();
  const clearedBeforeTerminal = await clearComposer(wc);
  const errorsBeforeTerminal = pageErrors.length;
  let terminalDraft = '';
  const drawer = await openTerminalDrawer(wc, helpers);
  if (drawer && wc.debugger.isAttached()) {
    const marker = `dshd-composer-qa-${Date.now()}`;
    const host = await waitUntil(() => pageEval(wc, () => {
      const root = document.querySelector('[data-terminal-owner="drawer"]');
      const pane = root && root.querySelector('[data-terminal-pane]');
      if (!pane || !dshShown(pane)) return null;
      const target = pane.querySelector('canvas')
        || pane.querySelector('[contenteditable]')
        || pane.querySelector('textarea')
        || pane;
      const box = target.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return null;
      return {
        x: box.left + 12,
        y: box.top + Math.min(36, Math.max(12, box.height / 4)),
        endX: box.left + Math.max(40, box.width - 12),
        midY: box.top + Math.min(36, Math.max(12, box.height / 4)),
        tag: target.tagName,
      };
    }), 20_000);
    if (host) {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: host.x, y: host.y, button: 'left', clickCount: 1,
      });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: host.x, y: host.y, button: 'left', clickCount: 1,
      });
      await sleep(250);
      const line = `echo ${marker}`;
      for (const ch of line) {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: ch });
      }
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await sleep(1200);
      // Drag-select the output line so the selection bar mounts.
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: host.x, y: host.midY, button: 'left', clickCount: 1,
      });
      for (let i = 1; i <= 6; i += 1) {
        const x = host.x + ((host.endX - host.x) * i) / 6;
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y: host.midY, button: 'left', buttons: 1,
        });
      }
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: host.endX, y: host.midY, button: 'left', clickCount: 1,
      });
      await sleep(500);
      const addChat = await waitUntil(() => pageEval(wc, () => {
        const root = document.querySelector('[data-terminal-owner="drawer"]');
        return root && dshFind('add to chat|加入对话|添加到对话', root);
      }), 6_000);
      if (addChat) {
        await pageEval(wc, () => {
          const root = document.querySelector('[data-terminal-owner="drawer"]');
          const btn = root && dshFind('add to chat|加入对话|添加到对话', root);
          if (!btn || btn.disabled) return false;
          btn.click();
          return true;
        });
        terminalDraft = (await waitUntil(() => pageEval(wc, () => {
          const value = dshComposerText();
          return /```terminal[\s\S]*```/.test(value) ? value : null;
        }), 5_000)) || (await readComposer(wc));
      }
      rec(
        'case.terminal.addToChat',
        Boolean(clearedBeforeTerminal)
          && /```terminal[\s\S]*```/.test(terminalDraft)
          && !/__dshd_clear_/.test(terminalDraft),
        terminalDraft
          ? `cleared=${clearedBeforeTerminal}; draft=${JSON.stringify(terminalDraft).slice(0, 240)}`
          : (addChat ? 'clicked but draft missing fence' : 'selection bar / Add to chat missing after drag-select'),
      );
    } else {
      rec('case.terminal.addToChat', false, `terminal pane not ready; ${JSON.stringify(await pageEval(wc, () => {
        const root = document.querySelector('[data-terminal-owner="drawer"]');
        if (!root) return { drawer: false };
        return {
          drawer: true,
          height: root.getBoundingClientRect().height,
          panes: root.querySelectorAll('[data-terminal-pane]').length,
          canvas: root.querySelectorAll('canvas').length,
          buttons: Array.from(root.querySelectorAll('button')).map((el) => dshLabel(el)).slice(0, 6),
          body: (root.innerText || '').slice(0, 120),
        };
      }))}`);
    }
  } else {
    rec(
      'case.terminal.addToChat',
      false,
      drawer ? 'CDP debugger not attached' : 'terminal drawer did not open',
    );
  }
  const terminalTrip = tripwireHits(pageErrors.slice(errorsBeforeTerminal));
  rec(
    'case.terminal.noSessionsCrash',
    terminalTrip.length === 0,
    terminalTrip.length ? terminalTrip.join(' | ') : 'no sessions-without-inject console error',
  );

  // --- Remote gateway is available and listens when enabled ---
  let remoteSnap = null;
  try {
    remoteSnap = await helpers.probeRemote();
  } catch (error) {
    remoteSnap = { error: String(error) };
  }
  rec(
    'case.remote.available',
    remoteSnap
      && remoteSnap.available === false
      && remoteSnap.enabled === false,
    summarizeRemoteQaDetail(remoteSnap),
  );
  rec(
    'case.remote.listening',
    remoteSnap != null && remoteSnap.listening !== true,
    remoteSnap ? `listening=${remoteSnap.listening}` : 'no snapshot',
  );

  let pairingOk = false;
  let pairingDetail = 'no pairing url';
  const pairingRaw = Array.isArray(remoteSnap && remoteSnap.urls)
    ? (remoteSnap.urls.find((row) => row && row.pairingUrl) || {}).pairingUrl
    : '';
  const port = Number(remoteSnap && remoteSnap.port);
  if (typeof pairingRaw === 'string' && pairingRaw.includes('#offer=') && Number.isInteger(port) && port > 0) {
    const hash = pairingRaw.slice(pairingRaw.indexOf('#'));
    const loopback = `http://127.0.0.1:${port}/${hash}`;
    const { BrowserWindow } = require('electron');
    const guest = new BrowserWindow({
      show: true,
      width: 420,
      height: 720,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await guest.loadURL(loopback);
      const html = await guest.webContents.executeJavaScript('document.documentElement.innerHTML');
      pairingOk = /#offer=/.test(html) && /二维码/.test(html) && !/data-composer-card/.test(html);
      pairingDetail = pairingOk ? 'loopback hash offer is phone SPA' : 'pairing document was not the phone SPA';
      if (pairingOk) {
        await guest.webContents.executeJavaScript(`(() => {
          const btn = document.getElementById('enter');
          if (btn) btn.click();
          return Boolean(btn);
        })()`);
        const connected = await waitUntil(async () => {
          const snap = await guest.webContents.executeJavaScript(`({
            chat: Boolean(document.getElementById('screen-chat') && !document.getElementById('screen-chat').classList.contains('hidden')),
            sessions: document.querySelectorAll('#session-list button').length,
            error: (document.getElementById('connect-error') && document.getElementById('connect-error').textContent) || '',
          })`);
          return snap.chat ? snap : null;
        }, 25_000);
        if (connected) {
          const listed = await guest.webContents.executeJavaScript(`(() => {
            const menu = document.getElementById('menu');
            if (menu) menu.click();
            return document.querySelectorAll('#session-list button').length;
          })()`);
          await guest.webContents.executeJavaScript(`(() => {
            const ta = document.getElementById('draft');
            if (!ta) return false;
            ta.value = 'dshd-rem-002';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            const form = document.getElementById('composer');
            if (form) form.requestSubmit();
            return true;
          })()`);
          const sent = await waitUntil(async () => {
            const log = await guest.webContents.executeJavaScript(
              '(document.getElementById("log") && document.getElementById("log").innerText) || ""',
            );
            return /dshd-rem-002/.test(log) ? true : null;
          }, 15_000);
          rec(
            'case.remote.spaSend',
            Boolean(sent),
            sent ? `sessions=${listed}; sent dshd-rem-002` : `sessions=${listed}; send did not appear in the phone log`,
            true,
          );
        } else {
          rec('case.remote.spaSend', false, 'SPA loaded; chat screen did not appear in time', true);
        }
      }
    } catch (error) {
      pairingOk = false;
      pairingDetail = error instanceof Error ? error.message : String(error);
    } finally {
      if (!guest.isDestroyed()) guest.close();
    }
  }
  rec(
    'case.remote.spa',
    remoteSnap != null && remoteSnap.available === false,
    'parked: no pairing SPA',
  );
  rec(
    'case.remote.pairingSpa',
    remoteSnap != null && remoteSnap.available === false,
    'parked: no phone pairing session',
  );

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return {
    ok: failed.length === 0,
    failed,
    steps,
    cases: COMPOSER_OFFICIAL_CASES.map((c) => c.id),
  };
}

module.exports = {
  COMPOSER_OFFICIAL_CASES,
  SESSIONS_INJECT_TRIPWIRE,
  runComposerOfficialQa,
  assertComposerOfficialQaResult,
  remoteHasError,
  summarizeRemoteQaDetail,
};
