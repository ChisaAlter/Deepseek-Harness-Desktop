const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json';
const FIXTURE_URL = 'http://127.0.0.1/plugins.json';
const electronPath = require.resolve('electron');
const catalogPath = require.resolve('./marketplace-catalog');

const LIVE_REGISTRY = {
  name: 'awesome-dsh-plugin',
  url: 'https://awesome-dsh-plugin.com',
  categories: {
    ui: { en: 'UI Enhancements', zh: 'UI 增强' },
    workflow: { en: 'Workflow & Automation', zh: '工作流与自动化' },
  },
  plugins: [
    {
      name: 'dsh-composer-expand',
      owner: '13071301808',
      url: 'https://github.com/13071301808/dsh-composer-expand',
      category: 'ui',
      description: {
        en: 'Composer expand/collapse toggle.',
        zh: '输入框展开收起。',
      },
      npm: 'dsh-composer-expand',
      stars: 4,
      install: 'dsh plugin --profile web add dsh-composer-expand',
      added: '2026-08-15',
    },
    {
      name: 'dsh-status-rotator',
      owner: '01Virex',
      url: 'https://github.com/01Virex/dsh-status-rotator',
      category: 'ui',
      description: {
        en: 'Rotating status phrases.',
        zh: '轮换状态文案。',
      },
      npm: null,
      stars: 21,
      install: 'dsh plugin --profile web add github:01Virex/dsh-status-rotator',
      added: '2026-08-14',
    },
    {
      name: 'dsh-web-ui#dsh-aionui-panel',
      owner: 'DamonKoy',
      url: 'https://github.com/DamonKoy/dsh-web-ui/tree/main/packages/dsh-aionui-panel',
      category: 'ui',
      description: {
        en: 'AionUi right panel.',
        zh: 'AionUi 右侧面板。',
      },
      npm: null,
      stars: 3,
      install: 'dsh plugin --profile web add github:DamonKoy/dsh-web-ui#path:/packages/dsh-aionui-panel',
      added: '2026-08-17',
    },
    {
      name: 'spec-mismatch',
      owner: 'acme',
      url: 'https://github.com/acme/spec-mismatch',
      category: 'ui',
      description: {
        en: 'Install token differs from npm.',
        zh: '安装 token 与 npm 不同。',
      },
      npm: 'npm-name-not-used',
      stars: 1,
      install: 'dsh plugin --profile web add github:acme/spec-mismatch',
      added: '2026-08-18',
    },
    {
      name: 'dsh-genui',
      owner: 'omdsh-dev',
      url: 'https://github.com/omdsh-dev/dsh-genui',
      category: 'ui',
      description: {
        en: 'Dropped genui package.',
        zh: '已下架的 genui 包。',
      },
      npm: '@dsh-external/dsh-genui',
      stars: 196,
      install: 'dsh plugin --profile web add @dsh-external/dsh-genui',
      added: '2026-08-13',
    },
    {
      name: 'old-loop',
      owner: 'example',
      url: 'https://github.com/example/old-loop',
      category: 'workflow',
      description: {
        en: 'Deprecated loop helper.',
        zh: '已弃用的循环助手。',
      },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add github:example/old-loop',
      added: '2026-07-01',
      deprecated: true,
      replacement: 'DamonKoy/dsh-web-ui#dsh-aionui-panel',
    },
    {
      name: 'dsh-whale-desktop-launcher',
      owner: 'HUITianYi',
      url: 'https://github.com/HUITianYi/dsh-whale-desktop-launcher',
      category: 'ui',
      description: {
        en: 'Release tarball install command.',
        zh: '用 Release tarball 写的安装命令。',
      },
      npm: null,
      stars: 1,
      install: 'dsh plugin --profile web add "https://github.com/HUITianYi/dsh-whale-desktop-launcher/releases/latest/download/dsh-whale-desktop-launcher-0.1.0.tgz"',
      added: '2026-08-16',
    },
    {
      name: 'dsh-wallpaper-engine#plugin',
      owner: 'TianYa-DAO',
      url: 'https://github.com/TianYa-DAO/dsh-wallpaper-engine/tree/main/packages/dsh-wallpaper-engine',
      category: 'ui',
      description: {
        en: 'Monorepo plugin with a tarball install command.',
        zh: '安装命令是 tarball 的 monorepo 插件。',
      },
      npm: null,
      stars: 2,
      install: 'dsh plugin --profile web add "https://github.com/TianYa-DAO/dsh-wallpaper-engine/releases/download/dsh-0.1.2/dsh-wallpaper-engine-0.1.2.tgz"',
      added: '2026-08-16',
    },
  ],
};

