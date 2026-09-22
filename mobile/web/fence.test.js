import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.test\.js$/.test(entry.name)) continue;
    if (!/\.(js|html|css)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

test('mobile web production files do not import the desktop shell or official client plugins', () => {
  const files = walk(root);
  assert.ok(files.length > 0, 'expected production files under mobile/web');
  for (const dir of ['host', 'conversation', 'ui', 'shell', 'git', 'pair']) {
    assert.ok(
      files.some((file) => path.relative(root, file).startsWith(`${dir}${path.sep}`)),
      `fence walk must cover mobile/web/${dir}`,
    );
  }
  const banned = [
    /from\s+['"]\.\.\/\.\.\/src\//,
    /require\(\s*['"]\.\.\/\.\.\/src\//,
    /@deepseek-ai\/dsh-client-/,
  ];
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of banned) {
      if (re.test(text)) hits.push(`${path.relative(root, file)}: ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});
