const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { projectRoot } = require('./paths');
const { DEFAULT_CLOSE_TO_TRAY } = require('./close-behavior');
const { normalizeRelayHostToken } = require('../shared/relay-auth');
const { normalizeRelayOrigin } = require('../shared/lan');
const { normalizeRemotePatch } = require('./remote-patch');

const REMOTE_FEATURE_ENABLED = false;

const DEFAULTS = {
  workspace: '',
  host: '127.0.0.1',
  port: 3080,
  apiKey: '',
  baseUrl: '',
  dshBin: '',
  nodeBin: '',
  closeToTray: DEFAULT_CLOSE_TO_TRAY,
  openAtLogin: false,
  openDevTools: false,
  theme: 'deepseek',
  locale: 'zh',
  githubToken: '',
  remoteEnabled: false,
  remotePort: 6767,
  remoteToken: '',
  remoteMode: 'lan',
  remoteBindAddress: '127.0.0.1',
  remoteLanTls: false,
  remoteRelayUrl: '',
  remoteRelayEndpoint: '',
  remoteRelayUseTls: false,
  remoteAppBaseUrl: '',
  remoteRelayToken: '',
  harnessAutoRestart: true,
  harnessRestartMaxAttempts: 3,
  harnessRestartBaseDelayMs: 1000,
  pluginRecovery: {
    skipUserPlugins: false,
    reason: '',
    at: '',
    appVersion: '',
  },
  quitAfterStart: true,
  autoStartDesktop: true,
  askOnUpdate: true,
  disabledPlugins: [],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRendererConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Config patch must be an object');
  }
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['closeToTray', 'openAtLogin', 'openDevTools', 'harnessAutoRestart', 'autoStartDesktop'].includes(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'harnessRestartMaxAttempts') {
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        throw new TypeError(`${key} must be an integer from 1 to 10`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'harnessRestartBaseDelayMs') {
      if (!Number.isInteger(value) || value < 500 || value > 30_000) {
        throw new TypeError(`${key} must be an integer from 500 to 30000`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'locale') {
      if (value !== 'zh' && value !== 'en') {
        throw new TypeError('locale must be zh or en');
      }
      next.locale = value;
      continue;
    }
    if (key === 'theme') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
        throw new TypeError('theme must be a valid theme id');
      }
      next.theme = value;
      continue;
    }
    if (key === 'githubToken') {
      if (typeof value !== 'string' || value.length > 512 || /[\r\n\0]/.test(value)) {
        throw new TypeError('githubToken must be a valid string');
      }
      next.githubToken = value.trim();
      continue;
    }
    throw new Error(`Config field is not renderer-writable: ${key}`);
  }
  return next;
}

/**
 * Bind addresses the remote gateway may listen on: loopback default (127.0.0.1),
 * the all-interfaces wildcard (0.0.0.0 when explicitly set), or one dotted-quad
 * IPv4. Anything else falls back to the default so a corrupt config can never
 * widen or break the listener.
 */
function normalizeRemoteBindAddress(value) {
  const raw = String(value || '').trim();
  if (raw === '0.0.0.0') {
    return raw;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return DEFAULTS.remoteBindAddress;
  }
  const octets = raw.split('.').map((part) => Number(part));
  return octets.every((part) => part >= 0 && part <= 255) ? raw : DEFAULTS.remoteBindAddress;
}

function normalizeRemoteConfig(config) {
  const next = { ...config };
  next.remoteEnabled = REMOTE_FEATURE_ENABLED && next.remoteEnabled === true;
  // ChisaCode Away uses host:port endpoints. Empty → desktop built-in relay.
  const { normalizeRelayEndpoint, DEFAULT_RELAY_ENDPOINT, normalizePublicAppBaseUrl } = require('../shared/lan');
  const relayCandidate = typeof next.remoteRelayUrl === 'string'
    ? next.remoteRelayUrl
    : (next.remoteRelayEndpoint || '');
  const endpoint = normalizeRelayEndpoint(relayCandidate) || DEFAULT_RELAY_ENDPOINT;
  next.remoteRelayEndpoint = endpoint;
  next.remoteRelayUrl = endpoint;
  next.remoteRelayUseTls = next.remoteRelayUseTls === true;
  // Empty stays empty — never backfill the relay origin as an SPA landing host.
  next.remoteAppBaseUrl = normalizePublicAppBaseUrl(next.remoteAppBaseUrl, {
    relayEndpoint: endpoint,
  });
  // Legacy host token is ignored for product pairing; keep field for migration clears.
  next.remoteRelayToken = normalizeRelayHostToken(next.remoteRelayToken);
  next.remoteMode = REMOTE_FEATURE_ENABLED
    && next.remoteMode === 'relay'
    ? 'relay'
    : 'lan';
  const remotePort = Number(next.remotePort);
  next.remotePort = Number.isInteger(remotePort) && remotePort >= 1024 && remotePort <= 65535
    ? remotePort
    : DEFAULTS.remotePort;
  next.remoteBindAddress = normalizeRemoteBindAddress(next.remoteBindAddress);
  next.remoteLanTls = next.remoteLanTls === true;
  return next;
}

