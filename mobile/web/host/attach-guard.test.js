import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentGuard, IMAGE_UNSUPPORTED_MESSAGE } from './attach-guard.js';
import { flattenModels } from './models.js';

const IMG = [{ mediaType: 'image/png', data: 'x' }];

test('blocks images when the current model declares modalities without image', () => {
  const r = attachmentGuard({ current: { supportsImages: false }, attachments: IMG });
  assert.equal(r.ok, false);
  assert.equal(r.message, IMAGE_UNSUPPORTED_MESSAGE);
  // Same wording as the desktop composer alert (ui-conversation locales).
  assert.equal(IMAGE_UNSUPPORTED_MESSAGE, '当前模型不支持图片，请切换支持图片的模型');
});

test('allows images when the model declares image input', () => {
  assert.equal(attachmentGuard({ current: { supportsImages: true }, attachments: IMG }).ok, true);
});

test('unknown modalities defer to the host (vision fallback lives on the desktop)', () => {
  assert.equal(attachmentGuard({ current: { supportsImages: undefined }, attachments: IMG }).ok, true);
  assert.equal(attachmentGuard({ current: null, attachments: IMG }).ok, true);
});

test('text-only sends are never blocked', () => {
  assert.equal(attachmentGuard({ current: { supportsImages: false }, attachments: [] }).ok, true);
});

test('flattenModels derives supportsImages from inputModalities and mirrors it onto current', () => {
  const catalog = {
    current: { provider: 'ayase', model: 'grok-4.6' },
    groups: [
      { id: 'ayase', name: 'Ayase', models: [{ id: 'grok-4.6', name: 'grok-4.6', inputModalities: ['text'] }] },
      { id: 'deepseek', name: 'DeepSeek', models: [
        { id: 'V4-Flash-Vision', name: 'V4 Flash Vision', inputModalities: ['text', 'image'] },
        { id: 'V4-Flash', name: 'V4 Flash' },
      ] },
    ],
  };
  const flat = flattenModels(catalog);
  const byId = Object.fromEntries(flat.rows.map((r) => [r.id, r.supportsImages]));
  assert.equal(byId['grok-4.6'], false);
  assert.equal(byId['V4-Flash-Vision'], true);
  assert.equal(byId['V4-Flash'], undefined);
  assert.equal(flat.current.supportsImages, false);
});
