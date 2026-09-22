const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { killProcessTree } = require('./git-exec');

function fakeChild(pid) {
  const child = { killed: 0, kill: () => { child.killed += 1; } };
  if (pid !== undefined) child.pid = pid;
  return child;
}

function fakeKiller() {
  const killer = new EventEmitter();
  killer.unrefs = 0;
  killer.unref = () => { killer.unrefs += 1; };
  return killer;
}

test('killProcessTree on win32 runs taskkill /T /F on the child pid', () => {
  const child = fakeChild(4242);
  const killer = fakeKiller();
  const calls = [];
  killProcessTree(child, {
    platform: 'win32',
    spawnKiller: (command, args, options) => {
      calls.push({ command, args, options });
      return killer;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'taskkill');
  assert.deepEqual(calls[0].args, ['/PID', '4242', '/T', '/F']);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(killer.unrefs, 1, 'the killer must not hold the event loop');
  assert.equal(child.killed, 0, 'taskkill owns the tree; no direct SIGTERM');
});

test('killProcessTree on win32 falls back to child.kill when taskkill exits nonzero', () => {
  const child = fakeChild(4242);
  const killer = fakeKiller();
  killProcessTree(child, { platform: 'win32', spawnKiller: () => killer });
  killer.emit('exit', 1);
  assert.equal(child.killed, 1, 'access-denied taskkill must not leave the git child alive');
});

test('killProcessTree on win32 does not double-kill after a clean taskkill', () => {
  const child = fakeChild(4242);
  const killer = fakeKiller();
  killProcessTree(child, { platform: 'win32', spawnKiller: () => killer });
  killer.emit('exit', 0);
  assert.equal(child.killed, 0, 'taskkill /T /F already terminated the tree');
});

test('killProcessTree on win32 falls back to child.kill when taskkill errors', () => {
  const child = fakeChild(4242);
  const killer = fakeKiller();
  killProcessTree(child, { platform: 'win32', spawnKiller: () => killer });
  killer.emit('error', new Error('spawn taskkill ENOENT'));
  assert.equal(child.killed, 1);
});

test('killProcessTree on win32 falls back when spawning taskkill throws', () => {
  const child = fakeChild(4242);
  killProcessTree(child, {
    platform: 'win32',
    spawnKiller: () => { throw new Error('EPERM'); },
  });
  assert.equal(child.killed, 1);
});

test('killProcessTree on win32 without a pid uses child.kill', () => {
  const child = fakeChild(undefined);
  killProcessTree(child, {
    platform: 'win32',
    spawnKiller: () => { throw new Error('must not spawn without a pid'); },
  });
  assert.equal(child.killed, 1);
});

test('killProcessTree on POSIX uses the default kill and never spawns', () => {
  const child = fakeChild(4242);
  killProcessTree(child, {
    platform: 'linux',
    spawnKiller: () => { throw new Error('must not spawn on POSIX'); },
  });
  assert.equal(child.killed, 1);
});
