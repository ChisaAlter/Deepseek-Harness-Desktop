const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  DEFAULT_DOWNLOAD_NAME,
  MAX_DOWNLOAD_NAME_CHARS,
  sanitizeDownloadFilename,
  downloadSavePath,
} = require('./download-path');

test('sanitizeDownloadFilename strips path components from both separator styles', () => {
  assert.equal(sanitizeDownloadFilename('../../outside.txt'), 'outside.txt');
  assert.equal(sanitizeDownloadFilename('..\\..\\outside.txt'), 'outside.txt');
});

test('sanitizeDownloadFilename removes unsafe characters and device names', () => {
  assert.equal(sanitizeDownloadFilename('report\0\r\n:2026?.txt'), 'report____2026_.txt');
  assert.equal(sanitizeDownloadFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeDownloadFilename('CONIN$.txt'), '_CONIN$.txt');
  assert.equal(sanitizeDownloadFilename('COM\u00b9.txt'), '_COM\u00b9.txt');
  assert.equal(sanitizeDownloadFilename('...   '), DEFAULT_DOWNLOAD_NAME);
});

test('sanitizeDownloadFilename bounds long names', () => {
  assert.equal(Array.from(sanitizeDownloadFilename('a'.repeat(500))).length, MAX_DOWNLOAD_NAME_CHARS);
});

test('downloadSavePath always resolves immediately inside downloads', () => {
  const root = path.resolve('C:\\Downloads');
  const target = downloadSavePath(root, '..\\..\\payload.exe');
  assert.equal(path.dirname(target), root);
  assert.equal(path.basename(target), 'payload.exe');
});
