const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isRemoteShellName,
  invokeDesktopShell,
  shellNameFromUrl,
  REMOTE_SHELL_NAMES,
} = require('./remote-shell');

test('whitelist includes git and listDir and rejects writeFile', () => {
  assert.equal(isRemoteShellName('gitStatus'), true);
  assert.equal(isRemoteShellName('listDir'), true);
  assert.equal(isRemoteShellName('openGallery'), true);
  assert.equal(isRemoteShellName('writeFile'), false);
  assert.equal(isRemoteShellName('ptyCreate'), false);
  assert.ok(REMOTE_SHELL_NAMES.includes('gitCommit'));
  assert.equal(shellNameFromUrl('/__remote__/shell/gitStatus'), 'gitStatus');
  assert.equal(shellNameFromUrl('/__remote__/shell/writeFile'), 'writeFile');
  assert.equal(shellNameFromUrl('/api/session.list'), null);
});

test('invokeDesktopShell maps gitStatus cwd', async () => {
  const seen = [];
  const result = await invokeDesktopShell({
    name: 'gitStatus',
    payload: { cwd: '/ws' },
    git: {
      gitStatus: async (cwd) => {
        seen.push(cwd);
        return { isRepo: true, refName: 'main' };
      },
    },
  });
  assert.deepEqual(seen, ['/ws']);
  assert.equal(result.ok, true);
  assert.equal(result.result.refName, 'main');
});

test('invokeDesktopShell rejects unknown names', async () => {
  const result = await invokeDesktopShell({ name: 'writeFile', payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('invokeDesktopShell surfaces git failure as ok false', async () => {
  const result = await invokeDesktopShell({
    name: 'gitCommit',
    payload: { cwd: '/ws', message: 'x' },
    git: {
      gitCommit: async () => ({ ok: false, message: 'hook failed' }),
    },
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /hook failed/);
});
