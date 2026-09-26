'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { launcherTrayTemplate } = require('./tray');

test('slim tray menu is reopen + quit only — components outlive the window', () => {
  const calls = [];
  const template = launcherTrayTemplate({
    onShow: () => calls.push('show'),
    onQuit: () => calls.push('quit'),
  });
  const actions = template.filter((row) => row.click);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].label, '显示窗口');
  assert.equal(actions[1].label, '退出');
  actions[0].click();
  actions[1].click();
  assert.deepEqual(calls, ['show', 'quit']);
});
