const test = require('node:test');
const assert = require('node:assert/strict');
const { overlayCss, closingCopy } = require('./closing-overlay');

test('overlayCss uses the supplied light theme colors instead of a dark fallback', () => {
  const css = overlayCss({
    scheme: 'light',
    bg: '#ffffff',
    fg: '#0f1115',
    muted: '#6b7280',
    accent: '#4176e6',
    field: '#f5f5f6',
    line: 'rgba(15, 17, 21, 0.12)',
  });
  assert.match(css, /background: #ffffff/);
  assert.match(css, /color: #0f1115/);
  assert.match(css, /color-scheme: light/);
  assert.doesNotMatch(css, /#151517/);
  assert.doesNotMatch(css, /color-mix\([^)]*#000/);
});

test('overlayCss uses the supplied dark theme colors', () => {
  const css = overlayCss({
    scheme: 'dark',
    bg: '#151517',
    fg: '#f5f5f5',
    muted: '#8b93a7',
    accent: '#6ea8ff',
    field: '#1d1d20',
    line: 'rgba(245, 245, 245, 0.10)',
  });
  assert.match(css, /background: #151517/);
  assert.match(css, /color: #f5f5f5/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /border-top-color: #6ea8ff/);
});

test('closingCopy is Chinese by default and English when locale is en', () => {
  assert.deepEqual(closingCopy(), {
    title: '关闭中',
    detail: '正在停止本机 Harness 服务，请稍候',
  });
  assert.deepEqual(closingCopy('zh'), {
    title: '关闭中',
    detail: '正在停止本机 Harness 服务，请稍候',
  });
  assert.deepEqual(closingCopy('en'), {
    title: 'Closing',
    detail: 'Stopping the local Harness service…',
  });
});
