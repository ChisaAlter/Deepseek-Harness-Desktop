const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-test-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath(name) {
        if (name === 'userData') return userData;
        if (name === 'documents') return userData;
        return userData;
      },
    },
  },
};

const {
  DEFAULTS,
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  publicConfig,
  parkRemoteSnapshot,
  saveConfig,
  normalizeHarnessRecovery,
  normalizeRendererConfigPatch,
  normalizeLauncherConfigPatch,
  normalizeRemotePatch,
} = require('./config');

test.after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test('Harness recovery defaults are bounded and enabled', () => {
  assert.equal(DEFAULTS.harnessAutoRestart, true);
  assert.equal(DEFAULTS.harnessRestartMaxAttempts, 3);
  assert.equal(DEFAULTS.harnessRestartBaseDelayMs, 1000);
  assert.deepEqual(normalizeHarnessRecovery({}), {
    harnessAutoRestart: true,
    harnessRestartMaxAttempts: 3,
    harnessRestartBaseDelayMs: 1000,
  });
});

test('invalid recovery settings fall back to safe defaults', () => {
  const invalid = normalizeHarnessRecovery({
    harnessAutoRestart: 'yes',
    harnessRestartMaxAttempts: 0,
    harnessRestartBaseDelayMs: 90_000,
  });
  assert.equal(invalid.harnessAutoRestart, true);
  assert.equal(invalid.harnessRestartMaxAttempts, 3);
  assert.equal(invalid.harnessRestartBaseDelayMs, 1000);

  assert.equal(normalizeHarnessRecovery({ harnessRestartMaxAttempts: 10 }).harnessRestartMaxAttempts, 10);
  assert.equal(normalizeHarnessRecovery({ harnessRestartBaseDelayMs: 500 }).harnessRestartBaseDelayMs, 500);
  assert.equal(normalizeHarnessRecovery({ harnessRestartBaseDelayMs: 30_000 }).harnessRestartBaseDelayMs, 30_000);
});

test('renderer config patch only accepts safe typed fields', () => {
  assert.deepEqual(normalizeRendererConfigPatch({
    closeToTray: false,
    autoStartDesktop: true,
    locale: 'en',
    harnessRestartMaxAttempts: 4,
    githubToken: ' token ',
  }), {
    closeToTray: false,
    autoStartDesktop: true,
    locale: 'en',
    harnessRestartMaxAttempts: 4,
    githubToken: 'token',
  });
  for (const patch of [
    { dshBin: 'C:\\malware.cmd' },
    { nodeBin: 'C:\\malware.exe' },
    { workspace: 'C:\\' },
    { baseUrl: 'https://attacker.invalid' },
    { closeToTray: 'yes' },
    { harnessRestartMaxAttempts: 99 },
  ]) {
    assert.throws(() => normalizeRendererConfigPatch(patch));
  }
});

test('remote IPC patch only accepts RemotePatch fields', () => {
  assert.deepEqual(normalizeRemotePatch({
    remoteEnabled: true,
    remoteMode: 'relay',
    remotePort: 3180,
    remoteRelayUrl: 'https://relay.example/path',
  }), {
    remoteEnabled: true,
    remoteMode: 'relay',
    remotePort: 3180,
    remoteRelayUrl: 'https://relay.example/path',
    remoteRelayUseTls: true,
  });
  assert.deepEqual(normalizeRemotePatch({ remoteEnabled: false }), { remoteEnabled: false });
  assert.deepEqual(
    normalizeRemotePatch({ remoteBindAddress: '127.0.0.1', remoteLanTls: true }),
    { remoteBindAddress: '127.0.0.1', remoteLanTls: true },
  );
  assert.deepEqual(
    normalizeRemotePatch({ remoteBindAddress: ' 192.168.1.20 ' }),
    { remoteBindAddress: '192.168.1.20' },
  );
  assert.deepEqual(
    normalizeRemotePatch({ remoteRelayToken: 'a'.repeat(32) }),
    { remoteRelayToken: 'a'.repeat(32) },
  );
  assert.deepEqual(normalizeRemotePatch({ remoteRelayToken: '' }), { remoteRelayToken: '' });
  for (const patch of [
    { apiKey: 'sk-stolen' },
    { workspace: 'C:\\' },
    { githubToken: 'ghp_stolen' },
    { quitAfterStart: false },
    { autoStartDesktop: true },
    { askOnUpdate: false },
    { remoteToken: 'pair-me' },
    { closeToTray: false },
    { remoteEnabled: 'yes' },
    { remoteMode: 'https' },
    { remotePort: 80 },
    { remoteBindAddress: 'evil; rm -rf /' },
    { remoteBindAddress: '999.0.0.1' },
    { remoteBindAddress: '::' },
    { remoteBindAddress: 42 },
    { remoteLanTls: 'yes' },
  ]) {
    assert.throws(() => normalizeRemotePatch(patch));
  }
});

