'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const chromePath = require.resolve('./chrome');

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
  return { filename, previous };
}

function loadChrome() {
  const restoreEntries = [
    stubModule('electron', {
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { on() {}, handle() {} },
      nativeTheme: { shouldUseDarkColors: false, on() {}, off() {} },
    }),
    stubModule('./config', { loadConfig: () => ({}) }),
  ];
  const previousChrome = require.cache[chromePath];
  delete require.cache[chromePath];
  const chrome = require('./chrome');
  return {
    chrome,
    restore() {
      delete require.cache[chromePath];
      if (previousChrome) require.cache[chromePath] = previousChrome;
      for (const { filename, previous } of restoreEntries) {
        if (previous) require.cache[filename] = previous;
        else delete require.cache[filename];
      }
    },
  };
}

test('watchSystemTheme applies the theme on OS updates and unsubscribes cleanly', () => {
  const { chrome, restore } = loadChrome();
  try {
    const theme = new EventEmitter();
    let applied = 0;
    const unsubscribe = chrome.watchSystemTheme({ theme, apply: () => { applied += 1; } });
    theme.emit('updated');
    theme.emit('updated');
    assert.equal(applied, 2);
    unsubscribe();
    theme.emit('updated');
    assert.equal(applied, 2, 'listener must be removed after unsubscribe');
    assert.equal(theme.listenerCount('updated'), 0);
  } finally {
    restore();
  }
});

test('watchSystemTheme is a no-op without a usable nativeTheme', () => {
  const { chrome, restore } = loadChrome();
  try {
    assert.equal(typeof chrome.watchSystemTheme({ theme: null, apply: () => {} }), 'function');
    chrome.watchSystemTheme({ theme: null, apply: () => {} })();
  } finally {
    restore();
  }
});