let userData;
const originalFetch = globalThis.fetch;
const previousElectron = require.cache[electronPath];

function cacheFile() {
  return path.join(userData, 'marketplace-cache.json');
}

function mockElectron(dir) {
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        isPackaged: false,
        getPath(name) {
          if (name === 'userData') return dir;
          return dir;
        },
      },
    },
  };
}

function loadCatalog() {
  delete require.cache[catalogPath];
  mockElectron(userData);
  return require('./marketplace-catalog');
}

function jsonResponse(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls);
  };
  return calls;
}

function byId(items, id) {
  return (items || []).find((item) => item.id === id);
}

function assertNotGithubSearch(calls) {
  for (const call of calls) {
    assert.equal(call.url.includes('api.github.com/search'), false, call.url);
  }
}

test.before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-marketplace-catalog-'));
  mockElectron(userData);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (previousElectron) require.cache[electronPath] = previousElectron;
  else delete require.cache[electronPath];
  delete require.cache[catalogPath];
  fs.rmSync(userData, { recursive: true, force: true });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.DSHD_MARKETPLACE_REGISTRY_URL;
  delete require.cache[catalogPath];
  try {
    fs.unlinkSync(cacheFile());
  } catch {
    // no cache file this test
  }
});

test('live catalog maps npm, github, and #path: install tokens from plugins.json', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const calls = mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();

  assert.equal(result.ok, true);
  assert.equal(result.source, 'live');
  assert.equal(calls[0].url, FIXTURE_URL);
  assertNotGithubSearch(calls);

  const npmPlugin = byId(result.items, '13071301808/dsh-composer-expand');
  assert.equal(npmPlugin.installSpec, 'dsh-composer-expand');
  assert.equal(npmPlugin.packageName, 'dsh-composer-expand');
  assert.equal(npmPlugin.npm, 'dsh-composer-expand');
  assert.equal(npmPlugin.homepage, 'https://github.com/13071301808/dsh-composer-expand');
  assert.equal(npmPlugin.isBundle, true);
  assert.equal(npmPlugin.category, 'ui');
  assert.equal(npmPlugin.added, '2026-08-15');
  assert.deepEqual(npmPlugin.screenshots, []);

  const githubPlugin = byId(result.items, '01Virex/dsh-status-rotator');
  assert.equal(githubPlugin.installSpec, 'github:01Virex/dsh-status-rotator');
  assert.equal(githubPlugin.packageName, '');
  assert.equal(githubPlugin.npm, null);
  assert.equal(githubPlugin.stars, 21);

  const pathPlugin = byId(result.items, 'DamonKoy/dsh-web-ui#dsh-aionui-panel');
  assert.equal(pathPlugin.installSpec, 'github:DamonKoy/dsh-web-ui#path:/packages/dsh-aionui-panel');
  assert.equal(pathPlugin.repo, 'dsh-web-ui#dsh-aionui-panel');
  assert.equal(pathPlugin.owner, 'DamonKoy');

  const mismatch = byId(result.items, 'acme/spec-mismatch');
  assert.equal(mismatch.installSpec, 'npm-name-not-used');
  assert.equal(mismatch.npm, 'npm-name-not-used');
  assert.equal(mismatch.packageName, 'npm-name-not-used');

  const tarball = byId(result.items, 'HUITianYi/dsh-whale-desktop-launcher');
  assert.equal(tarball.installSpec, 'github:HUITianYi/dsh-whale-desktop-launcher');
  assert.equal(tarball.installSpec.includes('.tgz'), false);

  const treeTarball = byId(result.items, 'TianYa-DAO/dsh-wallpaper-engine#plugin');
  assert.equal(
    treeTarball.installSpec,
    'github:TianYa-DAO/dsh-wallpaper-engine#path:/packages/dsh-wallpaper-engine',
  );

  const deprecated = byId(result.items, 'example/old-loop');
  assert.equal(deprecated.isBundle, false);
  assert.equal(deprecated.deprecated, true);
  assert.equal(deprecated.replacement, 'DamonKoy/dsh-web-ui#dsh-aionui-panel');
});