function normalizeHarnessRecovery(config) {
  const next = { ...config };
  next.harnessAutoRestart = typeof next.harnessAutoRestart === 'boolean'
    ? next.harnessAutoRestart
    : DEFAULTS.harnessAutoRestart;
  const maxAttempts = Number(next.harnessRestartMaxAttempts);
  next.harnessRestartMaxAttempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10
    ? maxAttempts
    : DEFAULTS.harnessRestartMaxAttempts;
  const baseDelayMs = Number(next.harnessRestartBaseDelayMs);
  next.harnessRestartBaseDelayMs = Number.isInteger(baseDelayMs) && baseDelayMs >= 500 && baseDelayMs <= 30_000
    ? baseDelayMs
    : DEFAULTS.harnessRestartBaseDelayMs;
  return next;
}

function normalizePluginRecovery(config) {
  const value = isPlainObject(config.pluginRecovery) ? config.pluginRecovery : {};
  return {
    ...config,
    pluginRecovery: {
      skipUserPlugins: value.skipUserPlugins === true,
      reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '',
      at: typeof value.at === 'string' ? value.at.slice(0, 80) : '',
      appVersion: typeof value.appVersion === 'string' ? value.appVersion.slice(0, 80) : '',
    },
  };
}

function normalizeDisabledPlugins(list) {
  const { withoutDshImAliases } = require('./dsh-im-desktop');
  return [...new Set(withoutDshImAliases((Array.isArray(list) ? list : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean)))];
}

function normalizeLauncherSettings(config) {
  return {
    ...config,
    quitAfterStart: config.quitAfterStart !== false,
    autoStartDesktop: config.autoStartDesktop !== false,
    askOnUpdate: config.askOnUpdate !== false,
    disabledPlugins: normalizeDisabledPlugins(config.disabledPlugins),
  };
}

function normalizeLauncherConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Config patch must be an object');
  }
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['quitAfterStart', 'autoStartDesktop', 'askOnUpdate'].includes(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
      }
      next[key] = value;
      continue;
    }
    throw new Error(`Config field is not launcher-writable: ${key}`);
  }
  return next;
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function credentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Envelope marker for OS-keychain-encrypted credentials.json. */
const CREDENTIALS_ENVELOPE_VERSION = 'safeStorage-v1';

/**
 * The injectable safeStorage face (tests replace it; plain Node has none).
 * Encryption is used only when the OS keychain is actually available —
 * otherwise reads and writes stay plaintext so no platform loses credentials.
 */
let safeStorageImpl = safeStorage;

function setSafeStorageForTests(impl) {
  safeStorageImpl = impl === undefined ? safeStorage : impl;
}

function canEncryptCredentials() {
  try {
    return Boolean(safeStorageImpl
      && typeof safeStorageImpl.isEncryptionAvailable === 'function'
      && safeStorageImpl.isEncryptionAvailable()
      && typeof safeStorageImpl.encryptString === 'function'
      && typeof safeStorageImpl.decryptString === 'function');
  } catch {
    return false;
  }
}

function isEncryptedCredentialsFile(raw) {
  return Boolean(raw)
    && typeof raw === 'object'
    && raw.version === CREDENTIALS_ENVELOPE_VERSION
    && typeof raw.payload === 'string';
}

/**
 * Read credentials.json, decrypting the safeStorage envelope when present.
 * A legacy plaintext file that can now be encrypted is migrated in place
 * (one-time rewrite) so secrets do not stay on disk in the clear.
 */
