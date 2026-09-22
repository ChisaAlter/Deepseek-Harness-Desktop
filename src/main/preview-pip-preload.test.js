'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PREVIEW_PIP_FRAME_CHANNEL } = require('./preview-pip-protocol.js');

const leftoverBrand = ['t', '3', 'code'].join('');
const leftoverTools = ['t', '3', 'tools'].join('');
const leftoverCss = `--${['t', '3'].join('')}-`;
const leftoverHyphen = ['T', '3', '-'].join('');
const BRAND = new RegExp(
  [leftoverBrand, leftoverTools, leftoverCss, `data-${leftoverBrand}`, leftoverHyphen].join('|'),
  'i',
);

function loadPipPreload() {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('./preview-pip-preload.js');
  const cachedElectron = require.cache[electronPath];
  const cachedPreload = require.cache[preloadPath];
  const listeners = new Map();
  let exposed = null;
  const ipcRenderer = {
    on(channel, listener) {
      const list = listeners.get(channel) ?? [];
      list.push(listener);
      listeners.set(channel, list);
    },
    removeListener(channel, listener) {
      const list = listeners.get(channel) ?? [];
      listeners.set(channel, list.filter((item) => item !== listener));
    },
    emit(channel, ...args) {
      for (const listener of listeners.get(channel) ?? []) listener({}, ...args);
    },
  };

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      contextBridge: {
        exposeInMainWorld(name, api) {
          exposed = { name, api };
        },
      },
      ipcRenderer,
    },
  };
  delete require.cache[preloadPath];

  try {
    require('./preview-pip-preload.js');
    return { exposed, ipcRenderer };
  } finally {
    if (cachedElectron) require.cache[electronPath] = cachedElectron;
    else delete require.cache[electronPath];
    if (cachedPreload) require.cache[preloadPath] = cachedPreload;
    else delete require.cache[preloadPath];
  }
}

test('pip preload and protocol omit leftover brand markers', () => {
  for (const name of ['preview-pip-preload.js', 'preview-pip-protocol.js']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.doesNotMatch(source, BRAND, name);
  }
});

test('pip preload exposes previewPictureInPicture.onFrame without ipcRenderer', () => {
  const { exposed, ipcRenderer } = loadPipPreload();
  assert.equal(exposed?.name, 'previewPictureInPicture');
  assert.equal(typeof exposed?.api.onFrame, 'function');
  assert.equal(exposed?.api.ipcRenderer, undefined);

  const seen = [];
  const dispose = exposed.api.onFrame((frame) => {
    seen.push(frame);
  });
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, { data: 'abc', width: 1280, height: 720 });
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, null);
  assert.deepEqual(seen, [{ data: 'abc', width: 1280, height: 720 }]);
  dispose();
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, { data: 'dropped' });
  assert.equal(seen.length, 1);
});
