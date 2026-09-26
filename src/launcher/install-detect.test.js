'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const detect = require('./install-detect');

test('current desktop target still accepts the previous installed executable', () => {
  const candidates = detect.desktopExeCandidates('C:\\Apps\\Whale Isle');
  assert.deepEqual(candidates, [
    path.join('C:\\Apps\\Whale Isle', 'Whale Isle.exe'),
    path.join('C:\\Apps\\Whale Isle', 'app', 'Whale Isle.exe'),
    path.join('C:\\Apps\\Whale Isle', 'Deepseek-Harness-Desktop.exe'),
    path.join('C:\\Apps\\Whale Isle', 'app', 'Deepseek-Harness-Desktop.exe'),
  ]);
});

test('legacy install registration remains discoverable after the rename', () => {
  const previous = 'Deepseek-Harness-Desktop';
  const result = detect.findRegisteredWindowsInstall({
    platform: 'win32',
    execFileSync: (_command, args) => {
      if (args.includes(previous)) {
        return 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\old\n    DisplayName    REG_SZ    Deepseek-Harness-Desktop\n    InstallLocation    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\n    DisplayVersion    REG_SZ    0.3.3\n\n';
      }
      throw new Error('not found');
    },
  });
  assert.equal(result?.displayName, previous);
  assert.equal(result?.displayVersion, '0.3.3');
});

test('running legacy desktop executable is still detected by the launcher', () => {
  const legacy = detect.probeDesktopProcess({
    platform: 'win32',
    execFileSync: (_command, args) => args.some((arg) => arg.includes('Deepseek-Harness-Desktop.exe'))
      ? '"Deepseek-Harness-Desktop.exe","100","Console","1","50 K"'
      : 'INFO: No tasks',
  });
  assert.equal(legacy, true);
});

test('empty DisplayVersion falls back to the runtime exe product version', () => {
  const info = detect.getInstalledAppInfo({
    platform: 'win32',
    isPackaged: true,
    target: { appId: 'ai.deepseek.harness.gui', productName: 'Whale Isle' },
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1 }),
    execFileSync: (command, args) => {
      if (command === 'reg') {
        return 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\old\n    DisplayName    REG_SZ    Deepseek-Harness-Desktop\n    InstallLocation    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\n    UninstallString    REG_SZ    C:\\Apps\\Deepseek-Harness-Desktop\\Uninstall Deepseek-Harness-Desktop.exe\n\n';
      }
      if (command === 'powershell') {
        return '0.3.2.0\r\n';
      }
      throw new Error(`unexpected ${command} ${args}`);
    },
  });
  assert.equal(info.registeredInstall, true);
  assert.equal(info.version, '0.3.2');
});
