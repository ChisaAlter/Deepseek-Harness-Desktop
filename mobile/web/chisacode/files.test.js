import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW_MAX_BYTES,
  TEXT_RENDER_MAX_BYTES,
  breadcrumbSegments,
  classifyFilePreview,
  fileSizeLabel,
  listDirectoryView,
  parentPath,
  previewSizeGate,
  readFilePreview,
  searchWorkspacePaths,
} from './files.js';

test('listDirectoryView sorts directories first, normalizes paths, and records args', async () => {
  const calls = [];
  const client = {
    async listDirectory(cwd, path) {
      calls.push([cwd, path]);
      return {
        path: 'src/',
        entries: [
          { name: 'zeta.js', path: 'src/zeta.js', kind: 'file', size: 10, modifiedAt: 'x' },
          { name: 'app', path: 'src/app/', kind: 'directory', size: 0, modifiedAt: 'x' },
          { name: 'alpha.js', path: 'src/alpha.js', kind: 'file', size: 20, modifiedAt: 'x' },
          { name: 'lib', path: 'src/lib', kind: 'directory', size: 0, modifiedAt: 'x' },
          { name: '', path: '', kind: 'file', size: 0, modifiedAt: 'x' },
        ],
      };
    },
  };
  const view = await listDirectoryView(client, '/repo', 'src/');
  assert.deepEqual(calls, [['/repo', 'src']]);
  assert.equal(view.path, 'src');
  assert.deepEqual(view.entries.map((entry) => [entry.path, entry.kind]), [
    ['src/app', 'directory'],
    ['src/lib', 'directory'],
    ['src/alpha.js', 'file'],
    ['src/zeta.js', 'file'],
  ]);
  assert.equal(view.entries[2].size, 20);
});

test('listDirectoryView falls back to name when path is missing and propagates errors', async () => {
  const client = {
    async listDirectory() {
      return { entries: [{ name: 'README.md', kind: 'file', size: 5 }] };
    },
  };
  const view = await listDirectoryView(client, '/repo', '');
  assert.deepEqual(view.entries, [{ name: 'README.md', path: 'README.md', kind: 'file', size: 5 }]);

  const failing = {
    async listDirectory() {
      throw new Error('Directory listing unavailable.');
    },
  };
  await assert.rejects(() => listDirectoryView(failing, '/repo', 'src'), /unavailable/);
});

test('breadcrumbSegments always starts at the root and accumulates paths', () => {
  assert.deepEqual(breadcrumbSegments(''), [{ label: '根目录', path: '' }]);
  assert.deepEqual(breadcrumbSegments('src/app/ui/'), [
    { label: '根目录', path: '' },
    { label: 'src', path: 'src' },
    { label: 'app', path: 'src/app' },
    { label: 'ui', path: 'src/app/ui' },
  ]);
});

test('parentPath walks one level up and stops at the root', () => {
  assert.equal(parentPath('src/app/ui'), 'src/app');
  assert.equal(parentPath('src'), '');
  assert.equal(parentPath(''), '');
});

test('searchWorkspacePaths queries getDirectorySuggestions with fuzzy path matching', async () => {
  const calls = [];
  const client = {
    async getDirectorySuggestions(options) {
      calls.push(options);
      return {
        directories: ['src/app'],
        entries: [
          { path: 'src/app', kind: 'directory' },
          { path: 'src/app.js', kind: 'file' },
          { path: '', kind: 'file' },
        ],
        error: null,
      };
    },
  };
  const rows = await searchWorkspacePaths(client, '/repo', ' app ', { limit: 10 });
  assert.deepEqual(calls, [{
    query: 'app',
    cwd: '/repo',
    includeFiles: true,
    includeDirectories: true,
    matchMode: 'fuzzy',
    limit: 10,
  }]);
  assert.deepEqual(rows, [
    { path: 'src/app', kind: 'directory' },
    { path: 'src/app.js', kind: 'file' },
  ]);
});

