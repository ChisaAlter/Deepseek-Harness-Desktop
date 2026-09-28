'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  RENDERER_CONSOLE_MAX_BYTES,
  RendererConsoleTail,
  attachRendererConsoleTail,
  crashReportFileName,
  desktopErrorState,
  pruneCrashReports,
  renderCrashReport,
  writeCrashReport,
} = require('./crash-report');

test('desktopErrorState flattens AggregateError chains', () => {
  const state = desktopErrorState(new AggregateError([new Error('a'), new Error('b')], 'top'));
  assert.equal(state.phase, 'error');
  assert.ok(state.message.includes('top'));
  assert.ok(state.message.includes('a') && state.message.includes('b'));
  assert.equal(desktopErrorState('plain').message, 'plain');
});

test('console tail bounds bytes, dropping oldest lines', () => {
  const tail = new RendererConsoleTail(64);
  for (let i = 0; i < 20; i += 1) tail.push(`line-${i}-${'x'.repeat(10)}`);
  const lines = tail.snapshot();
  let bytes = 0;
  for (const l of lines) bytes += Buffer.byteLength(l);
  assert.ok(bytes <= 64);
  assert.equal(lines.at(-1).startsWith('line-19'), true);
});

test('report renders header, error, host diagnostic, and console tail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-crash-'));
  const file = await writeCrashReport(dir, {
    source: 'renderer',
    phase: 'running',
    error: new Error('boom'),
    hostDiagnostic: 'host said nope',
    rendererConsole: ['TypeError: x'],
    app: { name: 'Whale Isle', version: '0.3.3', platform: 'win32', arch: 'x64', electron: '43', node: '24', locale: 'zh-CN' },
    time: new Date('2026-09-26T12:00:00Z'),
  });
  assert.ok(file && file.endsWith('crash-2026-09-26T12-00-00-000Z-renderer.log'));
  const body = fs.readFileSync(file, 'utf8');
  assert.ok(body.includes('source: renderer'));
  assert.ok(body.includes('boom'));
  assert.ok(body.includes('host said nope'));
  assert.ok(body.includes('TypeError: x'));
});

test('prune deletes only matching names beyond retained', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-crash-'));
  for (let i = 0; i < 12; i += 1) {
    fs.writeFileSync(path.join(dir, crashReportFileName(new Date(Date.UTC(2026, 0, i + 1)), 'main')), 'x');
  }
  fs.writeFileSync(path.join(dir, 'keep-me.log'), 'x');
  await pruneCrashReports(dir, 10);
  const names = fs.readdirSync(dir).sort();
  assert.equal(names.length, 11);
  assert.ok(names.includes('keep-me.log'));
  assert.ok(!names.some((n) => n.includes('T00-00-00') && n.endsWith('-main.log') && n < 'crash-2026-01-03'));
});

test('attachRendererConsoleTail keeps error-level lines only', () => {
  const handlers = {};
  const contents = { on: (ev, fn) => { handlers[ev] = fn; } };
  const tail = new RendererConsoleTail();
  attachRendererConsoleTail(contents, tail);
  handlers['console-message']({ level: 'info', message: 'info' });
  handlers['console-message']({ level: 'warning', message: 'warning' });
  handlers['console-message']({ level: 'error', message: 'ERR real failure' });
  handlers['console-message']({ level: 'error', message: 'ERR second' });
  assert.deepEqual(tail.snapshot(), ['ERR real failure', 'ERR second']);
});

test('console tail truncates oversized lines at complete UTF-8 boundaries', () => {
  for (const limit of [0, 1, 2, 3, 4, 16]) {
    for (const line of ['x'.repeat(64), '鲸'.repeat(32), '🐳'.repeat(32)]) {
      const tail = new RendererConsoleTail(limit);
      tail.push('old');
      tail.push(line);
      const kept = tail.snapshot().join('');
      assert.ok(Buffer.byteLength(kept) <= limit, `UTF-8 budget ${limit}`);
      assert.equal(tail.bytes, Buffer.byteLength(kept));
      assert.ok(!kept.includes('\uFFFD'), 'no partial UTF-8 code point');
      if (kept) assert.ok(line.endsWith(kept), 'retain the most recent text');
      tail.push('z');
      assert.ok(tail.bytes <= limit, 'subsequent lines also stay bounded');
    }
  }
});
