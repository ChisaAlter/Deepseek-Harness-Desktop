import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PRUNED_DIRS,
  REMOTE_PRUNED_DIRS,
  createClientSourcePruner,
  createFileScanner,
  createScanMemo,
  isClientSourceFile,
  newestMtime,
} from './source-scan.mjs';

function makeHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, mtimeMs) => {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  };
  return { root, write };
}

test('pruning the client scan keeps the newest client input identical', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/client/ui-chat/src/client/index.ts', 5_000);
  write('packages/client/ui-chat/src/client/index.css', 9_000);
  write('apps/web/src/main.tsx', 7_000);
  write('scripts/generate.ts', 3_000);
  // Trees the old scan entered and filtered afterwards.
  write('docs/guide.json', 11_000);
  write('website/index.html', 12_000);
  write('mobile/web/app.json', 13_000);
  write('node_modules/pkg/index.ts', 14_000);

  const filter = (file) => isClientSourceFile(file);
  const unpruned = newestMtime(root, filter);
  const pruned = newestMtime(root, filter, { pruneDir: createClientSourcePruner(root) });

  assert.equal(unpruned, 9_000);
  assert.equal(pruned, 9_000);
});

test('build inputs exclude tests, fixtures, and README pairing documents', () => {
  const keep = [
    'C:/h/packages/client/ui-chat/src/client/index.ts',
    'C:/h/packages/client/ui-chat/src/client/view.module.css',
    'C:/h/apps/web/src/main.tsx',
    'C:/h/scripts/generate-catalog.ts',
    'C:/h/packages/client/ui-chat/package.json',
  ];
  const drop = [
    'C:/h/packages/client/ui-chat/tests/chat-apply.client.spec.tsx',
    'C:/h/packages/client/ui-chat/src/client/index.spec.ts',
    'C:/h/packages/client/ui-surfaces/README.i18n.yaml',
    'C:/h/packages/client/ui-surfaces/README.md',
    'C:/h/apps/web/tests/support.ts',
    'C:/h/packages/server/src/index.ts',
    'C:/h/docs/guide.json',
  ];
  for (const file of keep) assert.equal(isClientSourceFile(file), true, `${file} must stay an input`);
  for (const file of drop) assert.equal(isClientSourceFile(file), false, `${file} must not be an input`);
});

test('the pruner refuses to descend into client test trees', (t) => {
  const { root } = makeHarness(t);
  fs.mkdirSync(path.join(root, 'packages', 'client', 'ui-chat', 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'client', 'ui-chat', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const prune = createClientSourcePruner(root);

  assert.equal(prune(path.join(root, 'packages', 'client', 'ui-chat', 'src')), true);
  assert.equal(prune(path.join(root, 'packages', 'client', 'ui-chat', 'tests')), false);
  assert.equal(prune(path.join(root, 'docs')), false);
  assert.equal(prune(path.join(root, 'scripts')), true);
});

test('the scan memo enumerates a shared subtree once and reports its calls', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/protocol/src/index.ts', 4_000);
  const protocol = path.join(root, 'packages', 'protocol', 'src');
  let enumerations = 0;
  const memo = createScanMemo({
    scan: (dir) => {
      enumerations += 1;
      return newestMtime(dir);
    },
  });

  // The server stack and the mobile bundle both ask for protocol and client.
  assert.equal(memo.scan(protocol), 4_000);
  assert.equal(memo.scan(protocol), 4_000);
  assert.equal(enumerations, 1);
  assert.equal(memo.calls.get(protocol), 2);
});

test('scanning a single file returns its mtime instead of failing', (t) => {
  const { root, write } = makeHarness(t);
  write('mobile/web/chisacode/entry.mjs', 8_000);
  const entry = path.join(root, 'mobile', 'web', 'chisacode', 'entry.mjs');
  assert.equal(newestMtime(entry), 8_000);
  assert.equal(newestMtime(path.join(root, 'missing.mjs')), 0);

  const memo = createScanMemo();
  assert.equal(memo.scanFile(entry), 8_000);
  assert.equal(memo.scanFile(entry), 8_000);
  assert.equal(memo.calls.get(entry), 2);
  assert.equal(memo.scanFile(path.join(root, 'missing.mjs')), 0);
});

test('the scanner seam normalizes separators for POSIX-style predicates', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/client/ui-chat/src/client/index.ts', 6_000);
  const scanner = createFileScanner((file) => /\/packages\/client\/.*\.ts$/.test(file));
  assert.equal(scanner(root), 6_000);
});

