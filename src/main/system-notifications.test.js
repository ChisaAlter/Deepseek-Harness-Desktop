'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { systemNotificationsAllowed, systemNotificationsSupported } = require('./system-notifications');

test('raw Windows Electron blocks support probing before its registration side effect', () => {
  const Notification = { isSupported() { throw new Error('must not initialize presenter'); } };
  const environment = { platform: 'win32', defaultApp: true };
  assert.equal(systemNotificationsAllowed(environment), false);
  assert.equal(systemNotificationsSupported(Notification, environment), false);
});

test('packaged Windows and other platforms keep native notification support checks', () => {
  for (const environment of [
    { platform: 'win32', defaultApp: false },
    { platform: 'win32' },
    { platform: 'linux', defaultApp: true },
    { platform: 'darwin', defaultApp: true },
  ]) {
    let calls = 0;
    const Notification = { isSupported() { calls++; return true; } };
    assert.equal(systemNotificationsAllowed(environment), true);
    assert.equal(systemNotificationsSupported(Notification, environment), true);
    assert.equal(calls, 1);
    Notification.isSupported = () => false;
    assert.equal(systemNotificationsSupported(Notification, environment), false);
  }
});

function notificationFixture(environment) {
  const counts = { support: 0, construct: 0, show: 0, close: 0 };
  class Notification extends EventEmitter {
    static isSupported() { counts.support++; return true; }
    constructor() { super(); counts.construct++; }
    show() { counts.show++; }
    close() { counts.close++; }
  }
  const policyModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'system-notifications.js'), 'utf8'), {
    module: policyModule, process: environment,
  });
  return { Notification, counts, policy: policyModule.exports };
}

for (const environment of [
  { platform: 'win32', defaultApp: true },
  { platform: 'win32', defaultApp: false },
  { platform: 'linux', defaultApp: true },
  { platform: 'darwin', defaultApp: true },
]) {
  const label = `${environment.platform} ${environment.defaultApp ? 'source' : 'package'}`;
  const expected = environment.platform === 'win32' && environment.defaultApp ? 0 : 1;
  test(`${label}: desktop tray hint guards support and constructor together`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const snippet = source.slice(source.indexOf('const trayHideNotice ='), source.indexOf('\nfunction bindMainClose'));
    const notice = vm.runInNewContext(`${snippet}\ntrayHideNotice`, {
      app: { getPath: () => '/isolated-profile' },
      TrayHideNotice: class { constructor(options) { this.notify = options.notify; } },
      systemNotificationsSupported: policy.systemNotificationsSupported,
      require: name => name === 'electron' ? { Notification } : require(name),
    });
    notice.notify();
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
  });

  test(`${label}: slim tray hint keeps the hide behavior without source registration`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const source = fs.readFileSync(path.join(__dirname, '../main-launcher/index.js'), 'utf8').replace(/\r\n/g, '\n');
    const snippet = source.slice(source.indexOf('function bindLauncherClose'), source.indexOf('async function confirmUnverified'));
    const bind = vm.runInNewContext(`${snippet}\nbindLauncherClose`, {
      quitting: false, tray: {}, Notification,
      loadConfig: () => ({}), saveConfig() {}, hideOnClose: () => true, trace() {},
      systemNotificationsSupported: policy.systemNotificationsSupported,
    });
    const win = new EventEmitter();
    let hidden = false, prevented = false;
    win.hide = () => { hidden = true; };
    bind(win);
    win.emit('close', { preventDefault() { prevented = true; } });
    assert.equal(hidden, true);
    assert.equal(prevented, true);
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
  });

  test(`${label}: update reminder retains attention and cleanup while gating registration`, () => {
    const { Notification, counts, policy } = notificationFixture(environment);
    const updateModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'update-attention.js'), 'utf8'), {
      module: updateModule, process: environment, console,
      require: name => name === 'electron'
        ? { app: { dock: { bounce: () => 1, cancelBounce() {} } }, Notification }
        : policy,
    });
    const parent = new EventEmitter();
    const flashes = [];
    parent.isFocused = () => false;
    parent.isDestroyed = () => false;
    parent.flashFrame = value => flashes.push(value);
    const attention = new updateModule.exports.UpdateAttention({ title: 'update', body: 'confirm' });
    attention.ready('0.3.3', parent, undefined, () => {});
    assert.deepEqual(counts, { support: expected, construct: expected, show: expected, close: 0 });
    attention.ready('0.3.3', parent, undefined, () => {});
    assert.equal(counts.support, expected, 'one reminder per version');
    assert.equal(parent.listenerCount('focus'), 1);
    parent.emit('focus');
    assert.equal(parent.listenerCount('focus'), 0);
    assert.equal(counts.close, expected);
    if (environment.platform === 'win32') assert.deepEqual(flashes, [true, false]);
  });
}
