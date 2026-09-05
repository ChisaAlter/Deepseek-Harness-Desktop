import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const channel of ['weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp', 'office']) {
  test(`${channel} production assembly supplies an authenticated Host transport`, async () => {
    const { createProductionController } = await import(`./plugin-src/host/channels/${channel}/production.mjs`);
    const captured = new Error('captured Harness');
    class Store {
      async load() { return this; }
      list() { return []; }
    }
    const ctx = { credentials: {}, webServer: { port: 3080 }, connection: {
      authenticatedUrl: (url) => `${url}?token=test`,
      authorizeIndex(req, res) { res.writeHead(303, { 'set-cookie': 'session=test; HttpOnly' }); res.end(); },
    } };
    let options;
    await assert.rejects(createProductionController(ctx, {}, {
      ConfigStore: Store,
      workspaces: { reconcile() {} },
      HarnessClient: class { constructor(value) { options = value; throw captured; } },
      Controller: class {
        constructor(value) { this.options = value; }
        async initialize() { this.options.createRuntime({}); }
      },
      Runtime: class { constructor(value) { value.createHarness({ workspace: process.cwd() }); } },
    }), (error) => error === captured);
    assert.equal(typeof options.fetchImpl, 'function');
    assert.equal(typeof options.createWebSocket, 'function');
  });
}
