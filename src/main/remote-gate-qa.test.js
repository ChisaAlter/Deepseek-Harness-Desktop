'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REMOTE_GATE_CASES,
  assertRemoteGateQaResult,
  pairingOffer,
} = require('./remote-gate-qa');

test('remote gate cases cover NEG-001 and REM-001 without pairing fetch', () => {
  const ids = REMOTE_GATE_CASES.map((c) => c.id);
  assert.ok(ids.includes('neg.available'));
  assert.ok(ids.includes('neg.notListening'));
  assert.ok(ids.includes('neg.footerPresent'));
  assert.ok(ids.includes('rem.enabledListening'));
  assert.ok(ids.includes('rem.pairingOffer'));
  assert.ok(ids.includes('rem.qrVisible'));
  assert.ok(ids.includes('rem.disabledStopped'));
  assert.ok(ids.includes('cold.openShowsQr'));
  assert.ok(ids.includes('cold.noBareOfferText'));
  assert.ok(ids.includes('cold.copyAndRotateControls'));
  assert.equal(new Set(ids).size, ids.length);
  const src = fs.readFileSync(path.join(__dirname, 'remote-gate-qa.js'), 'utf8');
  assert.doesNotMatch(src, /loadURL\(|BrowserWindow/);
  assert.match(src, /not fetched/);
});

test('pairingOffer only accepts hash offers', () => {
  assert.equal(pairingOffer({ urls: [{ pairingUrl: 'http://10.0.0.4:3180/#offer=abc' }] }), 'http://10.0.0.4:3180/#offer=abc');
  assert.equal(pairingOffer({ urls: [{ pairingUrl: 'http://10.0.0.4:3180/?token=abc' }] }), '');
  assert.equal(pairingOffer({ urls: [] }), '');
});

test('assertRemoteGateQaResult rejects missing cases', () => {
  assert.throws(
    () => assertRemoteGateQaResult({ ok: true, steps: [{ name: 'neg.available', ok: true }] }),
    /omitted required cases/,
  );
  assert.doesNotThrow(() => assertRemoteGateQaResult({
    ok: true,
    steps: REMOTE_GATE_CASES.map((c) => ({ name: c.id, ok: true })),
  }));
});

test('remote gate QA is wired into the main smoke path', () => {
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /DSH_QA_REMOTE/);
  assert.match(smoke, /runRemoteGateQa/);
});
