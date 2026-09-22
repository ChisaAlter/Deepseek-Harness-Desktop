import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { patchLarkSdkHandshakeSource } from './plugin-src/host/lark-sdk-handshake-patch.mjs';

test('reviewed Lark lifecycle patch works with LF and Windows CRLF', async () => {
  const source = (await readFile(new URL('./node_modules/@larksuiteoapi/node-sdk/es/index.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const patched = patchLarkSdkHandshakeSource(source);
  assert.equal(patchLarkSdkHandshakeSource(source.replaceAll('\n', '\r\n')), patched);
  assert.match(patched, /this\.pendingWsInstance = wsInstance/);
  assert.match(patched, /result\.cancelled/);
  assert.throws(() => patchLarkSdkHandshakeSource(source.replace('this.reconnectGeneration = 0;', 'this.reconnectGeneration = 2;')), /expected exactly one/);
});
