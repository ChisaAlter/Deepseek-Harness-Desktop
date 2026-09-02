import test from 'node:test';
import assert from 'node:assert/strict';
import { effortsFor, flattenModels, isRoutable, modelChipLabel, selectionFromProjection } from './models.js';

const catalog = {
  current: { provider: 'dsh', model: 'r3', reasoningEffort: 'high' },
  groups: [
    {
      id: 'dsh',
      name: 'DeepSeek',
      models: [
        {
          id: 'r3',
          name: 'DeepSeek R3',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        },
        { id: 'lite', name: 'Lite' },
      ],
    },
  ],
};

test('flattenModels keeps reasoning only when efforts exist', () => {
  const { rows } = flattenModels(catalog);
  assert.equal(rows[0].reasoning.efforts.length, 2);
  assert.equal(rows[1].reasoning, null);
});

test('modelChipLabel hides effort when the model has no reasoning table', () => {
  const { rows, current } = flattenModels(catalog);
  assert.equal(modelChipLabel(current, rows), 'DeepSeek R3 · high');
  assert.equal(modelChipLabel({ provider: 'dsh', model: 'lite', reasoningEffort: 'high' }, rows), 'Lite');
});

test('the session modelSelection projection wins over the catalog default', () => {
  const hostCatalog = {
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
    routableProviders: ['relay'],
    groups: [
      { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }] },
      { id: 'relay', name: 'Relay', models: [{ id: 'grok-4.6', name: 'grok-4.6' }] },
    ],
  };
  const none = flattenModels(hostCatalog, undefined);
  assert.deepEqual({ provider: none.current.provider, model: none.current.model }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' });
  const picked = flattenModels(hostCatalog, { lastUsed: null, pending: { provider: 'relay', model: 'grok-4.6' } });
  assert.deepEqual({ provider: picked.current.provider, model: picked.current.model }, { provider: 'relay', model: 'grok-4.6' });
  const nextShape = flattenModels(hostCatalog, { next: { provider: 'relay', model: 'grok-4.6', reasoningEffort: 'high' } });
  assert.equal(nextShape.current.reasoningEffort, 'high');
  assert.equal(selectionFromProjection({ pending: { provider: 1 } }), null);
});

test('providers without a credential are reported unroutable', () => {
  const { rows, routableProviders } = flattenModels({
    default: { provider: 'a', model: 'm' },
    routableProviders: ['b'],
    groups: [
      { id: 'a', name: 'A', models: [{ id: 'm', name: 'M' }] },
      { id: 'b', name: 'B', models: [{ id: 'n', name: 'N' }] },
    ],
  });
  assert.deepEqual(routableProviders, ['b']);
  assert.equal(isRoutable(rows[0]), false);
  assert.equal(isRoutable(rows[1]), true);
  // Older hosts without the field: everything stays selectable.
  assert.equal(isRoutable(flattenModels(catalog).rows[0]), true);
});

test('effortsFor returns empty for models without reasoning', () => {
  const { rows } = flattenModels(catalog);
  assert.equal(effortsFor({ provider: 'dsh', model: 'lite' }, rows).length, 0);
  assert.equal(effortsFor({ provider: 'dsh', model: 'r3' }, rows).length, 2);
});
