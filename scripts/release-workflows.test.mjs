import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeFixture } from './lib/fixture.mjs';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const read = name => readFileSync(resolve(import.meta.dirname, '../.github/workflows', name), 'utf8');

test('actual workflow shell guards reject the fourth non-pass and missing local facts', t => {
  const shell = process.platform === 'win32'
    ? resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../../usr/bin/sh.exe') : 'bash';
  const root = makeFixture(t, {});
  for (const name of ['test.yml', 'release.yml', 'publish.yml']) {
    const workflow = yaml.load(read(name));
    const guard = Object.values(workflow.jobs)[0].steps[0].run;
    const baseEnv = { ...process.env, GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'fixture/local-only', CANDIDATE_SHA: 'a'.repeat(40),
      LOCAL_QA: 'fixture local QA', CI_COUNT_EVIDENCE: 'fixture run history',
      CI_RECOVERY_DECISION: '',
      GITHUB_STEP_SUMMARY: resolve(root, 'summary.txt') };
    const invoke = extra => spawnSync(shell, ['-c', `gh() { printf '%s\\n' identical; }\n${guard}`], {
      encoding: 'utf8', env: { ...baseEnv, ...extra }, windowsHide: true,
    });
    for (const count of ['0', '3']) {
      const result = invoke({ CI_NONPASS_COUNT: count });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    }
    for (const extra of [ { CI_NONPASS_COUNT: '4' }, { CI_NONPASS_COUNT: '' }, { CI_NONPASS_COUNT: '04' },
      { CI_NONPASS_COUNT: '4', CI_RECOVERY_DECISION: '4: ' },
      { CI_NONPASS_COUNT: '5', CI_RECOVERY_DECISION: '4: earlier fixture decision' },
      { CI_NONPASS_COUNT: '0', CI_COUNT_EVIDENCE: ' ' },
      ...(name === 'test.yml' ? [{ CI_NONPASS_COUNT: '0', LOCAL_QA: '' }, { CI_NONPASS_COUNT: '0', GITHUB_REF: 'refs/heads/other' }] : []),
    ]) assert.notEqual(invoke(extra).status, 0, `${name} must reject ${JSON.stringify(extra)}`);
    const resumed = invoke({ CI_NONPASS_COUNT: '4', CI_RECOVERY_DECISION: '4: fixture user decision reference and corrected local QA evidence' });
    assert.equal(resumed.status, 0, `${name}: ${resumed.stderr}`);
  }
});
test('workflows parse and fast checks precede expensive tests and packaging', () => {
  const tests = yaml.load(read('test.yml'));
  const release = yaml.load(read('release.yml'));
  assert.equal(tests.jobs.desktop.needs, 'fast-checks');
  assert.equal(tests.jobs['vendor-gui'].needs, 'fast-checks');
  // These regressions already belong to npm test; no duplicate Fast checks copy.
  assert.equal(tests.jobs['fast-checks'].steps.some(s => s.name === 'Maintenance validator behavior'), false);
  assert.ok(tests.jobs.desktop.steps.some(s => s.run === 'npm test'));
  const steps = tests.jobs['vendor-gui'].steps;
  assert.ok(steps.findIndex(s => s.name === 'Client catalog up to date') < steps.findIndex(s => s.name === 'Build vendor client + host libs'));
  assert.equal(release.jobs.windows.needs, 'preflight');
  assert.equal(release.jobs.macos.needs, 'preflight');
  assert.equal(release.concurrency['cancel-in-progress'], false);
  assert.equal(release.concurrency.queue, 'max');
  assert.equal(tests.concurrency['cancel-in-progress'], false);
  assert.match(tests.concurrency.group, /inputs\.candidate_sha/);
  for (const job of Object.values(release.jobs)) {
    const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with.ref, '${{ inputs.candidate_sha }}');
  }
});
test('promotion requires immutable acceptance and verifies it after downloading all assets', () => {
  const workflow = yaml.load(read('publish.yml'));
  assert.equal(workflow.concurrency.group, 'publish-release');
  assert.equal(workflow.concurrency.queue, 'max');
  assert.equal(workflow.on.workflow_dispatch.inputs.acceptance_commit.required, true);
  const steps = workflow.jobs.promote.steps;
  // Before checkout the runner has no Git remote from which gh can infer a repo.
  const checkoutAt = steps.findIndex(s => s.uses?.startsWith('actions/checkout@'));
  const earlyDownloads = steps.slice(0, checkoutAt).flatMap(s => (s.run ?? '').split('\n').filter(line => /gh run download/.test(line)));
  assert.ok(earlyDownloads.length > 0);
  for (const command of earlyDownloads) assert.match(command, /--repo "\$GITHUB_REPOSITORY"/);
  const download = steps.findIndex(s => s.name === 'Download optional macOS artifact from the same candidate run');
  const acceptance = steps.findIndex(s => s.name === 'Validate installed acceptance against the original assets');
  const publish = steps.findIndex(s => s.name === 'Publish the verified candidate without rebuilding');
  assert.ok(download < acceptance && acceptance < publish);
  assert.match(steps[acceptance].run, /check-release-acceptance\.mjs verify/);
  const reportStep = steps.find(s => s.name === 'Download the frozen plan and immutable acceptance record');
  assert.match(reportStep.run, /compare\/\$ACCEPTANCE_COMMIT\.\.\.main/);
  assert.match(reportStep.run, /\?ref=\$ACCEPTANCE_COMMIT/);
  assert.match(steps[publish].run, /evidence-out\/release-acceptance\.json/);
  assert.match(steps[publish].run, /check-release-version\.mjs "\$RELEASE_TAG" "\$current_tag"/);
  assert.match(read('publish.yml'), /cat acceptance-notes\.md >> release-body\.md/);
  assert.match(read('publish.yml'), /candidate_sha=\$\(jq -r '\.candidateSha'/);
});

test('all CI is explicit final validation and every test job freezes the candidate', () => {
  for (const name of ['test.yml', 'release.yml', 'publish.yml']) {
    const workflow = yaml.load(read(name));
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    for (const input of ['ci_nonpass_count', 'ci_count_evidence']) {
      assert.equal(workflow.on.workflow_dispatch.inputs[input].required, true);
    }
    assert.equal(workflow.on.workflow_dispatch.inputs.ci_recovery_decision.required, false);
  }
  const workflow = yaml.load(read('test.yml'));
  assert.equal(workflow.on.workflow_dispatch.inputs.local_qa.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.candidate_sha.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.include_macos.default, false);
  assert.equal(workflow['run-name'], 'Final validation ${{ inputs.candidate_sha }}');
  for (const job of Object.values(workflow.jobs)) {
    const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with.ref, '${{ inputs.candidate_sha }}');
  }
  assert.equal(workflow.jobs['fast-checks'].steps.some(s => (s.run ?? '').includes('doc-sync')), false);
});
