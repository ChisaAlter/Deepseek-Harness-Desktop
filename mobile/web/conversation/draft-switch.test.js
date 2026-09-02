import test from 'node:test';
import assert from 'node:assert/strict';
import { switchDraft } from './draft-switch.js';
import { createDraftStore } from '../chisacode/controller.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('switchDraft persists the outgoing draft and restores the incoming one', () => {
  const store = createDraftStore(memStorage(), 'srv');
  let r = switchDraft({ store, fromId: 'A', toId: 'B', currentText: 'CMP-018 草稿', currentAttachments: [{ mediaType: 'image/png', data: 'x' }] });
  assert.equal(r.text, '');
  assert.deepEqual(r.attachments, []);
  r = switchDraft({ store, fromId: 'B', toId: 'A', currentText: '', currentAttachments: [] });
  assert.equal(r.text, 'CMP-018 草稿');
  assert.equal(r.attachments.length, 1);
});

test('switchDraft does not rely on input events: unsaved text still round-trips', () => {
  const store = createDraftStore(memStorage(), 'srv');
  // Simulate a programmatic textarea value that never fired `input`.
  switchDraft({ store, fromId: 'A', toId: 'B', currentText: 'typed-without-input-event', currentAttachments: [] });
  assert.equal(store.load('A'), 'typed-without-input-event');
});

test('switchDraft with the same id only reads', () => {
  const store = createDraftStore(memStorage(), 'srv');
  store.save('A', 'x');
  const r = switchDraft({ store, fromId: 'A', toId: 'A', currentText: 'stale-dom', currentAttachments: [] });
  assert.equal(r.text, 'x');
  assert.equal(store.load('A'), 'x');
});

test('switchDraft clears the outgoing entry when its text is empty', () => {
  const store = createDraftStore(memStorage(), 'srv');
  store.save('A', 'old');
  switchDraft({ store, fromId: 'A', toId: 'B', currentText: '', currentAttachments: [] });
  assert.equal(store.load('A'), '');
});

test('switchDraft tolerates a missing store or ids', () => {
  assert.deepEqual(switchDraft({ store: null, fromId: 'A', toId: 'B', currentText: 'x', currentAttachments: [] }), { text: '', attachments: [] });
  const store = createDraftStore(memStorage(), 'srv');
  assert.deepEqual(switchDraft({ store, fromId: '', toId: '', currentText: 'x', currentAttachments: [] }), { text: '', attachments: [] });
});