test('locale picks Chinese or English copy and category labels', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const calls = mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace } = loadCatalog();

  const zh = await listMarketplace({ locale: 'zh' });
  assert.equal(byId(zh.items, '13071301808/dsh-composer-expand').description, '输入框展开收起。');
  assert.equal(zh.categories[0].id, 'all');
  assert.equal(zh.categories[0].label, '全部');
  assert.equal(zh.categories[0].count, 7);
  assert.equal(byId(zh.items, 'ChisaAlter/dshbot'), undefined);
  assert.equal(zh.categories[1].id, 'ui');
  assert.equal(zh.categories[1].label, 'UI 增强');
  assert.equal(zh.categories[1].count, 6);
  assert.equal(zh.categories[2].id, 'workflow');
  assert.equal(zh.categories[2].label, '工作流与自动化');
  assert.equal(zh.categories[2].count, 1);
  assert.equal(zh.categories.some((row) => row.id === 'learn'), false);

  const en = await listMarketplace({ locale: 'en' });
  assert.equal(byId(en.items, '13071301808/dsh-composer-expand').description, 'Composer expand/collapse toggle.');
  assert.equal(en.categories[0].label, 'All');
  assert.equal(en.categories[1].label, 'UI Enhancements');

  const zhCn = await listMarketplace({ locale: 'zh-CN' });
  assert.equal(byId(zhCn.items, '01Virex/dsh-status-rotator').description, '轮换状态文案。');
  assert.equal(zhCn.categories[0].label, '全部');

  const defaults = await listMarketplace();
  assert.equal(byId(defaults.items, 'example/old-loop').description, '已弃用的循环助手。');
  assert.equal(calls.length, 1);
});

test('fetch errors without cache fall back to the packed snapshot', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => {
    throw new Error('offline');
  });
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();

  assert.equal(result.source, 'snapshot');
  assert.equal(result.ok, true);
  assert.ok(result.warning);
  assert.ok(result.items.length > 0);
  // Snapshot anchors track the shipped snapshot content: since the 2026-08-27
  // refresh the status-rotator row is npm-published, so its spec is the npm name.
  assert.equal(byId(result.items, '01Virex/dsh-status-rotator').installSpec, 'dsh-status-rotator');
  assert.equal(
    byId(result.items, 'DamonKoy/dsh-web-ui#dsh-aionui-panel').installSpec,
    'github:DamonKoy/dsh-web-ui#path:/packages/dsh-aionui-panel',
  );
});

test('memory and disk cache beat the snapshot; refresh skips TTL', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const liveOnly = {
    categories: { ui: { en: 'UI', zh: '界面' } },
    plugins: [{
      name: 'from-live',
      owner: 'mem',
      url: 'https://github.com/mem/from-live',
      category: 'ui',
      description: { en: 'Live row', zh: '在线行' },
      npm: 'from-live',
      stars: 2,
      install: 'dsh plugin --profile web add from-live',
      added: '2026-08-18',
    }],
  };
  const calls = mockFetch(async () => jsonResponse(liveOnly));
  const catalog = loadCatalog();

  const first = await catalog.listMarketplace();
  assert.equal(first.source, 'live');
  assert.equal(byId(first.items, 'mem/from-live').installSpec, 'from-live');
  assert.equal(calls.length, 1);

  const cached = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  assert.equal(cached.version, 3);
  assert.equal(typeof cached.fetchedAt, 'number');
  assert.ok(Array.isArray(cached.registry.plugins));

  fs.writeFileSync(cacheFile(), JSON.stringify({
    version: 3,
    fetchedAt: Date.now(),
    registry: {
      categories: { ui: { en: 'UI', zh: '界面' } },
      plugins: [{
        name: 'from-disk',
        owner: 'disk',
        url: 'https://github.com/disk/from-disk',
        category: 'ui',
        description: { en: 'Disk row', zh: '磁盘行' },
        npm: null,
        install: 'dsh plugin --profile web add github:disk/from-disk',
        added: '2026-08-18',
      }],
    },
  }), 'utf8');

  globalThis.fetch = async () => {
    throw new Error('should use memory');
  };
  const fromMemory = await catalog.listMarketplace();
  assert.equal(fromMemory.source, 'cache');
  assert.ok(fromMemory.warning);
  assert.ok(byId(fromMemory.items, 'mem/from-live'));
  assert.equal(byId(fromMemory.items, 'disk/from-disk'), undefined);
  assert.equal(byId(fromMemory.items, '01Virex/dsh-status-rotator'), undefined);

  const diskCatalog = loadCatalog();
  const fromDisk = await diskCatalog.listMarketplace();
  assert.equal(fromDisk.source, 'cache');
  assert.ok(fromDisk.warning);
  assert.ok(byId(fromDisk.items, 'disk/from-disk'));
  assert.equal(byId(fromDisk.items, 'mem/from-live'), undefined);

  const refreshCalls = mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const refreshed = await diskCatalog.listMarketplace({ refresh: true });
  assert.equal(refreshed.source, 'live');
  assert.ok(byId(refreshed.items, '13071301808/dsh-composer-expand'));
  assert.equal(refreshCalls.length, 1);
});

