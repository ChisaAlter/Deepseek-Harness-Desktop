#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { CORE_CASES, loadCatalog, validatePlan } from './release-plan.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function readJson(file) {
  requireValue(lstatSync(file).isFile() && lstatSync(file).size <= 1024 * 1024, 'Report/plan must be an ordinary JSON file <= 1 MiB');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function planDigest(plan) { return sha256(JSON.stringify(plan)); }

export async function fileDigest(file) {
  requireValue(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Artifact must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function artifactDigests(plan, windowsDir, macDir) {
  const windowsFile = `Whale-Isle-Setup-${plan.version}.exe`;
  const artifacts = [{ name: windowsFile, sha256: await fileDigest(resolve(windowsDir, windowsFile)) }];
  if (plan.platforms.includes('macos-arm64')) {
    requireValue(macDir, 'macOS candidate requires the original DMG directory');
    const dmgs = readdirSync(macDir).filter(n => /^Whale-Isle-.*\.dmg$/.test(n));
    requireValue(dmgs.length === 1, 'Expected exactly one macOS DMG');
    artifacts.push({ name: dmgs[0], sha256: await fileDigest(resolve(macDir, dmgs[0])) });
  }
  return artifacts;
}

export function createReport(plan, artifacts) {
  return {
    schemaVersion: 1, planSha256: planDigest(plan), candidateSha: plan.candidateSha,
    candidateRunId: plan.runId, version: plan.version, artifacts,
    state: 'testing', scopeReview: '',
    environment: { os: '', installationPath: '', profile: '', shellSession: '', upgradeFrom: '', identityEvidence: '', sourceInstancesStopped: false },
    cases: [...plan.requiredCases, ...(plan.platforms.includes('macos-arm64') ? ['MAC-INSTALL'] : [])]
      .map(id => ({ id, status: 'not-run', evidence: '', reason: '', issueId: '' })),
    issues: [], signoff: { approvedBy: '', approvedAt: '' },
  };
}

function approvedWaiver(issue, now) {
  const waiver = issue.waiver;
  return nonempty(issue.owner) && nonempty(issue.followUp) && nonempty(waiver?.approvedBy)
    && nonempty(waiver?.reason) && /^\d{4}-\d{2}-\d{2}$/.test(waiver?.expiresOn)
    && Date.parse(`${waiver.expiresOn}T23:59:59Z`) >= now;
}

export function validateReport(report, plan, artifacts, catalog, now = Date.now()) {
  validatePlan(plan, catalog);
  requireValue(report.schemaVersion === 1 && report.state === 'approved', 'Report must be explicitly approved');
  requireValue(report.planSha256 === planDigest(plan), 'Acceptance belongs to another plan');
  requireValue(report.candidateSha === plan.candidateSha && report.candidateRunId === plan.runId && report.version === plan.version, 'Candidate identity mismatch');
  requireValue(isDeepStrictEqual(report.artifacts, artifacts), 'Acceptance artifact digests differ from original candidate bytes');
  requireValue(nonempty(report.scopeReview), 'Missing human review of changed files and additional coverage');
  for (const key of ['os', 'installationPath', 'profile', 'shellSession', 'upgradeFrom', 'identityEvidence']) {
    requireValue(nonempty(report.environment?.[key]), `Missing environment.${key}`);
  }
  requireValue(report.environment.sourceInstancesStopped === true, 'Source instances must be stopped during installed acceptance');
  requireValue(nonempty(report.signoff?.approvedBy), 'Missing release owner signoff');
  const approvedAt = Date.parse(report.signoff?.approvedAt);
  requireValue(Number.isFinite(approvedAt) && approvedAt <= now && /^\d{4}-\d{2}-\d{2}T/.test(report.signoff.approvedAt) && /(?:Z|[+-]\d{2}:\d{2})$/.test(report.signoff.approvedAt), 'Invalid approval timestamp');
  requireValue(Array.isArray(report.issues) && Array.isArray(report.cases), 'Expected cases and issues arrays');
  const issues = new Map();
  for (const issue of report.issues) {
    requireValue(nonempty(issue.id) && !issues.has(issue.id), 'Duplicate or missing issue ID');
    requireValue(['product', 'tool', 'environment', 'unknown'].includes(issue.kind), `Invalid issue kind: ${issue.id}`);
    requireValue(['blocker', 'critical', 'major', 'minor'].includes(issue.severity), `Invalid severity: ${issue.id}`);
    requireValue(['open', 'resolved'].includes(issue.status) && nonempty(issue.summary) && nonempty(issue.evidence), `Incomplete issue: ${issue.id}`);
    if (issue.status === 'open') {
      requireValue(issue.kind !== 'unknown', `Unclassified failure: ${issue.id}`);
      requireValue(!(issue.kind === 'product' && ['blocker', 'critical'].includes(issue.severity)), `Unresolved release-blocking product defect: ${issue.id}`);
      requireValue(nonempty(issue.owner) && nonempty(issue.followUp), `Open issue needs owner and follow-up: ${issue.id}`);
      if (issue.kind !== 'product' || issue.severity === 'major') requireValue(approvedWaiver(issue, now), `Missing or expired risk acceptance: ${issue.id}`);
    }
    issues.set(issue.id, issue);
  }
  const cases = new Map();
  for (const item of report.cases) {
    const extra = typeof item.id === 'string' && /^EXTRA-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(item.id);
    requireValue((catalog.includes(item.id) || extra || (item.id === 'MAC-INSTALL' && plan.platforms.includes('macos-arm64'))) && !cases.has(item.id), `Unknown or duplicate case: ${item.id}`);
    if (extra) requireValue(nonempty(item.procedure), `Additional case needs a reproducible procedure: ${item.id}`);
    requireValue(['pass', 'fail', 'blocked', 'na'].includes(item.status), `Unfinished case: ${item.id}`);
    requireValue(nonempty(item.evidence), `Missing evidence: ${item.id}`);
    requireValue(!item.issueId || issues.has(item.issueId), `Unknown issue reference: ${item.id}`);
    const issue = issues.get(item.issueId);
    if (CORE_CASES.includes(item.id) || item.id === 'MAC-INSTALL') requireValue(item.status === 'pass', `Core case must pass: ${item.id}`);
    if (item.status === 'pass') requireValue(!issue || issue.status === 'resolved', `Pass refers to open issue: ${item.id}`);
    if (item.status === 'na') {
      requireValue(nonempty(item.reason) && !item.issueId, `N/A requires a non-applicability reason, not a defect waiver: ${item.id}`);
    }
    if (['fail', 'blocked'].includes(item.status)) {
      requireValue(nonempty(item.reason) && issue?.status === 'open', `Unresolved case needs an open issue: ${item.id}`);
      requireValue(item.status !== 'fail' || issue.kind === 'product', `Tool/environment failure must be blocked, not product fail: ${item.id}`);
      requireValue(issue.kind === 'product' && issue.severity === 'minor' || approvedWaiver(issue, now), `Case has no valid limitation approval: ${item.id}`);
    }
    cases.set(item.id, item);
  }
  for (const id of plan.requiredCases) requireValue(cases.has(id), `Missing required case: ${id}`);
  if (plan.platforms.includes('macos-arm64')) requireValue(cases.has('MAC-INSTALL'), 'Missing macOS installed acceptance');
  return { cases: cases.size, limitations: report.issues.filter(i => i.status === 'open').length };
}

export function limitationNotes(report) {
  const lines = ['\n\n## Candidate acceptance', '', `- Acceptance owner: ${report.signoff.approvedBy}`, `- Approved: ${report.signoff.approvedAt}`];
  const open = report.issues.filter(i => i.status === 'open');
  if (open.length) lines.push('', '### Known limitations', '', ...open.map(i => `- ${i.id} (${i.kind}/${i.severity}): ${i.summary}. Follow-up: ${i.followUp}${i.waiver ? `; accepted until ${i.waiver.expiresOn}` : ''}`));
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, planFile, reportFile, windowsDir, macDir] = process.argv.slice(2);
    requireValue(['init', 'verify'].includes(mode) && windowsDir, 'Usage: check-release-acceptance.mjs <init|verify> <plan.json> <report.json> <windows-assets> [macos-assets]');
    const plan = validatePlan(readJson(planFile), loadCatalog());
    if (mode === 'verify') {
      requireValue(process.env.CANDIDATE_SHA === plan.candidateSha && process.env.CANDIDATE_RUN_ID === plan.runId, 'Set expected CANDIDATE_SHA and CANDIDATE_RUN_ID from the inspected CI run');
      requireValue(process.env.RELEASE_TAG === `v${plan.version}`, 'Release tag does not match acceptance plan');
    }
    const artifacts = await artifactDigests(plan, windowsDir, macDir);
    if (mode === 'init') {
      writeFileSync(reportFile, JSON.stringify(createReport(plan, artifacts), null, 2) + '\n', { flag: 'wx' });
      console.log(`Created unapproved checklist ${basename(reportFile)}; no case has been marked passed.`);
    } else {
      const report = readJson(reportFile);
      const result = validateReport(report, plan, artifacts, loadCatalog());
      writeFileSync('acceptance-notes.md', limitationNotes(report));
      console.log(`Acceptance verified: ${result.cases} cases, ${result.limitations} disclosed limitations; candidate=${plan.candidateSha}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
