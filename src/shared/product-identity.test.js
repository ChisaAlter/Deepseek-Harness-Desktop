'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PRODUCT_NAME,
  LEGACY_DESKTOP_USER_DATA,
  LEGACY_LAUNCHER_USER_DATA,
  preserveUserDataPath,
} = require('./product-identity');

test('public rename retains both existing Electron data directories', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-isle-identity-'));
  try {
    const setPaths = [];
    const app = {
      getPath: (key) => key === 'appData' ? appData : path.join(appData, PRODUCT_NAME),
      setPath: (key, value) => setPaths.push([key, value]),
    };
    const desktop = preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA, []);
    const launcher = preserveUserDataPath(app, LEGACY_LAUNCHER_USER_DATA, []);
    assert.equal(desktop, path.join(appData, 'Deepseek-Harness-Desktop'));
    assert.equal(launcher, path.join(appData, 'Deepseek-Harness-Launcher'));
    assert.deepEqual(setPaths, [['userData', desktop], ['userData', launcher]]);
    assert.ok(fs.statSync(desktop).isDirectory());
    assert.ok(fs.statSync(launcher).isDirectory());
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('explicit user-data-dir keeps the caller-selected path', () => {
  const app = {
    getPath: () => 'C:\\custom\\Whale Isle',
    setPath: () => assert.fail('explicit path must not be overridden'),
  };
  assert.equal(preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA, ['--user-data-dir=C:\\custom\\Whale Isle']), 'C:\\custom\\Whale Isle');
});
