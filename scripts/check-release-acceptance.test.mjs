import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, loadCatalog } from './release-plan.mjs';
import { createReport, validateReport, limitationNotes } from './check-release-acceptance.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const catalog = loadCatalog();
const now = Date.parse('2026-10-02T08:00:00Z');
function fixture(mac = false) {
  const plan = createPlan({ baseSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), runId: '123', version: '0.3.3', includeMac: mac, changedFiles: ['src/main/update.js'] }, catalog);
  const artifacts = [{ name: 'Whale-Isle-Setup-0.3.3.exe', sha256: 'c'.repeat(64) }];
  if (mac) artifacts.push({ name: 'Whale-Isle-0.3.3-arm64.dmg', sha256: 'd'.repeat(64) });
  const report = createReport(plan, artifacts);
  report.state = 'approved'; report.scopeReview = 'Reviewed full base-to-candidate diff and selected update scenarios.';
  for (const key of Object.keys(report.environment)) report.environment[key] = key === 'sourceInstancesStopped' ? true : 'Installed fixture evidence';
  for (const item of report.cases) { item.status = 'pass'; item.evidence = 'https://example.invalid/sanitized-evidence'; }
  report.signoff = { approvedBy: 'release-owner', approvedAt: '2026-10-02T07:00:00Z' };
  return { report, plan, artifacts };
}
function verify(f) { return validateReport(f.report, f.plan, f.artifacts, catalog, now); }
function limitation(f, kind = 'product', severity = 'major') {
  const item = f.report.cases.find(c => c.id === 'TC-LAUNCH-003');
  const issue = { id: 'ISSUE-1', kind, severity, status: 'open', summary: 'Observed limitation', evidence: 'result.json', owner: 'owner', followUp: 'https://example.invalid/issue', waiver: { approvedBy: 'owner', reason: 'Bounded impact and workaround reviewed', expiresOn: '2026-10-09' } };
  item.status = kind === 'product' ? 'fail' : 'blocked'; item.issueId = issue.id; item.reason = 'Reproduced limitation';
  f.report.issues.push(issue);
  return { item, issue };
}
test('initial report cannot certify an untested candidate', () => {
  const f = fixture(); f.report = createReport(f.plan, f.artifacts);
  assert.ok(f.report.cases.every(c => c.status === 'not-run'));
  assert.throws(() => verify(f), /explicitly approved/);
});
test('complete installed acceptance succeeds and remains bound to exact bytes', () => {
  assert.ok(verify(fixture()).cases > 26);
  for (const change of [f => f.report.candidateSha = 'e'.repeat(40), f => f.report.candidateRunId = '124', f => f.report.planSha256 = 'e'.repeat(64), f => f.report.artifacts = [], f => f.report.version = '0.3.4']) {
    const f = fixture(); change(f); assert.throws(() => verify(f), /identity|plan|digests/);
  }
});
test('core cannot be waived, omitted or changed to N/A', () => {
  for (const state of ['fail', 'blocked', 'na', 'not-run']) {
    const f = fixture(); f.report.cases[0].status = state;
    assert.throws(() => verify(f), /Core|Unfinished/);
  }
  const f = fixture(); f.report.cases.shift(); assert.throws(() => verify(f), /Missing required/);
});
test('non-applicable impacted case requires observed evidence and explanation', () => {
  const f = fixture(); const item = f.report.cases.find(c => c.id === 'TC-LAUNCH-003'); item.status = 'na';
  assert.throws(() => verify(f), /N\/A/);
  item.reason = 'Controlled source has no newer version; declined-update path independently covered by recorded update fixture';
  assert.ok(verify(f));
});
test('major limitation and environment block require non-expired explicit risk acceptance', () => {
  for (const kind of ['product', 'tool', 'environment']) {
    const f = fixture(); const { issue } = limitation(f, kind);
    assert.equal(verify(f).limitations, 1);
    assert.match(limitationNotes(f.report), /Observed limitation/);
    issue.waiver.expiresOn = '2026-10-01'; assert.throws(() => verify(f), /expired/);
    delete issue.waiver; assert.throws(() => verify(f), /risk acceptance/);
  }
});
test('blocker, critical and unclassified failures block even with a waiver', () => {
  for (const severity of ['blocker', 'critical']) {
    const f = fixture(); limitation(f, 'product', severity); assert.throws(() => verify(f), /release-blocking/);
  }
  const f = fixture(); limitation(f, 'unknown'); assert.throws(() => verify(f), /Unclassified/);
});
test('pass cannot conceal an open issue and tools cannot be labeled product failure', () => {
  const f = fixture(); const { item } = limitation(f, 'tool'); item.status = 'pass'; assert.throws(() => verify(f), /open issue/);
  item.status = 'fail'; assert.throws(() => verify(f), /Tool\/environment/);
});
test('missing evidence, duplicate cases and incomplete signoff block', () => {
  for (const change of [f => f.report.cases[0].evidence = '', f => f.report.cases.push(f.report.cases[0]), f => f.report.environment.shellSession = '', f => f.report.signoff.approvedBy = '', f => f.report.scopeReview = '', f => f.report.signoff.approvedAt = '2099-01-01T00:00:00Z']) {
    const f = fixture(); change(f); assert.throws(() => verify(f));
  }
});
test('shipping macOS requires actual DMG identity and installed acceptance', () => {
  const f = fixture(true); assert.ok(verify(f));
  f.report.cases = f.report.cases.filter(c => c.id !== 'MAC-INSTALL'); assert.throws(() => verify(f), /macOS/);
});
test('newly observed risks can add explicit procedures without rebuilding the candidate', () => {
  const f = fixture();
  f.report.cases.push({ id: 'EXTRA-TASKBAR-UPGRADE', status: 'pass', evidence: 'sanitized screenshot', procedure: '' });
  assert.throws(() => verify(f), /procedure/);
  f.report.cases.at(-1).procedure = 'Begin a new Shell session with the legacy shortcut, install this candidate and observe the first visible taskbar button.';
  assert.ok(verify(f));
});
test('CLI initializes from real bytes and rejects mutation after signoff', t => {
  const dir = mkdtempSync(join(tmpdir(), 'release-acceptance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { plan } = fixture();
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'Whale-Isle-Setup-0.3.3.exe'), 'test fixture bytes');
  const cli = resolve(import.meta.dirname, 'check-release-acceptance.mjs');
  const invoke = mode => spawnSync(process.execPath, [cli, mode, 'plan.json', 'report.json', dir], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, CANDIDATE_SHA: plan.candidateSha, CANDIDATE_RUN_ID: plan.runId, RELEASE_TAG: 'v0.3.3' },
  });
  const init = invoke('init'); assert.equal(init.status, 0, init.stderr);
  const initialized = JSON.parse(readFileSync(join(dir, 'report.json')));
  const { report } = fixture(); report.artifacts = initialized.artifacts;
  report.signoff.approvedAt = new Date(Date.now() - 1000).toISOString();
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  const verified = invoke('verify'); assert.equal(verified.status, 0, verified.stderr);
  writeFileSync(join(dir, 'Whale-Isle-Setup-0.3.3.exe'), 'changed fixture bytes');
  const rejected = invoke('verify'); assert.equal(rejected.status, 1); assert.match(rejected.stderr, /digests differ/);
});