test('empty plugins arrays and non-objects are not live', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const catalog = loadCatalog();

  mockFetch(async () => jsonResponse({ plugins: [] }));
  const empty = await catalog.listMarketplace({ refresh: true });
  assert.notEqual(empty.source, 'live');
  assert.equal(empty.source, 'snapshot');

  delete require.cache[catalogPath];
  const catalog2 = loadCatalog();
  mockFetch(async () => jsonResponse('not-json'));
  const invalid = await catalog2.listMarketplace({ refresh: true });
  assert.equal(invalid.source, 'snapshot');

  delete require.cache[catalogPath];
  const catalog3 = loadCatalog();
  mockFetch(async () => jsonResponse({ foo: 1 }));
  const missing = await catalog3.listMarketplace({ refresh: true });
  assert.equal(missing.source, 'snapshot');
});

test('listMarketplace hides DROPPED packages; getMarketplacePlugin still returns them', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace, getMarketplacePlugin } = loadCatalog();
  const listed = await listMarketplace();

  assert.equal(byId(listed.items, 'omdsh-dev/dsh-genui'), undefined);
  assert.equal(listed.items.some((item) => item.packageName === '@dsh-external/dsh-genui'), false);

  const dropped = getMarketplacePlugin('omdsh-dev/dsh-genui');
  assert.equal(dropped.id, 'omdsh-dev/dsh-genui');
  assert.equal(dropped.packageName, '@dsh-external/dsh-genui');
  assert.equal(dropped.npm, '@dsh-external/dsh-genui');
  assert.equal(dropped.description, '已下架的 genui 包。');

  assert.equal(getMarketplacePlugin('missing/plugin'), null);
});

test('a scope-renamed dropped plugin stays hidden (rename bypass closed)', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const renamed = {
    ...LIVE_REGISTRY,
    plugins: [
      ...LIVE_REGISTRY.plugins,
      {
        name: 'dsh-genui',
        owner: 'changfenhuang',
        url: 'https://github.com/changfenhuang/dsh-genui',
        category: 'ui',
        description: { en: 'Renamed genui.', zh: '改名后的 genui。' },
        npm: '@changfenhuang/dsh-genui',
        stars: 1,
        install: 'dsh plugin --profile web add @changfenhuang/dsh-genui',
        added: '2026-08-27',
      },
      {
        name: 'dsh-genui',
        owner: 'no-npm-fork',
        url: 'https://github.com/no-npm-fork/dsh-genui',
        category: 'ui',
        description: { en: 'GitHub-only genui fork.', zh: '仅 GitHub 的 genui fork。' },
        npm: null,
        stars: 1,
        install: 'dsh plugin --profile web add github:no-npm-fork/dsh-genui',
        added: '2026-08-27',
      },
    ],
  };
  mockFetch(async () => jsonResponse(renamed));
  const { listMarketplace } = loadCatalog();
  const listed = await listMarketplace({ refresh: true });
  assert.equal(byId(listed.items, 'changfenhuang/dsh-genui'), undefined);
  assert.equal(byId(listed.items, 'no-npm-fork/dsh-genui'), undefined);
  assert.equal(listed.items.some((item) => item.packageName === '@changfenhuang/dsh-genui'), false);
});

test('the shipped offline snapshot carries no dropped-family rows', () => {
  // The snapshot exists so a first launch without network shows a non-empty
  // Discover tab. Dropped rows would be filtered at render time anyway, so a
  // retired plugin in the curated subset is pure dead weight — snapshot
  // refreshes must not reintroduce one.
  const { isDroppedPluginName } = require('./plugins');
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'marketplace-registry-snapshot.json'), 'utf8'));
  assert.ok(Array.isArray(snapshot.plugins) && snapshot.plugins.length > 0);
  const dropped = snapshot.plugins.filter((row) => (
    isDroppedPluginName(row.name) || (row.npm && isDroppedPluginName(row.npm))
  ));
  assert.deepEqual(dropped.map((row) => `${row.owner}/${row.name}`), []);
});

