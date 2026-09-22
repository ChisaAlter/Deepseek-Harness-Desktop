'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { openDesktopDshHome } = require('./open-dsh-home');

test('openDesktopDshHome opens the bound home and ignores a supplied path', async () => {
  const home = path.join(os.tmpdir(), 'bound-dsh-home');
  const opened = [];
  const result = await openDesktopDshHome({
    getHome: () => home,
    openPath: async (target) => {
      opened.push(target);
      return '';
    },
    pathFromRenderer: 'C:\\evil\\from-renderer',
  });
  assert.deepEqual(opened, [home]);
  assert.deepEqual(result, { ok: true, path: home });
});

test('openDesktopDshHome does not call openPath when home is unset', async () => {
  const opened = [];
  const result = await openDesktopDshHome({
    getHome: () => '',
    openPath: async (target) => {
      opened.push(target);
      return '';
    },
  });
  assert.deepEqual(opened, []);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /not configured/i);
});

test('openDesktopDshHome returns the shell error string', async () => {
  const result = await openDesktopDshHome({
    getHome: () => path.join(os.tmpdir(), 'missing-dsh-home'),
    openPath: async () => 'ENOENT: missing',
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /ENOENT/);
});
