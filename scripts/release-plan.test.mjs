import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_CASES, loadCatalog, selectCases, createPlan, validatePlan, catalogFromMarkdown, metadataOnlyChange } from './release-plan.mjs';

const catalog = loadCatalog();
const input = { baseSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), runId: '123', version: '0.3.3', includeMac: false, changedFiles: [] };

test('workflow and hook tooling does not falsely expand product runtime regression', () => {
  const selection = selectCases(['scripts/run-final-gates.mjs', 'scripts/git-hooks/pre-push', 'scripts/install-git-integrations.mjs', '.github/workflows/test.yml'], catalog);
  assert.equal(selection.fullSuite, false);
  assert.deepEqual(selection.areas, ['release-tooling']);
  assert.deepEqual(selection.requiredCases, [...CORE_CASES].sort());
});
test('documentation-only changes retain real installed core acceptance', () => {
  const selection = selectCases(['docs/qa/results/report.md', 'AGENTS.md'], catalog);
  assert.deepEqual(selection.requiredCases, [...CORE_CASES].sort());
  assert.equal(selection.fullSuite, false);
});

test('QA observers and desktop integration instructions do not expand product scenarios', () => {
  const files = ['scripts/run-packaged-p0.mjs', 'scripts/run-window-motion-qa.mjs', 'scripts/run-source-qa.mjs',
    'vendor/deepseek-harness/AGENTS.md', 'vendor/deepseek-harness/packages/client/AGENTS.md',
    'vendor/deepseek-harness/.agents/skills/dsh-pre-push-checks/SKILL.md'];
  assert.deepEqual(selectCases(files, catalog).requiredCases, [...CORE_CASES].sort());
  for (const file of ['scripts/run-electron.js', 'scripts/prestart-ensure.mjs', '.nvmrc']) {
    assert.deepEqual(selectCases([file], catalog).requiredCases, [...catalog].sort(), file);
  }
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

test('nested maintenance cleanup selects tooling without adding remote or product scenarios', () => {
  const files = ['vendor/chisacode-remote/.nvmrc', 'vendor/chisacode-remote/lefthook.yml',
    'vendor/chisacode-remote/docs/testing.md', 'vendor/chisacode-remote/packages/server/CLAUDE.md',
    'vendor/deepseek-harness/scripts/install-lefthook.mjs', 'vendor/deepseek-harness/scripts/run-gates.ts',
    'vendor/deepseek-harness/vitest.config.ts', 'vendor/deepseek-harness/scripts/verify-doc-budgets.ts',
    'vendor/deepseek-harness/docs/testing.zh.md',
    'vendor/deepseek-harness/.agents/notes/implemented/process/2026-06-11-quality-gates.md',
    'vendor/deepseek-harness/.agents/skills/dsh-doc/references/review.md'];
  const selection = selectCases(files, catalog);
  assert.equal(selection.fullSuite, false);
  assert.deepEqual(selection.areas, ['release-tooling']);
  assert.deepEqual(selection.requiredCases, [...CORE_CASES].sort());
});

test('instruction files inside recorded behavior fixtures remain product input', () => {
  for (const file of ['vendor/deepseek-harness/snapshots/scenario/workspace/AGENTS.md',
    'vendor/chisacode-remote/packages/server/tests/fixtures/CLAUDE.md']) {
    assert.notDeepEqual(selectCases([file], catalog).requiredCases, [...CORE_CASES].sort(), file);
  }
});

test('removing nested hook and word-budget scripts does not hide dependency or startup changes', () => {
  const manifests = [
    ['vendor/chisacode-remote/package.json', 'prepare', 'lefthook install --force'],
    ['vendor/deepseek-harness/package.json', 'verify-doc-budgets', 'tsx scripts/verify-doc-budgets.ts'],
  ];
  for (const [file, script, command] of manifests) {
    const before = { version: '1.0.0', dependencies: { ws: '8.0.0' }, scripts: { start: 'node server.js', [script]: command } };
    const after = structuredClone(before); delete after.scripts[script];
    assert.equal(metadataOnlyChange(file, before, after), true, file);
    assert.equal(selectCases([file], catalog, [file]).fullSuite, false);
    assert.equal(metadataOnlyChange(file, before, { ...after, version: '2.0.0' }), false, file);
    assert.equal(metadataOnlyChange(file, before, { ...after, dependencies: { ws: '9.0.0' } }), false, file);
    assert.equal(metadataOnlyChange(file, before, { ...after, scripts: { ...after.scripts, start: 'different startup' } }), false, file);
  }
  const file = 'vendor/chisacode-remote/package.json';
  assert.equal(metadataOnlyChange(file, { scripts: { prepare: 'node product-patches.js' } }, { scripts: {} }), false);
});
