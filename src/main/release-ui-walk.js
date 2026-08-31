'use strict';

const { spawnSync } = require('node:child_process');
const { buildSettingsSectionScript } = require('./settings-jump');

/**
 * In-page helpers for the Electron release walk. Kept as a string so
 * executeJavaScript can eval them without a Node closure.
 */
const PAGE_HELPERS = `
function dshShown(el) {
  if (!el) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}
function dshLabel(el) {
  return ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))
    .replace(/\\s+/g, ' ').trim();
}
function dshFind(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll(
    'button, [role="button"], [role="menuitem"], [role="tab"], [role="searchbox"], [role="textbox"], input, textarea, a'
  )).find((el) => dshShown(el) && re.test(dshLabel(el))) || null;
}
function dshComposerSend() {
  const card = document.querySelector('[data-composer-card]');
  if (!card) return null;
  return dshFind('send message|发送消息', card);
}
const VISION_PASS_RE = /不支持图片|does not support images?|无法查看|不能读图|无法识图|不能识图|没有.*视觉|识图|像素|multimodal|image input|这张.*图|图中|图片里|PNG|rgb|红|蓝|绿|颜色|包含非文本|暂不支持编辑|non-text/i;
const VISION_PRE_SEND_RE = /不支持图片|does not support images?|无法.*图|不能.*图|包含非文本|暂不支持编辑|non-text/i;
function lastAssistantText() {
  const assistants = Array.from(document.querySelectorAll(
    '[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]',
  ));
  const last = assistants.at(-1);
  return last ? (last.innerText || '').trim() : '';
}
function dshQaPngFile() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], 'dshd-qa.png', { type: 'image/png' });
}
function dshAssignFile(input, file) {
  if (!input || !file) return false;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function dshSetValue(el, value) {
  if (!el) return false;
  el.focus();
  try {
    if (typeof el.select === 'function') el.select();
  } catch {
    /* password / number inputs still accept insertText */
  }
  if (document.execCommand && document.execCommand('insertText', false, value) && el.value === value) {
    return true;
  }
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  const tracker = el._valueTracker;
  const last = el.value;
  if (tracker) tracker.setValue(last);
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: value,
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === value;
}
function dshField(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll('input, textarea')).find((el) => {
    const aria = el.getAttribute('aria-label') || '';
    const ph = el.getAttribute('placeholder') || '';
    return re.test(aria) || re.test(ph);
  }) || null;
}
function dshCustomProviderCard(root) {
  const scope = root || document;
  const route = Array.from(scope.querySelectorAll('input, textarea')).find((el) =>
    /^provider id$/i.test(el.getAttribute('aria-label') || ''));
  if (!route) return null;
  let node = route.parentElement;
  while (node && node !== document.body) {
    const hasCreate = Array.from(node.querySelectorAll('button')).some((btn) =>
      /创建提供方|create provider/i.test(dshLabel(btn)));
    if (hasCreate) return node;
    node = node.parentElement;
  }
  return null;
}
function dshInputInventory(root) {
  const scope = root || document;
  return Array.from(scope.querySelectorAll('input, textarea')).map((el) => ({
    aria: el.getAttribute('aria-label') || '',
    ph: el.getAttribute('placeholder') || '',
    shown: dshShown(el),
    type: el.type || el.tagName,
  })).slice(0, 12);
}
function dshDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find(dshShown) || null;
}
function dshDialogNamed(pattern) {
  const re = new RegExp(pattern, 'i');
  return Array.from(document.querySelectorAll('[role="dialog"]')).filter(dshShown).find((el) => {
    const labelled = el.getAttribute('aria-labelledby');
    const title = labelled ? ((document.getElementById(labelled) && document.getElementById(labelled).textContent) || '') : '';
    const aria = el.getAttribute('aria-label') || '';
    return re.test(aria) || re.test(title);
  }) || null;
}
function dshHeading(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll('h1, h2, h3')).find((el) =>
    dshShown(el) && re.test((el.textContent || '').trim())) || null;
}
`;

/**
 * QA log line for a Remote snapshot. Never includes token or pairing URLs.
 * @param {object | null | undefined} snap
 * @returns {string}
 */
function summarizeRemoteQaDetail(snap) {
  if (snap == null) return 'no snapshot';
  const parts = [
    `available=${snap.available === true}`,
    `enabled=${snap.enabled === true}`,
    `listening=${snap.listening === true}`,
  ];
  if (snap.port != null) parts.push(`port=${snap.port}`);
  if (snap.mode) parts.push(`mode=${snap.mode}`);
  parts.push(`tokenPresent=${Boolean(snap.token)}`);
  if (Array.isArray(snap.urls)) parts.push(`urls=${snap.urls.length}`);
  const err = typeof snap.error === 'string' ? snap.error.trim() : '';
  if (err) parts.push(`error=${err}`);
  return parts.join(' ');
}

const QA_REQUIRED_STEPS = [
  'workspace.picker',
  'workspace.connected',
  'frame.fourColumn',
  'composer.card',
  'composer.textarea',
  'composer.commands',
  'composer.send',
  'composer.access',
  'composer.skillMenuAbsent',
  'composer.pathSourceAbsent',
  'remote.available',
  'remote.notListening',
  'remote.footerPresent',
  'titlebar.sessionLog',
  'titlebar.branch',
  'titlebar.commit',
  'titlebar.git',
  'titlebar.terminal',
  'titlebar.surfaces',
  'titlebar.windowControls',
  'titlebar.branchMenu',
  'titlebar.gitMenu',
  'terminal.drawer',
  'terminal.new',
  'surfaces.open',
  'files.panel',
  'files.tabCloseRight',
  'files.search',
  'files.readme',
  'files.note',
  'files.mentionVisible',
  'files.mentionAppended',
  'git.commit',
  'agents.panel',
  'agents.empty',
  'diff.panel',
  'browser.panel',
  'browser.url',
  'terminal.surface',
  'settings.trigger',
  'models.heading',
  'models.customAdd',
  'models.customForm',
  'models.visionPicker',
  'appearance.choose',
  'appearance.browse',
  'appearance.noSourceDump',
  'appearance.themeSwitch',
  'appearance.localCrop',
  'appearance.frost',
  'gallery.dialog',
  'gallery.sources',
  'gallery.addSource',
  'gallery.wallhavenSfw',
  'gallery.confirmSet',
  'mcp.heading',
  'mcp.search',
  'mcp.add',
  'skills.heading',
  'skills.add',
  'plugins.heading',
  'market.section',
  'market.discover',
  'market.installed',
  'usage-stats.section',
  'plugin.dshbot.tabAbsent',
];

