import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_ONLY_ROWS, settingsHasDesktopRows, visibleScreen } from './chrome.js';

test('visibleScreen routes scan and permission before chat and connect', () => {
  assert.equal(visibleScreen({}), 'connect');
  assert.equal(visibleScreen({ route: 'scan' }), 'scan');
  assert.equal(visibleScreen({ route: 'permission' }), 'permission');
  assert.equal(visibleScreen({ connected: true }), 'chat');
  assert.equal(visibleScreen({ connected: true, route: 'scan' }), 'scan');
});

test('desktop-only rows stay out of the phone settings', () => {
  assert.equal(settingsHasDesktopRows(['主题', '语言']), false);
  assert.equal(settingsHasDesktopRows(['关闭窗口时']), true);
  assert.ok(DESKTOP_ONLY_ROWS.includes('打开配置文件'));
  assert.ok(DESKTOP_ONLY_ROWS.includes('Harness 自动恢复'));
});
