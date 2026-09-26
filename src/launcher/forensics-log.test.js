'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const forensicsLog = require('./forensics-log');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('bootLogPath points at logs/last-external-boot.log under the state dir', () => {
  const file = forensicsLog.bootLogPath(path.join('C:\\state', 'dir'));
  assert.equal(file, path.join('C:\\state', 'dir', 'logs', 'last-external-boot.log'));
});

test('attachBootLog pipes child stdout and stderr into the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    forensicsLog.attachBootLog(child, file);
    child.stdout.emit('data', Buffer.from('cordis boot ok\n'));
    child.stderr.emit('data', "failed to apply loader entry app (@evil/plugin)\n");
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /cordis boot ok/);
    assert.match(text, /failed to apply loader entry app \(@evil\/plugin\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog truncates a stale log so the file is one boot only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-trunc-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'previous boot evidence\n');
    const child = fakeChild();
    forensicsLog.attachBootLog(child, file);
    child.stdout.emit('data', 'fresh boot\n');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('previous boot evidence'));
    assert.ok(text.includes('fresh boot'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog caps the file at MAX_BYTES and keeps the tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-rot-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    forensicsLog.attachBootLog(child, file);
    // ~40 x 32KiB pushes well past the 512KiB cap several times over.
    for (let i = 0; i < 40; i += 1) {
      child.stdout.emit('data', Buffer.from(`line-${String(i).padStart(3, '0')} ${'x'.repeat(32 * 1024)}\n`));
    }
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(Buffer.byteLength(text) <= forensicsLog.MAX_BYTES);
    assert.ok(text.includes('line-039'), 'newest line kept');
    assert.ok(!text.includes('line-000'), 'oldest line dropped');
    // Rotation restarts on a line boundary, not a mid-line fragment.
    assert.match(text, /^line-\d{3} /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog line() writes a timestamped verdict line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-line-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    const log = forensicsLog.attachBootLog(child, file);
    log.line('external runtime exited code 1');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.match(text, /external runtime exited code 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog survives a denied fs without throwing', () => {
  const denied = Object.create(fs);
  for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'readFileSync']) {
    denied[name] = () => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    };
  }
  const child = fakeChild();
  const log = forensicsLog.attachBootLog(child, 'C:\\denied\\boot.log', { fs: denied });
  assert.doesNotThrow(() => {
    child.stdout.emit('data', Buffer.from('crash line\n'));
    child.stderr.emit('data', Buffer.from('more\n'));
    log.line('launcher verdict: runtime-exited');
  });
});

test('attachBootLog tolerates a child with no piped streams and stream errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-nostream-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    // A spawn-rejected child shape: no stdout/stderr at all.
    const bare = new EventEmitter();
    bare.on('error', () => {});
    const log = forensicsLog.attachBootLog(bare, file);
    assert.doesNotThrow(() => bare.emit('error', new Error('ENOENT')));
    log.line('launcher verdict: spawn failed (ENOENT)');
    assert.match(fs.readFileSync(file, 'utf8'), /ENOENT/);
    // Stream-level errors must not escape either.
    const child = fakeChild();
    forensicsLog.attachBootLog(child, file);
    assert.doesNotThrow(() => child.stdout.emit('error', new Error('EPIPE')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBootLogTail returns the last N non-empty lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-tail-'));
  try {
    const file = path.join(dir, 'boot.log');
    const lines = Array.from({ length: 10 }, (_, i) => `evidence-${i}`);
    fs.writeFileSync(file, `${lines.join('\r\n')}\n\n\n`);
    assert.deepEqual(
      forensicsLog.readBootLogTail(file, { maxLines: 3 }),
      ['evidence-7', 'evidence-8', 'evidence-9'],
    );
    assert.equal(forensicsLog.readBootLogTail(file).length, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBootLogTail returns [] for a missing file', () => {
  const missing = path.join(os.tmpdir(), 'dsh-flog-none', 'boot.log');
  assert.deepEqual(forensicsLog.readBootLogTail(missing), []);
});

test('readBootLogTail returns [] when the path is unreadable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-eisdir-'));
  try {
    assert.deepEqual(forensicsLog.readBootLogTail(dir), []);
    const denied = {
      readFileSync: () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    };
    assert.deepEqual(forensicsLog.readBootLogTail('C:\\x\\boot.log', {}, { fs: denied }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
