'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qaDriversAllowed, qaFlag, qaRemoteMode } = require('./qa-gate');

test('source runs honor QA flags without an extra switch', () => {
  assert.equal(qaDriversAllowed({ isPackaged: false, env: {} }), true);
  assert.equal(qaFlag('DSH_QA', { isPackaged: false, env: { DSH_QA: '1' } }), true);
  assert.equal(qaFlag('DSH_QA', { isPackaged: false, env: {} }), false);
  assert.equal(qaFlag('DSH_QA', { isPackaged: false, env: { DSH_QA: 'yes' } }), false);
});

test('qaRemoteMode accepts 1 and cold, never a raw truthy string', () => {
  assert.equal(qaRemoteMode({ isPackaged: false, env: { DSH_QA_REMOTE: '1' } }), 'full');
  assert.equal(qaRemoteMode({ isPackaged: false, env: { DSH_QA_REMOTE: 'cold' } }), 'cold');
  assert.equal(qaRemoteMode({ isPackaged: false, env: { DSH_QA_REMOTE: 'yes' } }), null);
  assert.equal(qaRemoteMode({ isPackaged: true, env: { DSH_QA_REMOTE: 'cold' } }), null);
  assert.equal(
    qaRemoteMode({ isPackaged: true, env: { DSH_QA_REMOTE: 'cold', DSHD_ALLOW_PACKAGED_QA: '1' } }),
    'cold',
  );
});

test('packaged runs ignore ambient QA flags unless DSHD_ALLOW_PACKAGED_QA=1', () => {
  assert.equal(qaDriversAllowed({ isPackaged: true, env: {} }), false);
  assert.equal(qaFlag('DSH_QA_SHELL', { isPackaged: true, env: { DSH_QA_SHELL: '1' } }), false);
  assert.equal(qaFlag('DSH_SMOKE', { isPackaged: true, env: { DSH_SMOKE: '1' } }), false);
  assert.equal(
    qaFlag('DSH_QA_SHELL', {
      isPackaged: true,
      env: { DSH_QA_SHELL: '1', DSHD_ALLOW_PACKAGED_QA: '1' },
    }),
    true,
  );
});

test('index.js consumes QA env only through the gate and loads QA drivers lazily', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const smokeSource = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  // The production entry never requires the QA drivers; it only lazily loads
  // the smoke module inside the DSH_SMOKE gate.
  for (const mod of [
    'release-ui-walk',
    'composer-official-qa',
    'appendix-a-qa',
    'shell-p0-qa',
    'packaged-p0',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`require\\('\\./${mod}'\\)`),
      `${mod} must not be required by index.js at all`,
    );
    // Inside the smoke module the drivers stay lazy (no top-level requires):
    // they must not ship resident even in a smoke-gated main process.
    assert.doesNotMatch(
      smokeSource,
      new RegExp(`^const .*require\\('\\.\\./${mod}'\\)`, 'm'),
      `${mod} must be required lazily inside the smoke path`,
    );
    assert.match(smokeSource, new RegExp(`require\\('\\.\\./${mod}'\\)`));
  }
  assert.doesNotMatch(source, /^const .*require\('\.\/smoke'\)/m, 'smoke module must load lazily');
  assert.match(source, /require\('\.\/smoke'\)/);
  // Raw env reads of the QA flags would bypass the packaged gate.
  for (const qaSource of [source, smokeSource]) {
    assert.doesNotMatch(qaSource, /process\.env\.DSH_QA[A-Z_]*\s*===\s*'1'/);
    assert.doesNotMatch(qaSource, /process\.env\.DSH_SMOKE\s*===\s*'1'/);
    assert.doesNotMatch(qaSource, /process\.env\.DSH_THEME_SMOKE\s*===\s*'1'/);
  }
  assert.match(source, /require\('\.\/qa-gate'\)/);
});

test('packaged QA rehearsal scripts opt in explicitly', () => {
  const root = path.join(__dirname, '..', '..');
  for (const script of ['run-packaged-smoke.mjs', 'run-packaged-p0.mjs']) {
    const source = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
    assert.match(source, /DSHD_ALLOW_PACKAGED_QA/, `${script} must set the packaged QA switch`);
  }
});