test('remote bind address and LAN TLS normalize with safe fallbacks', () => {
  const { normalizeRemoteBindAddress, normalizeRemoteConfig } = require('./config');
  assert.equal(DEFAULTS.remoteBindAddress, '127.0.0.1');
  assert.equal(DEFAULTS.remoteLanTls, false);
  assert.equal(normalizeRemoteBindAddress('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeRemoteBindAddress('192.168.1.20'), '192.168.1.20');
  assert.equal(normalizeRemoteBindAddress('0.0.0.0'), '0.0.0.0');
  assert.equal(normalizeRemoteBindAddress('300.0.0.1'), '127.0.0.1');
  assert.equal(normalizeRemoteBindAddress('garbage'), '127.0.0.1');
  assert.equal(normalizeRemoteBindAddress(undefined), '127.0.0.1');
  const normalized = normalizeRemoteConfig({
    remoteBindAddress: 'not-an-ip',
    remoteLanTls: 'yes',
  });
  assert.equal(normalized.remoteBindAddress, '127.0.0.1');
  assert.equal(normalized.remoteLanTls, false);
  const saved = saveConfig({ remoteBindAddress: '127.0.0.1', remoteLanTls: true });
  assert.equal(saved.remoteBindAddress, '127.0.0.1');
  assert.equal(saved.remoteLanTls, true);
  const pub = publicConfig(saved);
  assert.equal(pub.remoteBindAddress, '127.0.0.1');
  assert.equal(pub.remoteLanTls, true);
  saveConfig({ remoteBindAddress: '0.0.0.0', remoteLanTls: false });
});

test('remote defaults to server without enabling pairing and preserves an explicit LAN choice', () => {
  const { normalizeRemoteConfig } = require('./config');
  assert.equal(DEFAULTS.remoteMode, 'relay');
  assert.equal(DEFAULTS.remoteEnabled, false);
  assert.equal(normalizeRemoteConfig({}).remoteMode, 'relay');
  assert.equal(normalizeRemoteConfig({ remoteMode: 'invalid' }).remoteMode, 'relay');
  assert.equal(publicConfig({}).remoteMode, 'relay');
  assert.equal(normalizeRemoteConfig({ remoteMode: 'lan' }).remoteMode, 'lan');
});

test('remote feature is released: the flag is on and the saved config keeps remote settings', () => {
  assert.equal(REMOTE_FEATURE_ENABLED, true);
  const saved = saveConfig({ remoteEnabled: true, remoteMode: 'relay' });
  assert.equal(saved.remoteEnabled, true);
  assert.equal(saved.remoteMode, 'relay');
  const pub = publicConfig(saved);
  assert.equal(pub.remoteAvailable, true);
  assert.equal(pub.remoteEnabled, true);
  saveConfig({ remoteEnabled: false, remoteMode: 'lan' });
});

test('remote relay endpoint normalizes to host:port for ChisaCode transport', () => {
  const customRelay = saveConfig({
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteRelayUrl: 'http://relay.example:8787/path',
    remoteRelayToken: 'a'.repeat(32),
  });
  assert.equal(customRelay.remoteEnabled, true);
  assert.equal(customRelay.remoteRelayUrl, 'relay.example:8787');
  assert.equal(customRelay.remoteRelayEndpoint, 'relay.example:8787');
  const defaultRelay = saveConfig({
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteRelayUrl: 'http://125.124.85.212:8411/x',
    remoteRelayToken: 'a'.repeat(32),
  });
  assert.equal(defaultRelay.remoteRelayUrl, '125.124.85.212:8411');
  const blockedRelay = saveConfig({
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteRelayUrl: 'https://app.chisacode.sh/x',
    remoteRelayToken: 'a'.repeat(32),
  });
  assert.equal(blockedRelay.remoteRelayUrl, '125.124.85.212:8411');
  const httpsRelay = saveConfig({
    remoteEnabled: true,
    remoteMode: 'relay',
    remoteRelayUrl: 'https://relay.example/path',
    remoteRelayToken: 'a'.repeat(32),
  });
  assert.equal(httpsRelay.remoteRelayUrl, 'relay.example:443');
  const lanMode = saveConfig({
    remoteEnabled: true,
    remoteMode: 'lan',
    remoteRelayUrl: '',
    remoteRelayToken: 'a'.repeat(32),
  });
  assert.equal(lanMode.remoteMode, 'lan');
  assert.equal(lanMode.remoteRelayUrl, '125.124.85.212:8411');
  const pub = publicConfig(httpsRelay);
  assert.equal(pub.remoteAvailable, true);
  assert.equal(pub.remoteEnabled, true);
  saveConfig({ remoteEnabled: false, remoteMode: 'lan' });
});

test('remoteAppBaseUrl never backfills relay origin as SPA landing', () => {
  const { normalizeRemoteConfig } = require('./config');
  const { DEFAULT_APP_BASE_URL } = require('../shared/lan');

  assert.equal(DEFAULT_APP_BASE_URL, 'http://125.124.85.212:8411');

  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: '' }).remoteAppBaseUrl, '');
  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: '  ' }).remoteAppBaseUrl, '');
  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: undefined }).remoteAppBaseUrl, '');

  const saved = saveConfig({ remoteAppBaseUrl: '', remoteEnabled: true });
  assert.equal(saved.remoteAppBaseUrl, '');
  assert.notEqual(saved.remoteAppBaseUrl, DEFAULT_APP_BASE_URL);
});