test('an oversized registry response is rejected and falls back', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  const { MAX_REGISTRY_BYTES, listMarketplace } = loadCatalog();
  mockFetch(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'content-length' ? String(MAX_REGISTRY_BYTES + 1) : null) },
    text: async () => { throw new Error('must not read an oversized body'); },
  }));
  const declared = await listMarketplace({ refresh: true });
  assert.notEqual(declared.source, 'live');
  assert.match(declared.warning, /插件目录响应过大/);

  delete require.cache[catalogPath];
  const catalog2 = loadCatalog();
  mockFetch(async () => jsonResponse(`{"plugins": ["${'x'.repeat(catalog2.MAX_REGISTRY_BYTES)}"]}`));
  const chunked = await catalog2.listMarketplace({ refresh: true });
  assert.notEqual(chunked.source, 'live');
  assert.match(chunked.warning, /插件目录响应过大/);
});

test('fetch uses the curated registry URL, not GitHub topic search', async () => {
  const calls = mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace } = loadCatalog();
  await listMarketplace({ refresh: true });
  assert.equal(calls.length > 0, true);
  assert.equal(calls[0].url, DEFAULT_REGISTRY_URL);
  assertNotGithubSearch(calls);
});

test('CACHE_VERSION 2 disk files are ignored', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  fs.writeFileSync(cacheFile(), JSON.stringify({
    version: 2,
    fetchedAt: Date.now(),
    items: [{
      id: 'old/github-topic',
      owner: 'old',
      repo: 'github-topic',
      description: 'legacy topic cache',
      installSpec: 'github:old/github-topic#main',
    }],
  }), 'utf8');
  mockFetch(async () => {
    throw new Error('offline');
  });
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(byId(result.items, 'old/github-topic'), undefined);
  assert.equal(result.source, 'snapshot');
});

test('a still-fresh cache does not claim the online directory failed', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace } = loadCatalog();
  await listMarketplace();
  const cached = await listMarketplace();
  assert.equal(cached.source, 'cache');
  assert.ok(cached.warning);
  assert.equal(cached.warning.includes('无法在线更新'), false);
});

test('disk cache older than one hour is fetched again', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  fs.writeFileSync(cacheFile(), JSON.stringify({
    version: 3,
    fetchedAt: Date.now() - (60 * 60 * 1000) - 1,
    registry: {
      categories: { ui: { en: 'UI', zh: '界面' } },
      plugins: [{
        name: 'stale-disk',
        owner: 'disk',
        url: 'https://github.com/disk/stale-disk',
        category: 'ui',
        description: { en: 'Stale', zh: '过期' },
        npm: 'stale-disk',
        install: 'dsh plugin --profile web add stale-disk',
        added: '2026-08-01',
      }],
    },
  }));
  const calls = mockFetch(async () => jsonResponse(LIVE_REGISTRY));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(result.source, 'live');
  assert.ok(byId(result.items, '13071301808/dsh-composer-expand'));
  assert.equal(byId(result.items, 'disk/stale-disk'), undefined);
  assert.equal(calls.length, 1);
});

test('a hung registry fetch aborts after 4s and uses the snapshot', async (t) => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mockFetch(async (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));
  const { listMarketplace } = loadCatalog();
  const pending = listMarketplace({ refresh: true });
  t.mock.timers.tick(4000);
  const result = await pending;
  assert.equal(result.source, 'snapshot');
  assert.match(result.warning, /超时/);
});

test('last-token github: fallback is empty when the spec is not an allow-listed marketplace spec', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com',
    categories: { ui: { en: 'UI', zh: 'UI' } },
    plugins: [{
      name: 'bad-path',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add github:evil/bad-path#path:/../etc',
      added: '2026-08-18',
    }, {
      name: 'other-repo',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add github:evil/other-repo',
      added: '2026-08-18',
    }],
  }));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(byId(result.items, 'evil/bad-path').installSpec, '');
  assert.equal(byId(result.items, 'evil/other-repo').installSpec, '');
});

test('last-token npm fallback is empty when the row has no registry npm field', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com',
    categories: { ui: { en: 'UI', zh: 'UI' } },
    plugins: [{
      name: 'stray-npm',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add lodash',
      added: '2026-08-18',
    }],
  }));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(byId(result.items, 'evil/stray-npm').installSpec, '');
});