function readCredentials() {
  const file = credentialsPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (isEncryptedCredentialsFile(raw)) {
    if (!canEncryptCredentials()) {
      return {};
    }
    try {
      const json = safeStorageImpl.decryptString(Buffer.from(raw.payload, 'base64'));
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  const plain = raw && typeof raw === 'object' ? raw : {};
  if (canEncryptCredentials()) {
    try {
      writeCredentials(plain);
    } catch {
      // Migration is best-effort; the plaintext copy stays readable.
    }
  }
  return plain;
}

/**
 * User-visible credential storage mode for About / diagnostics:
 * `encrypted` when safeStorage (OS keychain) protects credentials.json,
 * `plaintext` on platforms where it falls back to a clear-text file
 * (e.g. Linux without an unlocked keyring).
 */
function credentialStorageMode() {
  return canEncryptCredentials() ? 'encrypted' : 'plaintext';
}

/** Persist credentials, encrypted via safeStorage whenever the OS allows. */
function writeCredentials(data) {
  const file = credentialsPath();
  if (!canEncryptCredentials()) {
    writeJson(file, data);
    return;
  }
  const payload = safeStorageImpl.encryptString(JSON.stringify(data)).toString('base64');
  writeJson(file, { version: CREDENTIALS_ENVELOPE_VERSION, payload });
}

function isUnsafeWorkspace(dir) {
  if (!app.isPackaged || !dir) {
    return false;
  }
  const resources = path.normalize(process.resourcesPath);
  const resolved = path.normalize(dir);
  return resolved === resources || resolved.startsWith(`${resources}${path.sep}`);
}

function defaultWorkspace() {
  if (app.isPackaged) {
    return path.join(app.getPath('documents'), 'Deepseek-Harness-Desktop');
  }
  return projectRoot();
}

function loadConfig() {
  const stored = readJson(configPath(), {});
  const creds = readCredentials();
  let config = {
    ...DEFAULTS,
    ...stored,
    apiKey: typeof creds.apiKey === 'string' ? creds.apiKey : stored.apiKey || '',
    baseUrl: typeof creds.baseUrl === 'string' ? creds.baseUrl : stored.baseUrl || '',
    githubToken: typeof creds.githubToken === 'string' ? creds.githubToken : stored.githubToken || '',
    remoteToken: typeof creds.remoteToken === 'string' ? creds.remoteToken : stored.remoteToken || '',
    remoteRelayToken: typeof creds.remoteRelayToken === 'string' ? creds.remoteRelayToken : '',
    remoteDevices: Array.isArray(creds.remoteDevices) ? creds.remoteDevices : [],
  };
  config = normalizeLauncherSettings(
    normalizeRemoteConfig(normalizePluginRecovery(normalizeHarnessRecovery(config))),
  );
  if (!config.workspace || isUnsafeWorkspace(config.workspace)) {
    config.workspace = defaultWorkspace();
  }
  if (config.locale !== 'en' && config.locale !== 'zh') {
    config.locale = DEFAULTS.locale;
  }
  delete config.pluginSubagent;
  delete config.pluginGenUi;
  return config;
}

function saveConfig(next) {
  const current = loadConfig();
  const merged = normalizeLauncherSettings(
    normalizeRemoteConfig(normalizePluginRecovery(normalizeHarnessRecovery({ ...current, ...next }))),
  );
  if (merged.githubToken === '********') {
    merged.githubToken = current.githubToken;
  }
  if (merged.apiKey === '********') {
    merged.apiKey = current.apiKey;
  }
  merged.locale = merged.locale === 'en' ? 'en' : 'zh';
  delete merged.pluginSubagent;
  delete merged.pluginGenUi;
  const { apiKey, baseUrl, githubToken, remoteToken, remoteRelayToken, remoteDevices, ...publicLayer } = merged;
  writeJson(configPath(), publicLayer);
  writeCredentials({
    apiKey: apiKey || '',
    baseUrl: baseUrl || '',
    githubToken: githubToken || '',
    remoteToken: remoteToken || '',
    remoteRelayToken: remoteRelayToken || '',
    remoteDevices: Array.isArray(remoteDevices) ? remoteDevices : [],
  });
  return merged;
}

function publicConfig(config) {
  return {
    ...config,
    apiKey: config.apiKey ? '********' : '',
    githubToken: config.githubToken ? '********' : '',
    hasApiKey: Boolean(config.apiKey),
    hasGithubToken: Boolean(config.githubToken),
    remoteEnabled: Boolean(config.remoteEnabled),
    remoteAvailable: REMOTE_FEATURE_ENABLED,
    remotePort: Number(config.remotePort) || DEFAULTS.remotePort,
    remoteMode: config.remoteMode === 'relay' ? 'relay' : 'lan',
    remoteBindAddress: normalizeRemoteBindAddress(config.remoteBindAddress),
    remoteLanTls: config.remoteLanTls === true,
    remoteRelayUrl: config.remoteRelayUrl || '',
    remoteToken: '',
    remoteRelayToken: '',
    remoteDevices: [],
  };
}

function parkRemoteSnapshot(snap) {
  const base = snap && typeof snap === 'object' ? snap : {};
  return {
    ...base,
    available: false,
    enabled: false,
    listening: false,
    urls: [],
    token: '',
  };
}

function readDisabledPlugins(options = {}) {
  if (Array.isArray(options.disabledPlugins)) {
    return options.disabledPlugins;
  }
  try {
    if (!app?.getPath) {
      return [];
    }
    return loadConfig().disabledPlugins || [];
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULTS,
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  saveConfig,
  publicConfig,
  parkRemoteSnapshot,
  defaultWorkspace,
  configPath,
  credentialsPath,
  credentialStorageMode,
  setSafeStorageForTests,
  readDisabledPlugins,
  normalizeHarnessRecovery,
  normalizePluginRecovery,
  normalizeRendererConfigPatch,
  normalizeLauncherConfigPatch,
  normalizeRemotePatch,
  normalizeRelayOrigin,
  normalizeRemoteBindAddress,
  normalizeRemoteConfig,
};
