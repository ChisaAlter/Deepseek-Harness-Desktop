import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const read = name => readFileSync(resolve(import.meta.dirname, '../.github/workflows', name), 'utf8');
test('workflows parse and fast checks precede expensive tests and packaging', () => {
  const tests = yaml.load(read('test.yml'));
  const release = yaml.load(read('release.yml'));
  assert.equal(tests.jobs.desktop.needs, 'fast-checks');
  assert.equal(tests.jobs['vendor-gui'].needs, 'fast-checks');
  const maintenance = tests.jobs['fast-checks'].steps.find(s => s.name === 'Maintenance validator behavior');
  assert.match(maintenance.run, /archive-decision\.test\.mjs/);
  assert.match(maintenance.run, /verify-feature-cards\.test\.mjs/);
  assert.doesNotMatch(maintenance.run, /verify-\*|verify-remote|verify-real/);
  const steps = tests.jobs['vendor-gui'].steps;
  assert.ok(steps.findIndex(s => s.name === 'Client catalog up to date') < steps.findIndex(s => s.name === 'Build vendor client + host libs'));
  assert.equal(release.jobs.windows.needs, 'preflight');
  assert.equal(release.jobs.macos.needs, 'preflight');
  assert.equal(release.concurrency['cancel-in-progress'], false);
  assert.equal(release.concurrency.queue, 'max');
  assert.equal(tests.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.match(tests.concurrency.group, /github\.sha/);
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

test('documentation scope includes translation records but never hides runtime or workflow changes', () => {
  const workflow = yaml.load(read('test.yml'));
  const script = workflow.jobs['fast-checks'].steps.find(s => s.id === 'scope').run;
  const source = script.match(/grep -qEv '([^']+)'/)[1];
  const docsOnly = new RegExp(source);
  for (const file of ['docs/qa/releases/v0.3.3/123.json', 'CONTRIBUTING.en.md', 'CONTRIBUTING.i18n.yaml', 'README.i18n.yaml', 'AGENTS.md']) {
    assert.equal(docsOnly.test(file), true, file);
  }
  for (const file of ['src/main/index.js', '.github/workflows/publish.yml', 'package.json', 'README.js', 'vendor/deepseek-harness/package.json']) {
    assert.equal(docsOnly.test(file), false, file);
  }
});