test('the default prune list keeps generated trees out of every scan', () => {
  for (const dir of ['node_modules', 'lib', 'dist', '.dsh-build', '.git', 'coverage', '.artifacts']) {
    assert.equal(DEFAULT_PRUNED_DIRS.includes(dir), true, `${dir} must stay pruned`);
  }
});

test('nested scripts subdirectories stay inside the client scan', (t) => {
  const { root, write } = makeHarness(t);
  // The file predicate accepts scripts/**/*.ts, so the directory predicate
  // must not stop at scripts/ and silently drop deeper inputs.
  write('scripts/perf/bench.ts', 4_000);
  write('scripts/perf/nested/deep/tool.ts', 8_500);
  const prune = createClientSourcePruner(root);
  assert.equal(prune(path.join(root, 'scripts', 'perf')), true);
  assert.equal(prune(path.join(root, 'scripts', 'perf', 'nested')), true);
  const pruned = newestMtime(root, isClientSourceFile, { pruneDir: prune });
  assert.equal(pruned, 8_500, 'a deep scripts/ input must still invalidate the build');
});

test("the client pruner still refuses trees that are not build inputs", (t) => {
  const { root } = makeHarness(t);
  fs.mkdirSync(path.join(root, 'website'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'tests'), { recursive: true });
  const prune = createClientSourcePruner(root);
  assert.equal(prune(path.join(root, 'website')), false);
  assert.equal(prune(path.join(root, 'apps', 'web', 'tests')), false);
  // Non-client packages are entered (only the file predicate rejects them),
  // which is the pre-existing behaviour this change must not tighten.
  assert.equal(prune(path.join(root, 'packages', 'server', 'src')), true);
});

test('a lib/ directory under a source root is still scanned by the remote walk', (t) => {
  const { root, write } = makeHarness(t);
  // `src/lib/` is a legitimate source location; the client prune list would
  // skip it by name, so the remote caller uses its own narrower list.
  write('packages/client/src/lib/helpers.ts', 6_500);
  const clientPruned = newestMtime(root, () => true, {
    skipDirs: DEFAULT_PRUNED_DIRS,
    includeDirMtime: false,
  });
  const remoteScanned = newestMtime(root, () => true, {
    skipDirs: REMOTE_PRUNED_DIRS,
    includeDirMtime: false,
  });
  assert.equal(clientPruned, 0, 'the client list intentionally skips any lib/ directory');
  assert.equal(remoteScanned, 6_500, 'the remote list must still see src/lib inputs');
});

test('directory mtimes are folded in only when the caller asks for them', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/client/src/keep.ts', 2_000);
  const source = path.join(root, 'packages');
  const withoutDirs = newestMtime(source, () => true, { includeDirMtime: false });
  const withDirs = newestMtime(source, () => true, { includeDirMtime: true });
  const dirMtime = fs.statSync(path.join(root, 'packages', 'client')).mtimeMs;
  assert.equal(withoutDirs, 2_000);
  assert.ok(withDirs >= withoutDirs);
  assert.ok(withDirs >= dirMtime, 'the visited directory mtime must participate');
});

test('deleting the newest file is visible through the directory mtime signal', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/client/src/a.ts', 1_000);
  const dir = path.join(root, 'packages', 'client', 'src');
  fs.utimesSync(dir, 5, 5);
  const before = newestMtime(dir, () => true, { includeDirMtime: true });
  fs.rmSync(path.join(dir, 'a.ts'));
  fs.utimesSync(dir, 9, 9);
  // A bare deletion leaves no file mtime behind; only the directory's own
  // mtime can carry the change signal to a caller that opts in.
  const after = newestMtime(dir, () => true, { includeDirMtime: true });
  assert.equal(before, 5_000);
  assert.equal(after, 9_000);
});

test('the scan memo forwards the caller prune policy and dir-mtime option', (t) => {
  const { root, write } = makeHarness(t);
  write('packages/client/src/lib/helpers.ts', 7_000);
  const memo = createScanMemo({ skipDirs: REMOTE_PRUNED_DIRS, includeDirMtime: true });
  assert.equal(memo.scan(root) >= 7_000, true);
  const clientMemo = createScanMemo({ skipDirs: DEFAULT_PRUNED_DIRS });
  assert.equal(clientMemo.scan(root), 0);
});
