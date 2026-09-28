'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForHarnessContents } = require('./client-ready');

test('smoke waits for the actual Harness view instead of inspecting the boot document', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const owner = { webContents: { boot: true } };
  const harness = { isDestroyed: () => false };
  let ready = false;
  const pending = waitForHarnessContents(win => {
    assert.strictEqual(win, owner);
    return ready ? harness : null;
  }, owner, 1000);
  t.mock.timers.tick(200);
  await Promise.resolve();
  ready = true;
  t.mock.timers.tick(200);
  assert.strictEqual(await pending, harness);
});

test('a missing or destroyed Harness view fails instead of falling back to boot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const pending = waitForHarnessContents(() => ({ isDestroyed: () => true }), { webContents: {} }, 1000);
  const rejected = assert.rejects(pending, /Harness WebContents was not created/);
  t.mock.timers.tick(1000);
  await rejected;
});

test('credential-free smoke follows the native welcome key-page and skip controls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { runInNewContext } = require('node:vm');
  let page = 'entry';
  let ready = false;
  const clicks = [];
  const document = { getElementById: id => ({
    disabled: false,
    closest: () => (id === 'api-key' ? page !== 'entry' : page !== 'key') ? {} : null,
    click() { clicks.push(id); if (id === 'api-key') page = 'key'; else ready = true; },
  }) };
  const welcome = {
    isDestroyed: () => false,
    executeJavaScript: async script => runInNewContext(script, { document }),
  };
  const harness = { isDestroyed: () => false };
  const pending = waitForHarnessContents(() => ready ? harness : null, {}, 2000, () => welcome);
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    t.mock.timers.tick(200);
    await Promise.resolve();
  }
  assert.strictEqual(await pending, harness);
  assert.deepEqual(clicks, ['api-key', 'skip-key']);
});
