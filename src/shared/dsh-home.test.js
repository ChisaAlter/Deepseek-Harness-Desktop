'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const {
  DESKTOP_DSH_HOME_DIRNAME,
  desktopDshHomeFromUserData,
  setDesktopDshHome,
  clearDesktopDshHome,
  getDesktopDshHome,
  tryGetDesktopDshHome,
  applyDesktopDshHome,
  sanitizePackagedDshHomeEnv,
} = require('./dsh-home');

function withEnv(key, value, work) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return work();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test.afterEach(() => {
  clearDesktopDshHome();
  delete process.env.DSHD_HOME;
});

test('desktopDshHomeFromUserData joins the short dsh-home directory', () => {
  const userData = path.join(os.tmpdir(), 'Deepseek-Harness-Desktop');
  assert.equal(
    desktopDshHomeFromUserData(userData),
    path.join(userData, DESKTOP_DSH_HOME_DIRNAME),
  );
  assert.equal(DESKTOP_DSH_HOME_DIRNAME, 'dsh-home');
});

test('getDesktopDshHome ignores DSH_HOME and throws when unset', () => {
  withEnv('DSH_HOME', path.join(os.homedir(), '.dsh'), () => {
    assert.equal(tryGetDesktopDshHome(), '');
    assert.throws(() => getDesktopDshHome(), /desktop DSH home is not configured/);
  });
});

test('DSHD_HOME wins over a configured home and DSH_HOME', () => {
  const configured = path.join(os.tmpdir(), 'configured-dsh-home');
  const fromEnv = path.join(os.tmpdir(), 'env-dshd-home');
  setDesktopDshHome(configured);
  withEnv('DSH_HOME', path.join(os.homedir(), '.dsh'), () => {
    withEnv('DSHD_HOME', fromEnv, () => {
      assert.equal(getDesktopDshHome(), path.resolve(fromEnv));
    });
  });
});

test('setDesktopDshHome is used when DSHD_HOME is unset', () => {
  const configured = path.join(os.tmpdir(), 'configured-dsh-home');
  setDesktopDshHome(configured);
  assert.equal(getDesktopDshHome(), path.resolve(configured));
});

test('applyDesktopDshHome overwrites an inherited DSH_HOME', () => {
  const configured = path.join(os.tmpdir(), 'configured-dsh-home');
  setDesktopDshHome(configured);
  const env = applyDesktopDshHome({
    DSH_HOME: path.join(os.homedir(), '.dsh'),
    KEEP: 'yes',
  });
  assert.equal(env.DSH_HOME, path.resolve(configured));
  assert.equal(env.KEEP, 'yes');
});

test('sanitizePackagedDshHomeEnv drops DSHD_HOME in packaged builds without the switch', () => {
  const inherited = path.join(os.tmpdir(), 'stray-dshd-home');
  const env = { DSHD_HOME: inherited };
  const result = sanitizePackagedDshHomeEnv({ isPackaged: true, env });
  assert.equal(result.dropped, true);
  assert.equal(result.value, inherited);
  assert.equal('DSHD_HOME' in env, false);
});

test('sanitizePackagedDshHomeEnv keeps DSHD_HOME with DSHD_ALLOW_ENV_HOME=1 or in dev', () => {
  const inherited = path.join(os.tmpdir(), 'wanted-dshd-home');
  const packagedAllowed = { DSHD_HOME: inherited, DSHD_ALLOW_ENV_HOME: '1' };
  assert.equal(sanitizePackagedDshHomeEnv({ isPackaged: true, env: packagedAllowed }).dropped, false);
  assert.equal(packagedAllowed.DSHD_HOME, inherited);

  const dev = { DSHD_HOME: inherited };
  assert.equal(sanitizePackagedDshHomeEnv({ isPackaged: false, env: dev }).dropped, false);
  assert.equal(dev.DSHD_HOME, inherited);

  const unset = {};
  assert.equal(sanitizePackagedDshHomeEnv({ isPackaged: true, env: unset }).dropped, false);
});

test('applyDesktopDshHome drops case variants then sets DSH_HOME', () => {
  const configured = path.join(os.tmpdir(), 'configured-dsh-home');
  setDesktopDshHome(configured);
  const inherited = path.join(os.homedir(), '.dsh');
  const input = { dsh_home: inherited, Dsh_Home: inherited, DSH_HOME: inherited, KEEP: 'yes' };
  const env = applyDesktopDshHome(input);
  assert.equal(env.DSH_HOME, path.resolve(configured));
  assert.equal(env.KEEP, 'yes');
  assert.equal('dsh_home' in env, false);
  assert.equal('Dsh_Home' in env, false);
  assert.equal(input.dsh_home, inherited);
});
