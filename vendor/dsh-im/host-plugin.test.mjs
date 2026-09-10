import test from 'node:test';
import assert from 'node:assert/strict';

import { createImHostPlugin } from './plugin-src/host/index.mjs';

test('host channels receive webServer from the rc.1 scoped service lookup', async () => {
  const webServer = { port: 3080 };
  const seen = [];
  const applyChannel = async (ctx) => {
    seen.push(ctx.webServer);
  };
  const context = {
    get(name) {
      return name === 'webServer' ? webServer : undefined;
    },
    extend(properties) {
      return { ...this, ...properties };
    },
    inject() {},
    logger() {
      return { error() {} };
    },
  };

  await createImHostPlugin({
    applyFeishu: applyChannel,
    applyWeixin: applyChannel,
    applyDingtalk: applyChannel,
    applyWecom: applyChannel,
    applyQq: applyChannel,
    applySlack: applyChannel,
    applyTelegram: applyChannel,
    applyDiscord: applyChannel,
    applyOffice: applyChannel,
    applyWhatsapp: applyChannel,
  }).apply(context, {});

  assert.equal(seen.length, 10);
  assert.ok(seen.every((value) => value === webServer));
});