test('remoteAppBaseUrl override rejects relay port', () => {
  const { normalizeRemoteConfig } = require('./config');
  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: 'http://125.124.85.212:8411' }).remoteAppBaseUrl, '');
  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: 'http://125.124.85.212/dshd' }).remoteAppBaseUrl, 'http://125.124.85.212/dshd');
  assert.equal(normalizeRemoteConfig({ remoteAppBaseUrl: 'http://125.124.85.212:3389/dshd' }).remoteAppBaseUrl, 'http://125.124.85.212:3389/dshd');
});

test('parkRemoteSnapshot forces unavailable shape for IPC park path', () => {
  const parked = parkRemoteSnapshot({
    available: true,
    enabled: true,
    listening: true,
    token: 'secret',
    urls: [{ pairingUrl: 'http://10.0.0.4:3180/#offer=secret' }],
  });
  assert.equal(parked.available, false);
  assert.equal(parked.enabled, false);
  assert.equal(parked.listening, false);
  assert.deepEqual(parked.urls, []);
  assert.equal(parked.token, '');
});

test('saveConfig persists normalized recovery settings', () => {
  const saved = saveConfig({
    workspace: userData,
    harnessAutoRestart: false,
    harnessRestartMaxAttempts: 5,
    harnessRestartBaseDelayMs: 2000,
  });
  assert.equal(saved.harnessAutoRestart, false);
  assert.equal(saved.harnessRestartMaxAttempts, 5);
  assert.equal(saved.harnessRestartBaseDelayMs, 2000);

  const loaded = loadConfig();
  assert.equal(loaded.harnessAutoRestart, false);
  assert.equal(loaded.harnessRestartMaxAttempts, 5);
  assert.equal(loaded.harnessRestartBaseDelayMs, 2000);
});

test('saveConfig rejects out-of-range recovery values before writing', () => {
  saveConfig({
    harnessRestartMaxAttempts: 11,
    harnessRestartBaseDelayMs: 499,
  });
  const loaded = loadConfig();
  assert.equal(loaded.harnessRestartMaxAttempts, DEFAULTS.harnessRestartMaxAttempts);
  assert.equal(loaded.harnessRestartBaseDelayMs, DEFAULTS.harnessRestartBaseDelayMs);
});

test('publicConfig masks credentials and only reports presence flags', () => {
  const before = loadConfig();
  saveConfig({ apiKey: 'sk-test-secret', githubToken: 'ghp_test_secret', remoteToken: 'rt-test-secret' });
  try {
    const view = publicConfig(loadConfig());
    assert.equal(view.apiKey, '********');
    assert.equal(view.githubToken, '********');
    assert.equal(view.remoteToken, '');
    assert.equal(view.hasApiKey, true);
    assert.equal(view.hasGithubToken, true);
  } finally {
    saveConfig({ apiKey: before.apiKey, githubToken: before.githubToken, remoteToken: before.remoteToken });
  }
});

test('launcher defaults auto-start desktop, ask on update, and quit after a successful start', () => {
  assert.equal(DEFAULTS.quitAfterStart, true);
  assert.equal(DEFAULTS.autoStartDesktop, true);
  assert.equal(DEFAULTS.askOnUpdate, true);
  assert.deepEqual(DEFAULTS.disabledPlugins, []);
});

test('normalizeDisabledPlugins strips desktop built-in dsh-im and usage-panel aliases', () => {
  const before = loadConfig();
  saveConfig({
    disabledPlugins: ['@xmanrui/dsh-im', 'dsh-im', 'dsh-usage-panel', 'user-pack'],
  });
  try {
    const loaded = loadConfig();
    assert.deepEqual(loaded.disabledPlugins, ['user-pack']);
  } finally {
    saveConfig({ disabledPlugins: before.disabledPlugins });
  }
});

test('launcher config patch only accepts the three boolean shell settings', () => {
  assert.deepEqual(normalizeLauncherConfigPatch({
    quitAfterStart: false,
    autoStartDesktop: false,
    askOnUpdate: false,
  }), {
    quitAfterStart: false,
    autoStartDesktop: false,
    askOnUpdate: false,
  });
  assert.throws(() => normalizeLauncherConfigPatch({ quitAfterStart: 'yes' }));
  assert.throws(() => normalizeLauncherConfigPatch({ disabledPlugins: ['evil'] }));
  assert.throws(() => normalizeLauncherConfigPatch({ apiKey: 'sk-stolen' }));
});
