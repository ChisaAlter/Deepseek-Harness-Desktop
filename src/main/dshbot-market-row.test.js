'use strict';

/**
 * dshbot in-product install path: the desktop merges a first-party catalog
 * row for dshbot into every marketplace payload, so Settings → 插件市场 can
 * one-click install `github:ChisaAlter/dshbot` (the standalone repo) through
 * the curated `installMarketplacePlugin(id)` channel. The Host `installPlugin`
 * channel stays github-only and keeps rejecting `#path:` specs such as the
 * retired `github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dshbot-market-row-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath() {
        return userData;
      },
    },
  },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('network disabled in dshbot-market-row tests');
};

const { isAllowedMarketplaceSpec } = require('./marketplace-spec');
const { installPlugin, installMarketplacePlugin } = require('./marketplace-install');

const DSHBOT_ID = 'ChisaAlter/dshbot';
const DSHBOT_SPEC = 'github:ChisaAlter/dshbot';
const DSHBOT_HOMEPAGE = 'https://github.com/ChisaAlter/dshbot';
const LEGACY_PATH_SPEC = 'github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot';
const FIXTURE_URL = 'http://127.0.0.1/plugins.json';
const catalogPath = require.resolve('./marketplace-catalog');

const OTHER_ROW = {
  name: 'dsh-status-rotator',
  owner: '01Virex',
  url: 'https://github.com/01Virex/dsh-status-rotator',
  category: 'ui',
  description: { en: 'Rotating status phrases.', zh: '轮换状态短句。' },
  npm: null,
  stars: 21,
  install: 'dsh plugin --profile web add github:01Virex/dsh-status-rotator',
  added: '2026-08-14',
};

let dshHomeDir = '';

function profileDir() {
  return path.join(dshHomeDir, 'profiles', 'web');
}

function writeProfileDep(packageName, spec) {
  const dir = profileDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'web',
    dependencies: { [packageName]: spec },
  }, null, 2)}\n`);
}

function writeBundlePlugin(packageName) {
  const dir = path.join(profileDir(), 'node_modules', packageName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: packageName,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, 'cordis.patch.yml'),
    `- insert:\n    - id: dsh-bot\n      name: ${packageName}\n`,
  );
}

function loadFreshCatalog() {
  delete require.cache[catalogPath];
  return require('./marketplace-catalog');
}

function mockFetch(handler) {
  globalThis.fetch = async (url, options = {}) => handler(String(url), options);
}

function jsonResponse(body) {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => text };
}

test.beforeEach(() => {
  dshHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  process.env.DSHD_HOME = dshHomeDir;
});

test.afterEach(() => {
  delete process.env.DSHD_HOME;
  delete process.env.DSHD_MARKETPLACE_REGISTRY_URL;
  globalThis.fetch = async () => {
    throw new Error('network disabled in dshbot-market-row tests');
  };
  fs.rmSync(dshHomeDir, { recursive: true, force: true });
  try {
    fs.unlinkSync(path.join(userData, 'marketplace-cache.json'));
  } catch {
    // no cache this test
  }
});

test.after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(userData, { recursive: true, force: true });
});

test('live catalog without dshbot still lists the first-party dshbot row', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    name: 'awesome-dsh-plugin',
    categories: { workflow: { en: 'Workflow', zh: '工作流' } },
    plugins: [OTHER_ROW],
  }));
  const { listMarketplace } = loadFreshCatalog();
  const result = await listMarketplace({ locale: 'zh' });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'live');
  const row = result.items.find((item) => item.id === DSHBOT_ID);
  assert.ok(row, 'first-party dshbot row is merged into the live payload');
  assert.equal(row.installSpec, DSHBOT_SPEC);
  assert.equal(row.homepage, DSHBOT_HOMEPAGE);
  assert.equal(row.npm, null);
  assert.equal(row.category, 'workflow');
  assert.match(row.description, /机器人|群聊/);
  const all = result.categories.find((category) => category.id === 'all');
  assert.equal(all.count, result.items.length);
});

test('a registry row with the same id overrides the first-party dshbot row', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    name: 'awesome-dsh-plugin',
    plugins: [{
      name: 'dshbot',
      owner: 'ChisaAlter',
      url: 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop/tree/main/vendor/dshbot',
      category: 'workflow',
      description: { en: 'Registry copy.', zh: '登记表收录版。' },
      npm: 'dshbot',
      stars: 3,
      install: 'dsh plugin --profile web add dshbot',
      added: '2026-09-01',
    }],
  }));
  const { listMarketplace } = loadFreshCatalog();
  const result = await listMarketplace({ locale: 'zh' });
  const rows = result.items.filter((item) => item.id === DSHBOT_ID);
  assert.equal(rows.length, 1, 'no duplicate dshbot rows');
  assert.equal(rows[0].installSpec, 'dshbot', 'registry npm spec wins over the first-party #path: spec');
  assert.equal(rows[0].stars, 3);
});

test('getMarketplacePlugin resolves dshbot cold with no fetch and no cache', () => {
  const { getMarketplacePlugin } = loadFreshCatalog();
  const row = getMarketplacePlugin(DSHBOT_ID);
  assert.ok(row, 'dshbot resolves from the first-party merge without any registry');
  assert.equal(row.installSpec, DSHBOT_SPEC);
});

test('the dshbot github spec passes the allow list and Host; legacy #path: stays Host-rejected', async () => {
  const { getMarketplacePlugin } = loadFreshCatalog();
  const row = getMarketplacePlugin(DSHBOT_ID);
  assert.equal(isAllowedMarketplaceSpec(row.installSpec, row), true);
  const hostCalls = [];
  const hostResult = await installPlugin(DSHBOT_SPEC, {
    runPlugin: async (args) => {
      hostCalls.push(args.slice());
      writeProfileDep('dshbot', 'git+https://github.com/ChisaAlter/dshbot.git');
      writeBundlePlugin('dshbot');
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  assert.equal(hostResult.ok, true, 'plain github spec is valid on the Host channel');
  assert.deepEqual(hostCalls, [['add', DSHBOT_SPEC]]);
  const legacyResult = await installPlugin(LEGACY_PATH_SPEC, {
    runPlugin: async () => {
      throw new Error('Host installPlugin must reject #path: before the CLI');
    },
  });
  assert.equal(legacyResult.ok, false);
  assert.match(legacyResult.error, /github:owner\/repo/);
});

test('installMarketplacePlugin(ChisaAlter/dshbot) hands the standalone github spec to the plugin CLI', async () => {
  const calls = [];
  const runPlugin = async (args) => {
    calls.push(args.slice());
    if (args[0] === 'add') {
      writeProfileDep('dshbot', 'git+https://github.com/ChisaAlter/dshbot.git');
      writeBundlePlugin('dshbot');
    }
    return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
  };
  const result = await installMarketplacePlugin(DSHBOT_ID, { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', DSHBOT_SPEC]]);
  assert.equal(result.spec, DSHBOT_SPEC);
});
