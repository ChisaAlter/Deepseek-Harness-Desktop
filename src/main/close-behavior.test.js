const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CLOSE_TO_TRAY, hideOnClose } = require('./close-behavior');

test('defaults to hiding on close', () => {
  assert.equal(DEFAULT_CLOSE_TO_TRAY, true);
  assert.equal(hideOnClose({}), true);
  assert.equal(hideOnClose(undefined), true);
  assert.equal(hideOnClose({ closeToTray: true }), true);
});

test('explicit false quits instead of hiding', () => {
  assert.equal(hideOnClose({ closeToTray: false }), false);
});

test('never hides once quit has started', () => {
  assert.equal(hideOnClose({ closeToTray: true }, true), false);
  assert.equal(hideOnClose({ closeToTray: false }, true), false);
});
