const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createWorkspaceAuthority,
  scratchWorkspacePath,
} = require('./workspace-authority');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
const { listDir, readFile, readFileMedia, writeFile, setWorkspaceAuthority } = require('./workspace-fs.js');

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-'));
  // Pin the workspace authority so cwd checks pass inside this test root.
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: dir }));
  return dir;
}

test('listDir returns directories first and rejects path traversal', async () => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [
      { name: 'src', kind: 'directory' },
      { name: 'README.md', kind: 'file' },
    ]);
    const escaped = await listDir(cwd, '..');
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('readFile returns utf8 text and rejects a path outside cwd', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'alpha\n');
    const read = await readFile(cwd, 'note.txt');
    assert.equal(read.ok, true);
    assert.equal(read.binary, false);
    assert.equal(read.text, 'alpha\n');
    const escaped = await readFile(cwd, path.join('..', 'outside.txt'));
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir accepts a second authorized root and rejects an outsider', async () => {
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-boot-'));
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-extra-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-out-'));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: boot,
    extraWorkspaces: [extra],
  }));
  try {
    fs.writeFileSync(path.join(extra, 'README.md'), 'hello\n');
    fs.writeFileSync(path.join(outsider, 'secret.txt'), 'nope\n');
    const listed = await listDir(extra, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [{ name: 'README.md', kind: 'file' }]);
    const blocked = await listDir(outsider, '');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.message, 'Path is outside the workspace.');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

/**
 * Issue #97: a session with no workspace cwd generates files under the
 * Host-owned scratch root. The document tab reads through `shell:read-file` /
 * `shell:list-dir`, which resolve through workspace-fs's *lazy production*
 * authority. That authority must include the scratch root (the preview
 * authority already does), while traversal outside it stays refused.
 */
test('workspace-fs authority (shell:read-file / shell:list-dir) accepts the scratch cwd and refuses its parent', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-home-'));
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-boot-'));
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    const scratch = scratchWorkspacePath(home);
    fs.mkdirSync(scratch);
    fs.writeFileSync(path.join(scratch, 'pelican-bike.html'), '<h1>ok</h1>\n');
    const outside = path.join(path.dirname(scratch), 'outside.txt');
    fs.writeFileSync(outside, 'classified\n');

    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    // Drive the production path: no test authority is pinned, so
    // workspace-fs's own lazy authority is what answers both calls.
    setWorkspaceAuthority(null);

    const listed = await listDir(scratch, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [{ name: 'pelican-bike.html', kind: 'file' }]);

    const read = await readFile(scratch, 'pelican-bike.html');
    assert.equal(read.ok, true);
    assert.equal(read.text, '<h1>ok</h1>\n');

    // Negative: the scratch root is the boundary, not the whole volume/home.
    for (const rel of ['..', path.join('..', 'outside.txt'), outside]) {
      const escapedRead = await readFile(scratch, rel);
      assert.equal(escapedRead.ok, false, `readFile(${rel}) 必须被拒绝`);
      assert.equal(escapedRead.message, 'Path is outside the workspace.');
      const escapedList = await listDir(scratch, rel);
      assert.equal(escapedList.ok, false, `listDir(${rel}) 必须被拒绝`);
      assert.equal(escapedList.message, 'Path is outside the workspace.');
    }
  } finally {
    setWorkspaceAuthority(null);
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
  }
});

