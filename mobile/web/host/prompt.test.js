import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_IMAGE_TYPES, textBlock, imageBlock, promptPayload } from './prompt.js';

// 对应 PromptTest.kt payloadQueuesTextAndAllowedImages。
test('payload queues text and allowed images', () => {
  const payload = promptPayload([
    textBlock('hi'),
    imageBlock('image/png', new Uint8Array([1, 2, 3])),
  ]);
  assert.equal(payload.mode, 'queue');
  assert.equal(payload.content[0].type, 'text');
  assert.equal(payload.content[0].text, 'hi');
  assert.equal(payload.content[1].type, 'image');
  assert.equal(payload.content[1].mediaType, 'image/png');
  assert.equal(payload.content[1].data, Buffer.from([1, 2, 3]).toString('base64'));
});

// 对应 PromptTest.kt imageBlockRejectsUnknownType。
test('imageBlock rejects unknown media types', () => {
  assert.throws(() => imageBlock('image/svg+xml', new Uint8Array([1])), /unsupported image type/);
  assert.deepEqual(ALLOWED_IMAGE_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
});

test('imageBlock encodes large buffers without stack overflow', () => {
  const bytes = new Uint8Array(200000).fill(7);
  const block = imageBlock('image/jpeg', bytes);
  assert.equal(block.data, Buffer.from(bytes).toString('base64'));
});
