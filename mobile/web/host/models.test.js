import test from 'node:test';
import assert from 'node:assert/strict';
import { effortsFor, flattenModels, modelChipLabel } from './models.js';

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

test('effortsFor returns empty for models without reasoning', () => {
  const { rows } = flattenModels(catalog);
  assert.equal(effortsFor({ provider: 'dsh', model: 'lite' }, rows).length, 0);
  assert.equal(effortsFor({ provider: 'dsh', model: 'r3' }, rows).length, 2);
});