test('readFileMedia returns png bytes and rejects non-images and traversal', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(cwd, 'note.ts'), 'export {}\n');
    const png = await readFileMedia(cwd, 'icon.png');
    assert.equal(png.ok, true);
    assert.equal(png.mime, 'image/png');
    assert.equal(typeof png.base64, 'string');
    const ts = await readFileMedia(cwd, 'note.ts');
    assert.equal(ts.ok, false);
    const escaped = await readFileMedia(cwd, path.join('..', 'icon.png'));
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeFile creates missing parent directories', async () => {
  const cwd = makeTempDir();
  try {
    const written = await writeFile(cwd, 'nested/new.txt', 'hi\n');
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'nested', 'new.txt'), 'utf8'), 'hi\n');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('L-4: writeFile rejects every path with a .git segment, keeps .gitignore/.github writable', async () => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, '.git'));
    fs.writeFileSync(path.join(cwd, '.git', 'config'), '[core]\n');
    const blocked = [
      '.git/config',
      '.git/hooks/pre-commit',
      'sub/.git/config', // nested repo
      '.GIT/config', // case-insensitive filesystems
      '.git\\hooks\\post-checkout', // windows separators
      'docs/../.git/config', // traversal into .git
      '.git', // gitlink file overwrite (worktrees/submodules)
    ];
    for (const rel of blocked) {
      const result = await writeFile(cwd, rel, 'pwned\n');
      assert.equal(result.ok, false, `${rel} 必须被拒绝`);
      assert.equal(result.message, 'Saving inside .git is not allowed.');
    }
    assert.equal(fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8'), '[core]\n', '.git/config 不得被改写');

    // 名称仅前缀相似的路径仍可保存（产品契约：普通 dotfile 正常编辑）。
    const gitignore = await writeFile(cwd, '.gitignore', 'dist/\n');
    assert.equal(gitignore.ok, true);
    const workflow = await writeFile(cwd, '.github/workflows/ci.yml', 'on: push\n');
    assert.equal(workflow.ok, true);
    const gitLikeName = await writeFile(cwd, 'src/git.txt', 'ok\n');
    assert.equal(gitLikeName.ok, true);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir hides gitignored names when git is available', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'secret.txt\n');
    fs.writeFileSync(path.join(cwd, 'secret.txt'), 'nope');
    fs.writeFileSync(path.join(cwd, 'keep.txt'), 'yes');
    fs.mkdirSync(path.join(cwd, '.git'));
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.equal(names.includes('.git'), false);
    assert.equal(names.includes('keep.txt'), true);
    if (names.includes('secret.txt')) {
      // git missing: ignore-file skip is best-effort; .git still hidden
    } else {
      assert.equal(names.includes('secret.txt'), false);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir batch-classifies many entries, including names with spaces, in one pass', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '*.log\nbuild dir/\n');
    fs.mkdirSync(path.join(cwd, 'build dir'));
    for (let index = 0; index < 30; index += 1) {
      fs.writeFileSync(path.join(cwd, `trace-${index}.log`), 'x');
      fs.writeFileSync(path.join(cwd, `src-${index}.ts`), 'x');
    }
    fs.writeFileSync(path.join(cwd, 'with space.ts'), 'x');
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.equal(names.includes('with space.ts'), true);
    assert.equal(names.filter((name) => name.endsWith('.ts')).length, 31);
    if (!names.includes('trace-0.log')) {
      // git present: every ignored name is filtered by the single batch call.
      assert.equal(names.some((name) => name.endsWith('.log')), false);
      assert.equal(names.includes('build dir'), false);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeFile replaces utf8 text and rejects traversal, directories, and oversized payloads', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'alpha\n');
    fs.mkdirSync(path.join(cwd, 'src'));
    const written = await writeFile(cwd, 'note.txt', 'beta\n');
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'note.txt'), 'utf8'), 'beta\n');
    const escaped = await writeFile(cwd, path.join('..', 'note.txt'), 'nope\n');
    assert.equal(escaped.ok, false);
    const dir = await writeFile(cwd, 'src', 'nope\n');
    assert.equal(dir.ok, false);
    const huge = await writeFile(cwd, 'note.txt', 'x'.repeat(1024 * 1024 + 1));
    assert.equal(huge.ok, false);
    const missing = await writeFile(cwd, '', 'x');
    assert.equal(missing.ok, false);
    const notText = await writeFile(cwd, 'note.txt', 1);
    assert.equal(notText.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