function gitHeadSubject(workspacePath) {
  if (!workspacePath) return '';
  const result = spawnSync('git', ['-C', workspacePath, 'log', '-1', '--pretty=%s'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

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

function pageEval(wc, fn, ...args) {
  const serialized = args.map((value) => JSON.stringify(value)).join(', ');
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(${serialized}); })()`);
}

function pageScript(wc, body, args) {
  return wc.executeJavaScript(`(() => {
    ${PAGE_HELPERS}
    const args = ${JSON.stringify(args || {})};
    ${body}
  })()`);
}

async function typeIntoAriaField(wc, pattern, value) {
  const box = await pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const card = dialog && dshCustomProviderCard(dialog);
    const el = card && dshField(args.pattern, card);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    el.focus();
    if (typeof el.select === 'function') el.select();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  `, { pattern });
  if (!box || box.w < 1 || box.h < 1) return false;
  try {
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
    await sleep(40);
    await wc.debugger.sendCommand('Input.insertText', { text: value });
  } catch {
    await pageScript(wc, `
      const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
      const card = dialog && dshCustomProviderCard(dialog);
      const el = card && dshField(args.pattern, card);
      return el ? dshSetValue(el, args.value) : false;
    `, { pattern, value });
  }
  await sleep(80);
  return pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const card = dialog && dshCustomProviderCard(dialog);
    const el = card && dshField(args.pattern, card);
    return Boolean(el && el.value === args.value);
  `, { pattern, value });
}

function clickNamed(wc, pattern, rootSelector) {
  return pageScript(wc, `
    const root = args.rootSelector ? document.querySelector(args.rootSelector) : document;
    const el = dshFind(args.pattern, root || document);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  `, { pattern, rootSelector: rootSelector || null });
}

async function pressEnter(wc) {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 400),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

/**
 * Connect the configured desktop workspace through the in-app directory picker.
 *
 * @param {Electron.WebContents} wc
 * @param {{ workspacePath: string, pressEscape: Function }} helpers
 * @param {(name: string, ok: boolean, detail?: string, optional?: boolean) => void} rec
 */
async function connectConfiguredWorkspace(wc, helpers, rec) {
  const workspacePath = helpers.workspacePath;
  rec('workspace.path', Boolean(workspacePath), workspacePath || 'missing', true);
  if (!workspacePath) {
    rec('workspace.connected', false, 'helpers.workspacePath missing');
    return false;
  }

  const clicked = await clickNamed(wc, '^add workspace$|^添加工作区$');
  rec('workspace.addClicked', Boolean(clicked), '', true);
  await sleep(300);
  await pageEval(wc, () => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
      dshShown(el) && /add workspace|添加工作区/i.test(dshLabel(el)));
    if (!item) return false;
    item.click();
    return true;
  });

  const picker = await waitUntil(() => pageEval(wc, () =>
    Boolean(dshDialogNamed('select workspace directory|选择工作区目录'))), 10_000);
  rec('workspace.picker', Boolean(picker), picker ? '' : 'directory picker missing');
  if (!picker) {
    rec('workspace.connected', false, 'picker did not open');
    return false;
  }

  await clickNamed(wc, 'edit path|编辑路径');
  await sleep(250);
  const filled = await pageScript(wc, `
    const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
    if (!dialog) return false;
    const input = Array.from(dialog.querySelectorAll('input, textarea')).find(dshShown)
      || dshFind('edit path|编辑路径', dialog);
    if (!input) return false;
    input.focus();
    return dshSetValue(input, args.path);
  `, { path: workspacePath });
  if (!filled) {
    rec('workspace.connected', false, 'path editor missing');
    return false;
  }
  await pressEnter(wc);
  const openReady = await waitUntil(() => pageScript(wc, `
    const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
    if (!dialog) return null;
    const btn = Array.from(dialog.querySelectorAll('button')).find((el) =>
      dshShown(el) && /^(open|打开)$/i.test(dshLabel(el)) && !el.disabled);
    return btn || null;
  `), 12_000);
  if (openReady) {
    await pageScript(wc, `
      const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
      const btn = dialog && Array.from(dialog.querySelectorAll('button')).find((el) =>
        dshShown(el) && /^(open|打开)$/i.test(dshLabel(el)) && !el.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    `);
  } else {
    // Fallback: confirm with Enter when Open stays disabled longer than expected.
    await pressEnter(wc);
  }
  let pickerClosed = await waitUntil(() => pageEval(wc, () =>
    !dshDialogNamed('select workspace directory|选择工作区目录')), 12_000);
  if (!pickerClosed) {
    await pressEnter(wc);
    pickerClosed = await waitUntil(() => pageEval(wc, () =>
      !dshDialogNamed('select workspace directory|选择工作区目录')), 8_000);
  }
  const connected = await waitUntil(() => pageEval(wc, () => {
    const ta = document.querySelector('[data-composer-card] textarea');
    return Boolean(ta && !ta.disabled);
  }), 15_000);
  if (connected && !pickerClosed) {
    // Workspace already unlocked; dismiss a stuck directory dialog so chrome is usable.
    await pageEval(wc, () => {
      const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
      if (!dialog) return false;
      const close = Array.from(dialog.querySelectorAll('button')).find((el) =>
        dshShown(el) && /^(open|打开|cancel|取消|close|关闭)$/i.test(dshLabel(el)));
      if (close) {
        close.click();
        return true;
      }
      return false;
    });
    if (typeof helpers.pressEscape === 'function') {
      for (let i = 0; i < 4; i += 1) {
        await helpers.pressEscape(wc);
        await sleep(100);
      }
    }
    pickerClosed = await waitUntil(() => pageEval(wc, () =>
      !dshDialogNamed('select workspace directory|选择工作区目录')), 5_000);
  }
  rec('workspace.pickerClosed', Boolean(pickerClosed), pickerClosed ? '' : 'picker stayed open', true);
  rec(
    'workspace.connected',
    Boolean(connected),
    connected ? workspacePath : 'session still locked',
  );
  return Boolean(connected);
}

/**
 * Drive one assembled-desktop UI walk against a live harness webContents.
 * Callers must attach the CDP debugger when they need Escape via pressEscape.
 *
 * @param {Electron.WebContents} wc - harness page (BrowserView), not the boot shell.
 * @param {{ pressEscape: Function, clickTitlebarButton: Function, surfacesPattern: string, terminalPattern: string }} helpers
 * @returns {Promise<{ ok: boolean, steps: Array<{ name: string, ok: boolean, optional?: boolean, detail: string }> }>}
 */
async function runReleaseUiWalk(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);

  const dismiss = async () => {
    for (let i = 0; i < 4; i += 1) {
      await helpers.pressEscape(wc);
      await sleep(120);
    }
  };

  const openSurface = async (kind) => {
    await pageScript(wc, `
      window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: args.kind } }));
      return true;
    `, { kind });
  };

  const openSettings = async (section) => {
    const opened = await wc.executeJavaScript(buildSettingsSectionScript(section));
    await sleep(400);
    return opened;
  };

  try {
  await dismiss();
  if (helpers.skipWorkspaceConnect) {
    rec('workspace.picker', true, 'connected before titlebar hits');
    rec('workspace.connected', true, helpers.workspacePath || '');
  } else {
    await connectConfiguredWorkspace(wc, helpers, rec);
  }

  const frame = await pageEval(wc, () => {
    const el = document.querySelector('[class*="frame"]');
    const grid = el ? getComputedStyle(el).gridTemplateColumns.trim() : '';
    return {
      present: Boolean(el),
      columns: grid ? grid.split(/\s+/).length : 0,
      grid,
      collapsed: el ? el.getAttribute('data-surfaces-collapsed') : null,
    };
  });
  rec('frame.fourColumn', frame?.columns === 4, frame?.grid || 'missing frame');

  const composer = await pageEval(wc, () => {
    const card = document.querySelector('[data-composer-card]');
    return {
      card: dshShown(card),
      textarea: Boolean(card && dshShown(card.querySelector('textarea'))),
      commands: Boolean(dshFind('^commands$|^命令$')),
      send: Boolean(dshFind('send message|发送消息')),
      access: Boolean(dshFind('access mode|访问模式')),
      thinking: Boolean(dshFind('^high$|^max$|^low$|思考', card)),
    };
  });
  rec('composer.card', composer?.card, '');
  rec('composer.textarea', composer?.textarea, '');
  rec('composer.commands', composer?.commands, '');
  rec('composer.send', composer?.send, '');
  rec('composer.access', composer?.access, '');
  rec('composer.thinking', Boolean(composer?.thinking), composer?.thinking ? '' : 'no effort chips on composer', true);

  await pageEval(wc, () => {
    const ta = document.querySelector('[data-composer-card] textarea');
    if (!ta) return false;
    ta.focus();
    return dshSetValue(ta, '$fo');
  });
  await sleep(500);
  const skillMenu = await pageEval(wc, () => ({
    foo: Boolean(dshFind('foo-skill')),
    menuitem: Boolean(document.querySelector('[role="menuitem"]') && dshShown(document.querySelector('[role="menuitem"]'))),
    typed: (document.querySelector('[data-composer-card] textarea') || {}).value || '',
  }));
  rec(
    'composer.skillMenuAbsent',
    !skillMenu?.foo && skillMenu?.typed === '$fo',
    skillMenu?.foo
      ? 'foo-skill menu opened'
      : `typed=${skillMenu?.typed || ''}; menuitem=${Boolean(skillMenu?.menuitem)}`,
  );

  await pageEval(wc, () => {
    const ta = document.querySelector('[data-composer-card] textarea');
    if (!ta) return false;
    ta.focus();
    return dshSetValue(ta, '@');
  });
  await sleep(700);
  const pathSource = await pageEval(wc, () => ({
    pathRows: document.querySelectorAll('[data-source="path"]').length,
    typed: (document.querySelector('[data-composer-card] textarea') || {}).value || '',
  }));
  rec(
    'composer.pathSourceAbsent',
    pathSource?.pathRows === 0,
    pathSource?.pathRows
      ? `desktop path source rows=${pathSource.pathRows}`
      : `typed=${pathSource?.typed || ''}`,
  );
  await pageEval(wc, () => {
    const ta = document.querySelector('[data-composer-card] textarea');
    return ta ? dshSetValue(ta, '') : false;
  });

  const remoteSnap = typeof helpers.probeRemote === 'function'
    ? await helpers.probeRemote()
    : null;
  rec(
    'remote.available',
    remoteSnap != null && remoteSnap.available === false && remoteSnap.enabled === false,
    remoteSnap ? summarizeRemoteQaDetail(remoteSnap) : 'helpers.probeRemote missing',
  );
  rec(
    'remote.notListening',
    remoteSnap != null && remoteSnap.listening !== true,
    remoteSnap ? `listening=${remoteSnap.listening}` : 'helpers.probeRemote missing',
  );
  const remoteFooter = await pageEval(wc, () => {
    const trigger = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
    if (trigger && dshShown(trigger)) return 'trigger';
    return dshFind('^remote$|^远程$') ? 'label' : null;
  });
  rec('remote.footerPresent', remoteFooter == null, remoteFooter || 'parked hidden');

  const commandsClicked = await clickNamed(wc, '^commands$|^命令$');
  if (commandsClicked) {
    const menu = await waitUntil(() => pageEval(wc, () =>
      Boolean(document.querySelector('[role="listbox"], [role="menu"]'))), 3_000);
    rec('composer.commandsMenu', Boolean(menu), menu ? 'opened' : 'no menu', true);
    await dismiss();
  } else {
    rec('composer.commandsMenu', true, 'commands disabled or missing', true);
  }

  const titlebar = await pageEval(wc, () => {
    const bar = document.querySelector('#dshd-shell-titlebar-trailing');
    return {
      sessionLog: Boolean(dshFind('session log|会话日志', bar)),
      branch: Boolean(dshFind('switch branch|切换分支', bar)),
      commit: Boolean(dshFind('^commit|提交', bar)),
      git: Boolean(dshFind('git actions|git 操作', bar)),
      terminal: Boolean(dshFind('terminal|终端', bar)),
      surfaces: Boolean(dshFind('right panel|surfaces|右侧栏', bar)),
    };
  });
  rec('titlebar.sessionLog', titlebar?.sessionLog, '');
  rec('titlebar.branch', titlebar?.branch, '');
  rec('titlebar.commit', titlebar?.commit, '');
  rec('titlebar.git', titlebar?.git, '');
  rec('titlebar.terminal', titlebar?.terminal, '');
  rec('titlebar.surfaces', titlebar?.surfaces, '');
  const windowControls = await pageEval(wc, () => {
    const host = document.getElementById('dshd-shell-controls');
    if (!host) return null;
    return {
      min: Boolean(host.querySelector('[data-act="minimize"]')),
      max: Boolean(host.querySelector('[data-act="maximize"]')),
      close: Boolean(host.querySelector('[data-act="close"]')),
    };
  });
  rec(
    'titlebar.windowControls',
    Boolean(windowControls?.min && windowControls?.max && windowControls?.close),
    windowControls ? '' : 'injected window-control plate missing',
  );

  await helpers.clickTitlebarButton(wc, 'switch branch|切换分支');
  const branchMenu = await waitUntil(() => pageEval(wc, () => {
    const bar = document.querySelector('#dshd-shell-titlebar-trailing');
    const btn = bar && dshFind('switch branch|切换分支', bar);
    return Boolean((btn && btn.getAttribute('aria-expanded') === 'true') || document.querySelector('[role="menu"]'));
  }), 5_000);
  rec('titlebar.branchMenu', Boolean(branchMenu), branchMenu ? 'opened' : 'did not open');
  await dismiss();

  await helpers.clickTitlebarButton(wc, 'git actions|git 操作');
  const gitMenu = await waitUntil(() => pageEval(wc, () => Boolean(document.querySelector('[role="menu"]'))), 5_000);
  rec('titlebar.gitMenu', Boolean(gitMenu), gitMenu ? 'opened' : 'did not open');
  await dismiss();
  const drawerOpen = await pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
  });
  if (!drawerOpen) {
    await helpers.clickTitlebarButton(wc, helpers.terminalPattern);
  }
  const drawer = await waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    if (!root || !dshShown(root) || root.getBoundingClientRect().height < 8) return null;
    return {
      newTerminal: Boolean(dshFind('new terminal|新建终端', root)),
    };
  }), 10_000);
  rec('terminal.drawer', Boolean(drawer), drawer ? '' : 'drawer did not open');
  rec('terminal.new', Boolean(drawer?.newTerminal), '');
  if (drawer) {
    await helpers.clickTitlebarButton(wc, helpers.terminalPattern);
    await sleep(250);
  }

  const surfacesOpen = await pageEval(wc, () => {
    const frameEl = document.querySelector('[class*="frame"]');
    return Boolean(frameEl && frameEl.getAttribute('data-surfaces-collapsed') !== 'true');
  });
  if (!surfacesOpen) {
    await helpers.clickTitlebarButton(wc, helpers.surfacesPattern);
  }
  const surfaces = await waitUntil(() => pageEval(wc, () => {
    const frameEl = document.querySelector('[class*="frame"]');
    if (!frameEl || frameEl.getAttribute('data-surfaces-collapsed') === 'true') return null;
    const empty = document.querySelector('[data-surfaces-empty]');
    const cards = empty && dshShown(empty)
      ? Array.from(empty.querySelectorAll('button')).map((el) => ({
        label: dshLabel(el).slice(0, 60),
        disabled: el.disabled,
      }))
      : [];
    return { empty: Boolean(empty && dshShown(empty)), cards };
  }), 10_000);
  rec('surfaces.open', Boolean(surfaces), surfaces ? '' : 'surfaces column stayed collapsed');

  if (surfaces?.empty) {
    const labels = (surfaces.cards || []).map((c) => c.label).join(' | ');
    const enabled = (re) => (surfaces.cards || []).some((c) => re.test(c.label) && !c.disabled);
    rec('surfaces.emptyCards', (surfaces.cards || []).length >= 5, labels, true);
    rec('surfaces.browserEnabled', enabled(/browser|浏览器/i), '', true);
    rec('surfaces.diffEnabled', enabled(/diff|差异/i), '', true);
    const clickedFiles = await pageEval(wc, () => {
      const empty = document.querySelector('[data-surfaces-empty]');
      const btn = empty && Array.from(empty.querySelectorAll('button')).find((el) =>
        /^(files|文件)(\s|$)/i.test(dshLabel(el)) && !el.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clickedFiles) await openSurface('files');
  } else {
    rec('surfaces.emptyCards', true, 'already occupied', true);
    rec('surfaces.browserEnabled', true, 'already occupied', true);
    rec('surfaces.diffEnabled', true, 'already occupied', true);
    await openSurface('files');
  }

  const files = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-files-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    const readme = /README\.md/i.test(text);
    const note = /note\.md/i.test(text);
    if (!readme && !note) return null;
    return {
      search: Boolean(dshFind('search files|搜索文件', panel)),
      readme,
      note,
      text: text.slice(0, 160),
    };
  }), 20_000);
  const filesSnap = files || await pageEval(wc, () => {
    const panel = document.querySelector('[data-files-panel]');
    if (!panel) return null;
    const text = panel.innerText || '';
    return {
      search: Boolean(dshFind('search files|搜索文件', panel)),
      readme: /README\.md/i.test(text),
      note: /note\.md/i.test(text),
      text: text.slice(0, 160),
    };
  });
  rec('files.panel', Boolean(filesSnap), filesSnap ? '' : 'files panel missing');
  const tabClose = await pageEval(wc, () => {
    const tab = document.querySelector('[data-surfaces-tab]');
    if (!tab) return null;
    const buttons = Array.from(tab.querySelectorAll('button'));
    const close = buttons.find((el) => /关闭|close/i.test(el.getAttribute('aria-label') || ''));
    const label = buttons.find((el) => el !== close);
    if (!label || !close) return null;
    const labelBox = label.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    return {
      closeRight: closeBox.left >= labelBox.right - 1,
      labelLeft: Math.round(labelBox.left),
      closeLeft: Math.round(closeBox.left),
    };
  });
  rec(
    'files.tabCloseRight',
    Boolean(tabClose?.closeRight),
    tabClose ? `label=${tabClose.labelLeft} close=${tabClose.closeLeft}` : 'tab close control missing',
  );
  rec('files.search', Boolean(filesSnap?.search), '');
  rec('files.readme', Boolean(filesSnap?.readme), filesSnap?.readme ? '' : (filesSnap?.text || 'README.md not listed'));
  rec('files.note', Boolean(filesSnap?.note), filesSnap?.note ? '' : (filesSnap?.text || 'note.md not listed'));
  const mention = filesSnap
    ? await waitUntil(() => pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      return panel && dshFind('mention in composer|引用到输入框', panel);
    }), 10_000)
    : null;
  rec('files.mentionVisible', Boolean(mention), mention ? 'visible' : 'mention control missing');
  if (mention) {
    await pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      if (!panel) return false;
      const row = Array.from(panel.querySelectorAll('li')).find((el) =>
        dshShown(el) && /^note\.md$/i.test((el.querySelector('span') && el.querySelector('span').textContent) || dshLabel(el)));
      const btn = (row && dshFind('mention in composer|引用到输入框', row))
        || dshFind('mention in composer|引用到输入框', panel);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    const draft = await waitUntil(() => pageEval(wc, () => {
      const ta = document.querySelector('[data-composer-card] textarea');
      const value = (ta && ta.value) || '';
      return /\[note\.md\]\(note\.md\)/.test(value) ? value : null;
    }), 5_000);
    rec('files.mentionAppended', Boolean(draft), draft || 'composer draft missing markdown link');
  } else {
    rec('files.mentionAppended', false, 'mention control missing');
  }

  await dismiss();
  const beforeSubject = gitHeadSubject(helpers.workspacePath);
  await helpers.clickTitlebarButton(wc, '^commit$|^提交$');
  await clickNamed(wc, '^commit changes$|^提交更改$|^commit$');
  const commitDialog = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialogNamed('commit changes|提交更改');
    if (!dialog || !dshShown(dialog)) return null;
    return {
      message: Boolean(dialog.querySelector('textarea')),
      submit: Boolean(dshFind('^commit$|^提交$', dialog)),
    };
  }), 8_000);
  rec('git.commitDialog', Boolean(commitDialog), commitDialog ? '' : 'commit dialog did not open', true);
  if (commitDialog?.message) {
    await pageEval(wc, () => {
      const dialog = dshDialogNamed('commit changes|提交更改');
      const ta = dialog && dialog.querySelector('textarea');
      if (!ta) return false;
      ta.focus();
      return dshSetValue(ta, 'qa: commit note.md');
    });
  }
  if (commitDialog?.submit) {
    await clickNamed(wc, '^commit$|^提交$', '[role="dialog"]');
  }
  const committed = await waitUntil(() => {
    const subject = gitHeadSubject(helpers.workspacePath);
    return subject && subject !== beforeSubject ? subject : null;
  }, 20_000);
  rec('git.commit', Boolean(committed), committed || `HEAD still ${beforeSubject || 'empty'}`);
  await dismiss();

  if (filesSnap?.search) {
    await pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      const input = panel && (dshFind('search files|搜索文件', panel) || panel.querySelector('input'));
      if (!input) return false;
      input.focus();
      return dshSetValue(input, 'note');
    });
    const filtered = await waitUntil(() => pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      return Boolean(panel && /note\.md/i.test(panel.innerText || ''));
    }), 8_000);
    rec('files.searchFilter', Boolean(filtered), filtered ? 'note.md' : 'filter missed note.md', true);
  }

  await openSurface('agents');
  const agents = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-agents-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    return { empty: /no agents yet|还没有子代理/i.test(text) };
  }), 10_000);
  rec('agents.panel', Boolean(agents), '');
  rec('agents.empty', Boolean(agents?.empty), agents?.empty ? '' : 'empty copy missing');

  await openSurface('diff');
  const diff = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-diff-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    if (/差异仅适用于|only available in Git/i.test(text)) return null;
    return { text: text.slice(0, 120) };
  }), 12_000);
  const diffSnap = diff || await pageEval(wc, () => {
    const panel = document.querySelector('[data-diff-panel]');
    return panel && dshShown(panel) ? { text: (panel.innerText || '').slice(0, 120) } : null;
  });
  rec('diff.panel', Boolean(diffSnap) && !/差异仅适用于|only available in Git/i.test(diffSnap?.text || ''), diffSnap?.text || '');

  await openSurface('preview');
  const browser = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-preview-panel]');
    if (!panel || !dshShown(panel)) return null;
    const unavailable = panel.querySelector('[data-preview-unavailable]');
    const toolbar = panel.querySelector('[data-preview-toolbar]');
    const url = Boolean(
      dshFind('search or enter url|搜索或输入 url', panel)
      || panel.querySelector('input'),
    );
    return {
      unavailable: Boolean(unavailable && dshShown(unavailable)),
      toolbar: Boolean(toolbar && dshShown(toolbar)),
      url,
    };
  }), 10_000);
  rec('browser.panel', Boolean(browser) && !browser.unavailable, browser?.unavailable ? 'preview unavailable' : '');
  rec('browser.url', Boolean(browser?.url || browser?.toolbar), '');

  await openSurface('terminal');
  const termSurface = await waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="surface"]');
    return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
  }), 10_000);
  rec('terminal.surface', Boolean(termSurface), '');

  await dismiss();
  const settingsTrigger = await pageEval(wc, () =>
    Boolean(document.querySelector('[data-dsh-settings-trigger]')));
  rec('settings.trigger', settingsTrigger, '');

  const appearanceOpened = await openSettings('appearance');
  const appearance = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    if (!dialog) return null;
    const nav = document.querySelector('[data-dsh-settings-section="appearance"]');
    const text = dialog.innerText || '';
    return {
      nav: Boolean(nav),
      heading: Boolean(dshHeading('wallpaper|背景图', dialog)),
      choose: Boolean(dshFind('choose image|选择图片', dialog)),
      browse: Boolean(dshFind('browse gallery|浏览图库', dialog)),
      bingDaily: /Bing daily wallpapers|Bing 每日壁纸/.test(text),
      catalogUrls: /Wallpaper catalog URLs|壁纸目录地址/.test(text),
      placeholder: Boolean(dialog.querySelector('input[placeholder="https://example.com/wallpapers.json"]')),
    };
  }), 10_000);
  rec('appearance.choose', Boolean(appearanceOpened && appearance?.choose), appearanceOpened ? '' : 'settings did not open');
  rec('appearance.browse', Boolean(appearance?.browse), '');
  rec(
    'appearance.noSourceDump',
    Boolean(appearance) && !appearance.bingDaily && !appearance.catalogUrls && !appearance.placeholder,
    appearance?.bingDaily || appearance?.catalogUrls || appearance?.placeholder
      ? 'Appearance still lists gallery sources'
      : '',
  );

  const lightClicked = await clickNamed(wc, '^浅色$|^light$');
  await sleep(250);
  const darkClicked = await clickNamed(wc, '^深色$|^dark$');
  await sleep(250);
  const scheme = await pageEval(wc, () => {
    const dialog = dshDialog();
    const pressed = dialog
      ? Array.from(dialog.querySelectorAll('[aria-pressed="true"]')).map((el) => dshLabel(el)).slice(0, 4)
      : [];
    return { light: Boolean(dshFind('^浅色$|^light$', dialog)), dark: Boolean(dshFind('^深色$|^dark$', dialog)), pressed };
  });
  rec(
    'appearance.themeSwitch',
    Boolean(lightClicked && darkClicked && scheme?.dark),
    `light=${lightClicked}; dark=${darkClicked}; pressed=${(scheme?.pressed || []).join(',')}`,
  );

  const localPicked = await pageEval(wc, () => {
    const dialog = dshDialog();
    const input = dialog && dialog.querySelector('input[type="file"][accept*="image"]');
    if (!input) return false;
    return dshAssignFile(input, dshQaPngFile());
  });
  const cropOpened = localPicked
    ? await waitUntil(() => pageEval(wc, () => Boolean(dshDialogNamed('调整背景图|adjust wallpaper|crop wallpaper|crop'))), 8_000)
    : false;
  if (cropOpened) {
    await clickNamed(wc, '使用此图片|use this image|^use$');
  }
  const frostAfterLocal = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    return dialog && dshFind('毛玻璃|frosted glass', dialog) ? true : null;
  }), 8_000);
  rec(
    'appearance.localCrop',
    Boolean(localPicked && (cropOpened || frostAfterLocal)),
    localPicked ? (cropOpened ? 'crop confirmed' : (frostAfterLocal ? 'sliders without crop dialog' : 'file assigned, crop missing')) : 'file input missing',
  );

  if (appearance?.browse) {
    await clickNamed(wc, 'browse gallery|浏览图库');
  }
  const gallery = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    if (!galleryDialog) return null;
    return {
      sources: Boolean(dshFind('^sources$|^图源$', galleryDialog)),
      items: (galleryDialog.innerText || '').slice(0, 80),
    };
  }), 15_000);
  rec('gallery.dialog', Boolean(gallery), gallery ? '' : 'browse gallery dialog missing');
  rec('gallery.sources', Boolean(gallery?.sources), gallery?.sources ? '' : 'Sources missing — wallpaper shell inject?');

  if (gallery?.sources) {
    await clickNamed(wc, '^sources$|^图源$');
    const sourcesPane = await waitUntil(() => pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      if (!galleryDialog) return null;
      return {
        addSource: Boolean(dshFind('add source|新增图源', galleryDialog)),
        hint: /Categories come from here|分类来自这里/i.test(galleryDialog.innerText || ''),
      };
    }), 8_000);
    rec('gallery.addSource', Boolean(sourcesPane?.addSource), sourcesPane?.hint ? 'hint visible' : '');
    await clickNamed(wc, 'back to gallery|返回图库');
    await sleep(300);
  } else {
    rec('gallery.addSource', false, 'sources control missing');
  }

  await clickNamed(wc, 'wallhaven|Wallhaven');
  const wallhaven = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    if (!galleryDialog) return null;
    const text = galleryDialog.innerText || '';
    return {
      tab: /wallhaven/i.test(text),
      sfw: Boolean(dshFind('常规|general', galleryDialog)),
      r18: /R18|NSFW|purity/i.test(text),
    };
  }), 8_000);
  rec(
    'gallery.wallhavenSfw',
    Boolean(wallhaven?.tab || wallhaven?.sfw) && !wallhaven?.r18,
    wallhaven?.r18 ? 'R18/NSFW copy present' : (wallhaven?.sfw ? 'SFW chips' : 'Wallhaven tab missing'),
  );

  await clickNamed(wc, '^必应$|^bing$');
  const thumbReady = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    const img = galleryDialog && galleryDialog.querySelector('img');
    const btn = img && img.closest('button');
    return btn && !btn.disabled && dshShown(btn) ? true : null;
  }), 35_000);
  if (thumbReady) {
    await pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      const star = galleryDialog && dshFind('收藏这张|favorite this image', galleryDialog);
      if (star) star.click();
      const card = galleryDialog && galleryDialog.querySelector('button img');
      const btn = card && card.closest('button');
      if (btn && !btn.disabled) btn.click();
      return Boolean(btn);
    });
    const confirm = await waitUntil(() => pageEval(wc, () =>
      Boolean(dshDialogNamed('将这张图设为背景|set this image as the wallpaper'))), 8_000);
    if (confirm) {
      await clickNamed(wc, '设为壁纸|set wallpaper');
    }
    const cropAfterGallery = await waitUntil(() => pageEval(wc, () =>
      Boolean(dshDialogNamed('调整背景图|adjust wallpaper|crop wallpaper|crop'))), 20_000);
    if (cropAfterGallery) {
      await clickNamed(wc, '使用此图片|use this image|^use$');
    }
    rec(
      'gallery.confirmSet',
      Boolean(confirm && (cropAfterGallery || frostAfterLocal)),
      confirm ? (cropAfterGallery ? 'Bing confirmed and cropped' : 'Bing confirmed') : 'confirm dialog missing',
    );
  } else {
    const status = await pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      const node = galleryDialog && galleryDialog.querySelector('[role="status"]');
      return node ? String(node.textContent || '').slice(0, 120) : 'no status';
    });
    rec('gallery.confirmSet', false, `Bing thumbnails did not load (${status || 'empty'})`);
  }

  await dismiss();
  await sleep(400);
  await openSettings('appearance');
  const frost = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    return dialog && dshFind('毛玻璃|frosted glass', dialog) && dshFind('像素化|pixelation', dialog) ? true : null;
  }), 8_000);
  rec('appearance.frost', Boolean(frost || frostAfterLocal), frost ? 'frost+pixelate after wallpaper' : (frostAfterLocal ? 'frost after local crop' : 'sliders missing'));

  await dismiss();
  await sleep(300);

  const modelsOpened = await openSettings('models');
  const models = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    if (!dialog) return null;
    const text = dialog.innerText || '';
    return {
      heading: Boolean(dshHeading('^models$|^模型$', dialog) || /模型|models/i.test(text)),
      customAdd: Boolean(dshFind('add a custom provider|添加自定义提供方', dialog)),
      vision: Boolean(dshFind('vision model|识图模型', dialog)),
      thinking: /supported thinking intensity|思考强度/i.test(text),
    };
  }), 10_000);
  rec('models.heading', Boolean(modelsOpened && models?.heading), modelsOpened ? '' : 'models section missing');
  rec('models.customAdd', Boolean(models?.customAdd), models?.customAdd ? '' : 'custom provider control missing');
  rec('models.visionPicker', Boolean(models?.vision), models?.vision ? '' : 'vision fallback picker missing');
  rec('models.thinking', Boolean(models?.thinking), models?.thinking ? '' : 'thinking intensity editor not shown', true);

  let customFormOk = false;
  if (models?.customAdd) {
    await clickNamed(wc, 'add a custom provider|添加自定义提供方');
    const form = await waitUntil(() => pageEval(wc, () => {
      const dialog = dshDialog();
      return dialog && dshField('^provider id$', dialog) ? true : null;
    }), 8_000);
    if (form) {
      const filled = {
        route: await typeIntoAriaField(wc, '^provider id$', 'dshdqa'),
        name: await typeIntoAriaField(wc, '^显示名称$|^display name$', 'Dshd QA'),
        url: await typeIntoAriaField(wc, '^api 地址$|^base url$', 'https://ayase.cn/v1'),
        key: await typeIntoAriaField(wc, '^api 密钥$|^api key$', 'sk-dshd-qa-placeholder'),
      };
      await pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        const btn = card && dshFind('add model|添加模型', card);
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      });
      const modelField = await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        return card && dshField('^模型 ID 1$|^Model ID 1$', card) ? true : null;
      }), 8_000);
      const modelFilled = modelField
        ? await typeIntoAriaField(wc, '^模型 ID 1$|^Model ID 1$', 'grok-4.6')
        : false;
      const createReady = await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        const btn = card && dshFind('创建提供方|create provider', card);
        return btn && !btn.disabled ? true : null;
      }), 8_000);
      if (createReady) {
        await pageEval(wc, () => {
          const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
          const card = dialog && dshCustomProviderCard(dialog);
          const btn = card && dshFind('创建提供方|create provider', card);
          if (!btn || btn.disabled) return false;
          btn.click();
          return true;
        });
      }
      const saved = await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialog();
        const text = dialog ? (dialog.innerText || '') : '';
        if (/sk-dshd-qa-placeholder/.test(text)) return { leak: true };
        if (/dshdqa|Dshd QA/i.test(text) && /credential configured|已配置|api key configured/i.test(text)) {
          return { saved: true };
        }
        return /dshdqa|Dshd QA/i.test(text) ? { listed: true } : null;
      }), 12_000);
      customFormOk = Boolean(saved && !saved.leak && (saved.saved || saved.listed));
      const inventory = customFormOk ? '' : await pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        return JSON.stringify(dshInputInventory(card || dialog));
      });
      const fillDetail = `route=${filled?.route} name=${filled?.name} url=${filled?.url} key=${filled?.key} model=${Boolean(modelFilled)} createReady=${Boolean(createReady)}`;
      rec(
        'models.customForm',
        customFormOk,
        saved?.leak ? 'key echoed' : (customFormOk ? 'provider saved without plaintext key' : `form did not persist dshdqa (${fillDetail}) ${inventory || ''}`.slice(0, 400)),
      );
    } else {
      rec('models.customForm', false, 'custom provider form did not open');
    }
  } else {
    rec('models.customForm', false, 'custom add missing');
  }

  const mcpOpened = await openSettings('mcp');
  const mcp = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    if (!dialog) return null;
    return {
      heading: Boolean(dshHeading('mcp servers|mcp 服务器', dialog)),
      search: Boolean(dshFind('search name|搜索名称', dialog) || dialog.querySelector('input[type="search"], [role="searchbox"]')),
      add: Boolean(dshFind('add server|添加服务器', dialog)),
    };
  }), 10_000);
  rec('mcp.heading', Boolean(mcpOpened && mcp?.heading), mcpOpened ? '' : 'mcp section missing');
  rec('mcp.search', Boolean(mcp?.search), '');
  rec('mcp.add', Boolean(mcp?.add), '');

  const skillsOpened = await openSettings('skills');
  const skills = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    if (!dialog) return null;
    return {
      heading: Boolean(dshHeading('^skills$|^技能$', dialog)),
      add: Boolean(dshFind('add skill|添加技能', dialog)),
    };
  }), 10_000);
  rec('skills.heading', Boolean(skillsOpened && skills?.heading), '');
  rec('skills.add', Boolean(skills?.add), '');

  const pluginsOpened = await openSettings('plugins');
  const plugins = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    const nav = document.querySelector('[data-dsh-settings-section="plugins"]');
    return {
      nav: Boolean(nav && nav.getAttribute('aria-current') === 'true'),
      heading: Boolean(dialog && dshHeading('^plugins$|^插件$', dialog)),
    };
  }), 10_000);
  rec('plugins.heading', Boolean(pluginsOpened && (plugins?.heading || plugins?.nav)), '');

  const marketOpened = await openSettings('market');
  const market = await waitUntil(() => pageEval(wc, () => {
    const nav = document.querySelector('[data-dsh-settings-section="market"]');
    const dialog = dshDialog();
    const text = dialog ? (dialog.innerText || '') : '';
    return {
      nav: Boolean(nav && (nav.getAttribute('aria-current') === 'true' || dshShown(nav))),
      discover: /discover|发现/i.test(text),
    };
  }), 10_000);
  rec('market.section', Boolean(marketOpened && market?.nav), marketOpened ? '' : 'market section missing');
  rec('market.discover', Boolean(market?.discover), '');

  // The installed truth comes from the profile manifest (main process), not
  // from scraping the async Installed list: the list fetch can land after
  // the scrape and must not flip the two-state gate.
  let dshbotInstalled = false;
  try {
    const { listInstalledPlugins } = require('./plugins');
    const profile = listInstalledPlugins();
    dshbotInstalled = (profile.plugins || []).some((row) => row.name === 'dshbot')
      || (profile.bundles || []).includes('dshbot');
  } catch {
    // Unreadable profile counts as not installed; the tab checks stay strict.
  }

  // The tab label grows a count suffix once anything is installed
  // (「已安装 (1)」), so the click pattern must not anchor on the bare label.
  await clickNamed(wc, '^(installed|已安装)( \\(\\d+\\))?$');
  const installed = await waitUntil(() => pageEval(wc, (expectDshbot) => {
    const dialog = dshDialog();
    if (!dialog) return null;
    const text = dialog.innerText || '';
    const dshbot = /\bdshbot\b/i.test(text);
    // The Installed pane is open once its content rendered: the empty-state
    // copy, the ungrouped section, or an actual row. When the profile says
    // dshbot is installed, keep polling until the async list shows the row.
    const paneOpen = /还没有装过社区插件|No community plugins yet|未分组|Ungrouped/i.test(text) || dshbot;
    if (!paneOpen) return null;
    if (expectDshbot && !dshbot) return null;
    return { dshbot };
  }, dshbotInstalled), 10_000);
  rec('market.installed', Boolean(installed), installed ? '' : 'Installed tab missing');
  rec(
    'plugin.dshbot.market',
    dshbotInstalled ? Boolean(installed?.dshbot) : true,
    installed?.dshbot
      ? 'standalone dshbot listed on Installed'
      : (dshbotInstalled
        ? 'dshbot installed but missing from the Installed list'
        : 'standalone plugin, not installed on this profile'),
    true,
  );

  const usageOpened = await openSettings('usage-stats');
  const usage = await waitUntil(() => pageEval(wc, () => {
    const nav = document.querySelector('[data-dsh-settings-section="usage-stats"]');
    return {
      nav: Boolean(nav && (nav.getAttribute('aria-current') === 'true' || dshShown(nav))),
    };
  }), 10_000);
  rec('usage-stats.section', Boolean(usageOpened && usage?.nav), usageOpened ? '' : 'usage-stats section missing');

  await dismiss();
  await sleep(300);

  // dshbot is a standalone plugin: the Bots tab may only exist when the
  // profile actually has dshbot installed (profile manifest above).
  const botsTab = await pageEval(wc, () => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) =>
      dshShown(el) && /(bots|机器人)/i.test(dshLabel(el)));
    return Boolean(tab);
  });
  rec(
    'plugin.dshbot.tabAbsent',
    dshbotInstalled ? true : !botsTab,
    botsTab && !dshbotInstalled ? 'bots tab visible without a dshbot install' : '',
  );
  rec(
    'plugin.dshbot.page',
    dshbotInstalled ? botsTab : !botsTab,
    dshbotInstalled
      ? (botsTab ? 'installed dshbot shows the Bots tab' : 'dshbot installed but Bots tab missing')
      : 'not installed; tab absent',
    true,
  );
  } catch (error) {
    rec('walk.uncaught', false, error && error.stack ? error.stack : String(error));
  }

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return {
    ok: failed.length === 0,
    failed,
    steps,
  };
}

/**
 * Fail a QA run when required assembled-UI steps did not pass.
 *
 * @param {{ qa?: { ok?: boolean, failed?: string[], steps?: Array<{ name: string, ok: boolean, optional?: boolean, detail?: string }> } }} result
 */
function assertReleaseQaResult(result) {
  const qa = result?.qa;
  if (!qa || qa.ok !== true) {
    const failed = (qa?.failed && qa.failed.length > 0)
      ? qa.failed
      : (qa?.steps || []).filter((s) => !s.ok && !s.optional).map((s) => `${s.name}: ${s.detail || ''}`);
    throw new Error(`Release QA failed:\n${failed.join('\n')}\n${JSON.stringify(qa)}`);
  }
  const names = new Set((qa.steps || []).map((s) => s.name));
  const missing = QA_REQUIRED_STEPS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Release QA omitted required steps: ${missing.join(', ')}`);
  }
}

module.exports = {
  runReleaseUiWalk,
  connectConfiguredWorkspace,
  makeRecorder,
  assertReleaseQaResult,
  QA_REQUIRED_STEPS,
  PAGE_HELPERS,
  summarizeRemoteQaDetail,
};
