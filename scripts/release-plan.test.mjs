import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_CASES, loadCatalog, selectCases, createPlan, validatePlan, catalogFromMarkdown, metadataOnlyChange } from './release-plan.mjs';

const catalog = loadCatalog();
const input = { baseSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), runId: '123', version: '0.3.3', includeMac: false, changedFiles: [] };
test('documentation-only changes retain real installed core acceptance', () => {
  const selection = selectCases(['docs/qa/results/report.md', 'AGENTS.md'], catalog);
  assert.deepEqual(selection.requiredCases, [...CORE_CASES].sort());
  assert.equal(selection.fullSuite, false);
});
test('files and remote changes include both affected areas', () => {
  const result = selectCases(['vendor/deepseek-harness/packages/client/ui-files/src/client.ts', 'src/main/dshd-remote.js'], catalog);
  assert.ok(result.requiredCases.includes('TC-SURF-003'));
  assert.ok(result.requiredCases.includes('TC-RW-006'));
  assert.ok(!result.requiredCases.includes('TC-APP-007'));
});
test('upstream, dependency, runtime and unknown changes cannot under-select', () => {
  for (const file of ['vendor/harness-upstream.json', 'package-lock.json', 'src/main/new-startup.js', 'vendor/deepseek-harness/packages/core/agent-loop/index.ts']) {
    assert.deepEqual(selectCases([file], catalog).requiredCases, [...catalog].sort(), file);
  }
});
test('all fixed cases exist and corrupt catalog fails closed', () => {
  assert.ok(catalog.length >= 126);
  assert.throws(() => catalogFromMarkdown('### TC-INST-001\n### TC-INST-001'), /duplicate/);
});
test('plan binds baseline, platform, candidate and selected cases', () => {
  const plan = createPlan(input, catalog);
  assert.equal(validatePlan(plan, catalog), plan);
  assert.throws(() => validatePlan({ ...plan, requiredCases: [] }, catalog), /differs/);
  assert.throws(() => validatePlan({ ...plan, platforms: [] }, catalog), /differs/);
  assert.throws(() => createPlan({ ...input, candidateSha: '--anything' }, catalog), /SHAs/);
  assert.throws(() => selectCases(['../outside'], catalog), /Invalid/);
});
test('version bumps and release commands do not force a complete manual regression', () => {
  const before = { version: '0.3.2', dependencies: { electron: '43' }, scripts: { start: 'electron .', test: 'old' } };
  const after = { ...before, version: '0.3.3', scripts: { start: 'electron .', test: 'new', 'release:acceptance': 'node check.mjs' } };
  assert.equal(metadataOnlyChange('package.json', before, after), true);
  const selection = selectCases(['package.json'], catalog, ['package.json']);
  assert.equal(selection.fullSuite, false);
  assert.deepEqual(selection.requiredCases, [...CORE_CASES].sort());
  assert.equal(metadataOnlyChange('package.json', before, { ...after, dependencies: { electron: '44' } }), false);
  assert.equal(metadataOnlyChange('package.json', before, { ...after, scripts: { start: 'new startup' } }), false);
});
test('root lock version metadata is distinct from transitive dependency changes', () => {
  const before = { version: '0.3.2', packages: { '': { version: '0.3.2' }, 'node_modules/ws': { version: '8.0.0' } } };
  const after = structuredClone(before); after.version = '0.3.3'; after.packages[''].version = '0.3.3';
  assert.equal(metadataOnlyChange('package-lock.json', before, after), true);
  after.packages['node_modules/ws'].version = '8.1.0';
  assert.equal(metadataOnlyChange('package-lock.json', before, after), false);
  assert.throws(() => selectCases(['src/main/index.js'], catalog, ['src/main/index.js']), /classification/);
});
