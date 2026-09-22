const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createWorkspaceAuthority,
  loadWorkspaceAuthority,
  readHarnessRegisteredWorkspacePaths,
  filterRegisteredWorkspaceRoots,
  isHighRiskWorkspaceRoot,
  highRiskAnchorPaths,
  scratchWorkspacePath,
} = require('./workspace-authority');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-auth-'));
}

/** Production authority returns realpath, so macOS `/var` fixtures must compare against `/private/var`. */
function canonical(p) {
  return fs.realpathSync(path.resolve(p));
}

test('resolveAuthorizedCwd accepts the root and its subdirectories', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'sub'));
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveAuthorizedCwd(root), canonical(root));
    assert.equal(authority.resolveAuthorizedCwd(path.join(root, 'sub')), path.join(canonical(root), 'sub'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAuthorizedCwd rejects paths outside, missing, and file targets', () => {
  const root = makeRoot();
  const outside = makeRoot();
  try {
    fs.writeFileSync(path.join(root, 'note.txt'), 'x');
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveAuthorizedCwd(outside), null);
    assert.equal(authority.resolveAuthorizedCwd(path.join(root, 'missing')), null);
    assert.equal(authority.resolveAuthorizedCwd(path.join(root, 'note.txt')), null);
    assert.equal(authority.resolveAuthorizedCwd(path.join(root, '..', path.basename(root), 'sub')), null);
    assert.equal(authority.resolveAuthorizedCwd(''), null);
    assert.equal(authority.resolveAuthorizedCwd(undefined), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveInside refuses traversal and absolute targets', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'x');
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveInside(root, 'src/a.ts'), path.join(canonical(root), 'src', 'a.ts'));
    assert.equal(authority.resolveInside(root, '..'), null);
    assert.equal(authority.resolveInside(root, path.join('..', 'outside.txt')), null);
    assert.equal(authority.resolveInside(root, path.resolve(os.tmpdir(), 'absolute.txt')), null);
    assert.equal(authority.resolveInside(root, ''), canonical(root));
    assert.equal(authority.resolveInside(path.join(root, '..'), 'x'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveInside refuses .git by name and through an inside link', (t) => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'config'), 'secret');
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist\n');
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveInside(root, '.git/config'), null);
    assert.equal(authority.resolveInside(root, '.GIT/config'), null);
    assert.equal(authority.resolveInside(root, '.gitignore'), path.join(canonical(root), '.gitignore'));

    const link = path.join(root, 'notes');
    try {
      makeDirLink(path.join(root, '.git'), link);
      assert.equal(authority.resolveInside(root, 'notes/config'), null);
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'ENOTSUP') throw error;
      t.diagnostic('directory link creation is not permitted on this host');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Best-effort directory link: junction on Windows (no privilege needed), dir symlink elsewhere. */
function makeDirLink(target, link) {
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(target, link, type);
}

test('resolveInside refuses a directory link that escapes the workspace', (t) => {
  const root = makeRoot();
  const outside = makeRoot();
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'classified\n');
    try {
      makeDirLink(outside, path.join(root, 'escape'));
    } catch (error) {
      t.skip(`directory links unavailable: ${error.code ?? error.message}`);
      return;
    }
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveInside(root, path.join('escape', 'secret.txt')), null);
    assert.equal(authority.resolveInside(root, path.join('escape', 'missing.txt')), null);
    assert.equal(authority.resolveAuthorizedCwd(path.join(root, 'escape')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveInside refuses a file link that escapes the workspace', (t) => {
  const root = makeRoot();
  const outside = makeRoot();
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'classified\n');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'steal.txt'));
    } catch (error) {
      t.skip(`file links unavailable: ${error.code ?? error.message}`);
      return;
    }
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(authority.resolveInside(root, 'steal.txt'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveInside keeps directory links that stay inside the workspace', (t) => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'real'));
    fs.writeFileSync(path.join(root, 'real', 'a.ts'), 'x');
    try {
      makeDirLink(path.resolve(root, 'real'), path.join(root, 'link'));
    } catch (error) {
      t.skip(`directory links unavailable: ${error.code ?? error.message}`);
      return;
    }
    const authority = createWorkspaceAuthority({ workspace: root });
    assert.equal(
      authority.resolveInside(root, path.join('link', 'a.ts')),
      path.join(canonical(root), 'link', 'a.ts'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAuthorizedCwd accepts a workspace configured through a directory link', (t) => {
  // Regression for macOS CI: roots used to be kept lexical while candidates
  // were realpath'd, so a /var -> /private/var prefix (or any linked root)
  // made every temp-dir workspace resolve to null.
  const root = makeRoot();
  const link = path.join(os.tmpdir(), `dsh-auth-root-link-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(root, 'sub'));
    try {
      makeDirLink(root, link);
    } catch (error) {
      t.skip(`directory links unavailable: ${error.code ?? error.message}`);
      return;
    }
    const authority = createWorkspaceAuthority({ workspace: link });
    assert.equal(authority.resolveAuthorizedCwd(link), fs.realpathSync(root));
    assert.equal(
      authority.resolveAuthorizedCwd(path.join(root, 'sub')),
      fs.realpathSync(path.join(root, 'sub')),
    );
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('empty workspace yields a null root that disables everything', () => {
  const authority = createWorkspaceAuthority({ workspace: '' });
  assert.equal(authority.authorizedRoot(), null);
  assert.equal(authority.resolveAuthorizedCwd(os.tmpdir()), null);
  assert.equal(authority.resolveInside(os.tmpdir(), 'x'), null);
});

test('PTY authority can include the Host-owned no-workspace scratch cwd', () => {
  const home = makeRoot();
  const boot = makeRoot();
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    const scratch = scratchWorkspacePath(home);
    fs.mkdirSync(scratch);
    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);

    const ptyAuthority = loadWorkspaceAuthority({ allowScratchCwd: true });
    assert.equal(ptyAuthority.resolveAuthorizedCwd(scratch), canonical(scratch));
    const strictAuthority = loadWorkspaceAuthority();
    assert.equal(strictAuthority.resolveAuthorizedCwd(scratch), null);
  } finally {
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
  }
});

test('resolveAuthorizedCwd accepts a second authorized root and rejects an outsider', () => {
  const boot = makeRoot();
  const extra = makeRoot();
  const outsider = makeRoot();
  try {
    fs.mkdirSync(path.join(extra, 'src'));
    const authority = createWorkspaceAuthority({
      workspace: boot,
      extraWorkspaces: [extra],
    });
    assert.equal(authority.resolveAuthorizedCwd(boot), canonical(boot));
    assert.equal(authority.resolveAuthorizedCwd(extra), canonical(extra));
    assert.equal(
      authority.resolveAuthorizedCwd(path.join(extra, 'src')),
      path.join(canonical(extra), 'src'),
    );
    assert.equal(authority.resolveAuthorizedCwd(outsider), null);
    assert.equal(authority.resolveInside(extra, 'src'), path.join(canonical(extra), 'src'));
    assert.equal(authority.resolveInside(extra, '..'), null);
    assert.equal(authority.resolveInside(outsider, 'src'), null);
    assert.deepEqual(authority.authorizedRoots(), [canonical(boot), canonical(extra)]);
  } finally {
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

test('listRegisteredWorkspaces is consulted on every resolve', () => {
  const boot = makeRoot();
  const extra = makeRoot();
  try {
    const listed = [];
    const authority = createWorkspaceAuthority({
      workspace: boot,
      listRegisteredWorkspaces: () => listed,
    });
    assert.equal(authority.resolveAuthorizedCwd(extra), null);
    listed.push(extra);
    assert.equal(authority.resolveAuthorizedCwd(extra), canonical(extra));
  } finally {
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
  }
});

test('resolveAuthorizedCwd accepts trailing separators and Windows drive-letter case', () => {
  const root = makeRoot();
  try {
    const authority = createWorkspaceAuthority({ workspace: root });
    const withSep = `${root}${path.sep}`;
    assert.equal(authority.resolveAuthorizedCwd(withSep), canonical(withSep));
    if (process.platform === 'win32' && /^[A-Za-z]:/.test(root)) {
      const flipped = root[0] === root[0].toUpperCase()
        ? root[0].toLowerCase() + root.slice(1)
        : root[0].toUpperCase() + root.slice(1);
      assert.notEqual(authority.resolveAuthorizedCwd(flipped), null);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readHarnessRegisteredWorkspacePaths reads workspace.json and ignores junk', () => {
  const home = makeRoot();
  const boot = makeRoot();
  const registered = makeRoot();
  const outsider = makeRoot();
  try {
    assert.deepEqual(readHarnessRegisteredWorkspacePaths(home), []);
    fs.mkdirSync(path.join(home, 'storages'));
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), '{not json', 'utf8');
    assert.deepEqual(readHarnessRegisteredWorkspacePaths(home), []);
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: ['ws-1'] },
      tables: {
        workspaces: {
          'ws-1': { path: registered, title: '测试' },
          'ws-2': { title: 'missing-path' },
          'ws-3': null,
        },
      },
    }, null, 2)}\n`, 'utf8');
    assert.deepEqual(readHarnessRegisteredWorkspacePaths(home), [registered]);
    const authority = createWorkspaceAuthority({
      workspace: boot,
      listRegisteredWorkspaces: () => readHarnessRegisteredWorkspacePaths(home),
    });
    assert.equal(authority.resolveAuthorizedCwd(registered), canonical(registered));
    assert.equal(authority.resolveAuthorizedCwd(outsider), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(registered, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

test('loadWorkspaceAuthority authorizes a harness-registered workspace outside the boot folder', () => {
  const home = makeRoot();
  const boot = makeRoot();
  const sibling = makeRoot();
  const nested = path.join(boot, 'nested');
  fs.mkdirSync(nested);
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    fs.mkdirSync(path.join(home, 'storages'));
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      tables: {
        workspaces: {
          'ws-sibling': { path: sibling },
          'ws-nested': { path: nested },
        },
      },
    })}\n`, 'utf8');
    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    const authority = loadWorkspaceAuthority();
    assert.equal(authority.resolveAuthorizedCwd(sibling), canonical(sibling));
    assert.equal(authority.resolveAuthorizedCwd(nested), canonical(nested));
    assert.equal(authority.resolveAuthorizedCwd(boot), canonical(boot));
  } finally {
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('isHighRiskWorkspaceRoot rejects anchors and their ancestors, keeps ordinary projects', () => {
  const base = makeRoot();
  try {
    const anchorParent = path.join(base, 'users', 'me');
    const anchor = path.join(anchorParent, 'AppData');
    const project = path.join(anchorParent, 'Documents', 'proj');
    fs.mkdirSync(anchor, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    const anchors = [fs.realpathSync(anchor)];
    assert.equal(isHighRiskWorkspaceRoot(fs.realpathSync(anchor), anchors), true);
    assert.equal(isHighRiskWorkspaceRoot(fs.realpathSync(anchorParent), anchors), true);
    assert.equal(isHighRiskWorkspaceRoot(fs.realpathSync(project), anchors), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('filterRegisteredWorkspaceRoots drops the user home and the desktop dsh-home root', () => {
  const home = makeRoot();
  const userData = path.join(home, 'userData');
  const dshHome = path.join(userData, 'dsh-home');
  const sibling = makeRoot();
  fs.mkdirSync(dshHome, { recursive: true });
  try {
    setDesktopDshHome(dshHome);
    const kept = filterRegisteredWorkspaceRoots([
      os.homedir(),
      dshHome,
      userData,
      sibling,
      '',
      42,
    ]);
    assert.deepEqual(kept, [sibling]);
    assert.ok(highRiskAnchorPaths().includes(fs.realpathSync(os.homedir())));
  } finally {
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('loadWorkspaceAuthority ignores a registered user-home or dsh-home trust root', () => {
  const base = makeRoot();
  const home = path.join(base, 'dsh-home');
  const boot = makeRoot();
  const sibling = makeRoot();
  fs.mkdirSync(home, { recursive: true });
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    fs.mkdirSync(path.join(home, 'storages'));
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      tables: {
        workspaces: {
          'ws-home': { path: os.homedir() },
          'ws-dsh-home': { path: home },
          'ws-user-data': { path: base },
          'ws-sibling': { path: sibling },
        },
      },
    })}\n`, 'utf8');
    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    const authority = loadWorkspaceAuthority();
    assert.equal(authority.resolveAuthorizedCwd(os.homedir()), null);
    assert.equal(authority.resolveAuthorizedCwd(home), null);
    assert.equal(authority.resolveAuthorizedCwd(base), null);
    assert.equal(authority.resolveAuthorizedCwd(sibling), canonical(sibling));
  } finally {
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('loadWorkspaceAuthority ignores a registered filesystem root', () => {
  const home = makeRoot();
  const boot = makeRoot();
  const sibling = makeRoot();
  const outsider = makeRoot();
  const volumeRoot = path.parse(process.cwd()).root;
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    fs.mkdirSync(path.join(home, 'storages'));
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      tables: {
        workspaces: {
          'ws-volume': { path: volumeRoot },
          'ws-sibling': { path: sibling },
        },
      },
    })}\n`, 'utf8');
    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    const authority = loadWorkspaceAuthority();
    assert.equal(authority.resolveAuthorizedCwd(volumeRoot), null);
    assert.equal(authority.resolveAuthorizedCwd(outsider), null);
    assert.equal(authority.resolveAuthorizedCwd(sibling), canonical(sibling));
  } finally {
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});
