'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadFilePreviewPreload() {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('./file-preview.js');
  const cachedElectron = require.cache[electronPath];
  const cachedPreload = require.cache[preloadPath];
  const listeners = new Map();
  let exposed = null;
  const ipcRenderer = {
    invoke: async channel => ({ channel }),
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    emit(channel, payload) { listeners.get(channel)?.({}, payload); },
  };
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      contextBridge: { exposeInMainWorld(name, api) { exposed = { name, api }; } },
      ipcRenderer,
    },
  };
  delete require.cache[preloadPath];
  try {
    require('./file-preview.js');
    return { exposed, ipcRenderer, listeners };
  } finally {
    if (cachedElectron) require.cache[electronPath] = cachedElectron;
    else delete require.cache[electronPath];
    if (cachedPreload) require.cache[preloadPath] = cachedPreload;
    else delete require.cache[preloadPath];
  }
}

test('file preview preload exposes only state and theme methods', async () => {
  const { exposed, ipcRenderer, listeners } = loadFilePreviewPreload();
  assert.equal(exposed?.name, 'filePreview');
  assert.deepEqual(Object.keys(exposed.api).sort(), ['getState', 'onTheme']);
  assert.deepEqual(await exposed.api.getState(), { channel: 'shell:file-preview-state' });
  const themes = [];
  const dispose = exposed.api.onTheme(theme => themes.push(theme));
  ipcRenderer.emit('shell:theme', { scheme: 'dark' });
  assert.deepEqual(themes, [{ scheme: 'dark' }]);
  dispose();
  assert.equal(listeners.has('shell:theme'), false);
});