test('searchWorkspacePaths falls back to legacy directories and surfaces errors', async () => {
  const legacy = {
    async getDirectorySuggestions() {
      return { directories: ['src/', 'docs'], error: null };
    },
  };
  assert.deepEqual(await searchWorkspacePaths(legacy, '/repo', 'x'), [
    { path: 'src', kind: 'directory' },
    { path: 'docs', kind: 'directory' },
  ]);

  const failing = {
    async getDirectorySuggestions() {
      return { directories: [], entries: [], error: 'search backend down' };
    },
  };
  await assert.rejects(() => searchWorkspacePaths(failing, '/repo', 'x'), /search backend down/);
  await assert.rejects(() => searchWorkspacePaths({}, '/repo', '   '), /关键字/);
});

test('previewSizeGate blocks fetches above the preview budget', () => {
  assert.equal(previewSizeGate(PREVIEW_MAX_BYTES), false);
  assert.equal(previewSizeGate(PREVIEW_MAX_BYTES + 1), true);
  assert.equal(previewSizeGate(undefined), false);
});

test('classifyFilePreview maps the four read-only states', () => {
  const tooLarge = classifyFilePreview({
    bytes: new Uint8Array(), mime: 'text/plain', size: PREVIEW_MAX_BYTES + 5, kind: 'text',
  });
  assert.deepEqual(tooLarge, { kind: 'too-large', size: PREVIEW_MAX_BYTES + 5 });

  const image = classifyFilePreview({
    bytes: new Uint8Array([1, 2]), mime: 'image/png', size: 2, kind: 'image',
  });
  assert.equal(image.kind, 'image');
  assert.equal(image.mime, 'image/png');
  assert.equal(image.bytes.byteLength, 2);

  const binary = classifyFilePreview({
    bytes: new Uint8Array([0]), mime: 'application/zip', size: 1, kind: 'binary',
  });
  assert.deepEqual(binary, { kind: 'binary', size: 1, mime: 'application/zip' });

  const bytes = new TextEncoder().encode('你好 world');
  const text = classifyFilePreview({ bytes, mime: 'text/plain', size: bytes.byteLength, kind: 'text' });
  assert.deepEqual(text, { kind: 'text', text: '你好 world', truncated: false, size: bytes.byteLength });
});

test('classifyFilePreview truncates oversized text renders', () => {
  const bytes = new Uint8Array(TEXT_RENDER_MAX_BYTES + 100).fill(97);
  const preview = classifyFilePreview({ bytes, mime: 'text/plain', size: bytes.byteLength, kind: 'text' });
  assert.equal(preview.kind, 'text');
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, TEXT_RENDER_MAX_BYTES);
});

test('readFilePreview fetches then classifies; daemon errors propagate', async () => {
  const calls = [];
  const bytes = new TextEncoder().encode('hello');
  const client = {
    async readFile(cwd, path) {
      calls.push([cwd, path]);
      return { bytes, mime: 'text/plain', size: bytes.byteLength, path, kind: 'text', modifiedAt: 'x' };
    },
  };
  const preview = await readFilePreview(client, '/repo', '/src/index.js/');
  assert.deepEqual(calls, [['/repo', 'src/index.js']]);
  assert.equal(preview.kind, 'text');
  assert.equal(preview.text, 'hello');

  const failing = {
    async readFile() {
      throw new Error('File exceeds maximum transfer size (67108864 bytes)');
    },
  };
  await assert.rejects(() => readFilePreview(failing, '/repo', 'big.bin'), /maximum transfer size/);
});

test('fileSizeLabel formats bytes, KB, and MB', () => {
  assert.equal(fileSizeLabel(532), '532 B');
  assert.equal(fileSizeLabel(1229), '1.2 KB');
  assert.equal(fileSizeLabel(3.4 * 1024 * 1024), '3.4 MB');
  assert.equal(fileSizeLabel(undefined), '0 B');
});
