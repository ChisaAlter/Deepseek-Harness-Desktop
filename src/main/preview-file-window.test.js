'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FILE_PREVIEW_STATE_CHANNEL,
  previewFileKind,
  createFilePreviewWindowController,
} = require('./preview-file-window.js');

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

function fakeWindow() {
  const calls = [];
  let destroyed = false;
  let onClosed = null;
  const webContents = {
    setWindowOpenHandler(handler) { calls.push(['window-open-handler', handler({})]); },
  };
  return {
    calls,
    webContents,
    isDestroyed: () => destroyed,
    setMenuBarVisibility(value) { calls.push(['menu', value]); },
    setAlwaysOnTop(value, level) { calls.push(['top', value, level]); },
    setTitle(value) { calls.push(['title', value]); },
    setBackgroundColor(value) { calls.push(['background', value]); },
    once(event, handler) { if (event === 'closed') onClosed = handler; },
    async loadFile(value) { calls.push(['load', value]); },
    showInactive() { calls.push(['showInactive']); },
    close() {
      destroyed = true;
      calls.push(['close']);
      onClosed?.();
    },
  };
}

test('previewFileKind separates browser-native media and text fallback', () => {
  assert.equal(previewFileKind('image.PNG'), 'image');
  assert.equal(previewFileKind('clip.webm'), 'video');
  assert.equal(previewFileKind('sound.mp3'), 'audio');
  assert.equal(previewFileKind('doc.pdf'), 'pdf');
  assert.equal(previewFileKind('index.html'), 'html');
  assert.equal(previewFileKind('src/main.ts'), 'text');
});

test('file preview opens one always-on-top window and exposes state only to that renderer', async () => {
  const ipcMain = fakeIpcMain();
  const windows = [];
  const reads = [];
  const controller = createFilePreviewWindowController({
    ipcMain,
    workspacePreview: {
      async fileUrl(input) {
        return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
      },
    },
    async readFile(cwd, relativePath) {
      reads.push([cwd, relativePath]);
      return { ok: true, text: 'const value = 1;', truncated: true };
    },
    createWindow(options) {
      const win = fakeWindow();
      win.options = options;
      windows.push(win);
      return win;
    },
    getTheme: () => ({ scheme: 'dark' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: 'preview.html',
    platform: 'win32',
  });

  assert.deepEqual(await controller.open({ cwd: 'C:/repo', relativePath: 'src/main.ts' }), { ok: true });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.alwaysOnTop, true);
  assert.equal(windows[0].options.skipTaskbar, true);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.deepEqual(reads, [['C:/repo', 'src/main.ts']]);
  assert.ok(windows[0].calls.some(call => call[0] === 'showInactive'));

  const stateHandler = ipcMain.handlers.get(FILE_PREVIEW_STATE_CHANNEL);
  assert.deepEqual(await stateHandler({ sender: windows[0].webContents }), {
    kind: 'text',
    name: 'main.ts',
    relativePath: 'src/main.ts',
    url: 'http://127.0.0.1:9/token/src/main.ts',
    text: 'const value = 1;',
    truncated: true,
    message: null,
    locale: 'en',
    scheme: 'dark',
  });
  assert.throws(() => stateHandler({ sender: {} }), { code: 'ERR_DSH_IPC_SENDER' });

  await controller.open({ cwd: 'C:/repo', relativePath: 'image.png' });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].calls.filter(call => call[0] === 'load').length, 2);
  assert.equal((await stateHandler({ sender: windows[0].webContents })).kind, 'image');
  await controller.close();
  assert.ok(windows[0].calls.some(call => call[0] === 'close'));
});

test('binary text fallback opens an explicit unsupported state', async () => {
  const ipcMain = fakeIpcMain();
  const win = fakeWindow();
  const controller = createFilePreviewWindowController({
    ipcMain,
    workspacePreview: { fileUrl: async () => ({ ok: true, url: 'http://127.0.0.1:9/token/data.bin' }) },
    readFile: async () => ({ ok: true, binary: true }),
    createWindow: () => win,
    getTheme: () => ({ scheme: 'light' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: 'preview.html',
  });
  await controller.open({ cwd: '/repo', relativePath: 'data.bin' });
  const state = await ipcMain.handlers.get(FILE_PREVIEW_STATE_CHANNEL)({ sender: win.webContents });
  assert.equal(state.kind, 'unsupported');
  assert.match(state.message, /binary file/);
});
