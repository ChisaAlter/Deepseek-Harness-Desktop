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
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1707, height: 920 } }),
      },
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

test('isEffectivelyMaximized treats a work-area-covering transparent window as maximized', () => {
  const { chrome, restore } = loadChrome();
  try {
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 1707, height: 920 }),
    };
    assert.equal(chrome.isEffectivelyMaximized(win), true);
    win.getBounds = () => ({ x: 100, y: 20, width: 1440, height: 920 });
    assert.equal(chrome.isEffectivelyMaximized(win), false);
    win.isMaximized = () => true;
    assert.equal(chrome.isEffectivelyMaximized(win), true);
    win.isMinimized = () => true;
    assert.equal(chrome.isEffectivelyMaximized(win), false);
  } finally {
    restore();
  }
});

test('restorableNormalBounds falls back to a centered default when the tracked rect fills the work area', () => {
  const { chrome, restore } = loadChrome();
  try {
    // A window whose tracked normal bounds already cover the work area (e.g.
    // a small display) must still restore to a real windowed rect, or the
    // maximize button becomes a silent no-op.
    const win = {
      _dshNormalBounds: { x: 0, y: 0, width: 1707, height: 920 },
      getBounds: () => ({ x: 0, y: 0, width: 1707, height: 920 }),
    };
    const restored = chrome.restorableNormalBounds(win);
    assert.equal(restored.width, 1440);
    assert.equal(restored.height, 920);
    assert.equal(restored.x, Math.round((1707 - 1440) / 2));
    assert.equal(restored.y, 0);
    // A tracked rect that does not cover the work area is used as-is.
    win._dshNormalBounds = { x: 40, y: 30, width: 1200, height: 700 };
    assert.deepEqual(chrome.restorableNormalBounds(win), win._dshNormalBounds);
    // No tracked rect at all falls back to the same centered default.
    delete win._dshNormalBounds;
    assert.equal(chrome.restorableNormalBounds(win).width, 1440);
  } finally {
    restore();
  }
});

test('syncHarnessChrome retries the inject after a transient eval rejection', async () => {
  const { chrome, restore } = loadChrome();
  try {
    let calls = 0;
    const win = { isDestroyed: () => false, setBackgroundColor() {} };
    const wc = {
      isDestroyed: () => false,
      getURL: () => 'http://127.0.0.1:3080/',
      executeJavaScript: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('main frame was swapped'))
          : Promise.resolve({ bg: '#112233' });
      },
    };
    await chrome.syncHarnessChrome(win, wc);
    assert.equal(calls, 2, 'one transient rejection must trigger a retry');
  } finally {
    restore();
  }
});

test('syncHarnessChrome stops retrying once the view leaves the harness origin', async () => {
  const { chrome, restore } = loadChrome();
  try {
    let calls = 0;
    const win = { isDestroyed: () => false, setBackgroundColor() {} };
    const wc = {
      isDestroyed: () => false,
      getURL: () => (calls === 0 ? 'http://127.0.0.1:3080/' : 'chrome-error://dead/'),
      executeJavaScript: () => {
        calls += 1;
        return Promise.reject(new Error('frame gone'));
      },
    };
    await chrome.syncHarnessChrome(win, wc);
    assert.equal(calls, 1, 'a non-harness retry target must abort the retry loop');
  } finally {
    restore();
  }
});
