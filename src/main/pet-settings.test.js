'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const petSettings = require('./pet-settings');

test('normalizeSettings returns the full default shape on garbage input', () => {
  const d = petSettings.defaultSettings();
  assert.deepEqual(petSettings.normalizeSettings(undefined), d);
  assert.deepEqual(petSettings.normalizeSettings(null), d);
  assert.deepEqual(petSettings.normalizeSettings('bad'), d);
  assert.deepEqual(petSettings.normalizeSettings([]), d);
  assert.deepEqual(petSettings.normalizeSettings({ unknown: 1, scale: 'x' }), d);
});

test('scale and opacity clamp to their declared ranges and snap to steps', () => {
  const s = petSettings.normalizeSettings({ scale: 99, opacity: -3 });
  assert.equal(s.scale, petSettings.SCALE_MAX);
  assert.equal(s.opacity, petSettings.OPACITY_MIN);
  const lo = petSettings.normalizeSettings({ scale: 0.01, opacity: 55 });
  assert.equal(lo.scale, petSettings.SCALE_MIN);
  assert.equal(lo.opacity, petSettings.OPACITY_MAX);
  // Step snapping: 0.63 -> 0.6, 1.57 -> 1.6 (0.1 grid); 0.57 -> 0.55 (0.05 grid)
  const snapped = petSettings.normalizeSettings({ scale: 0.63, opacity: 0.57 });
  assert.equal(snapped.scale, 0.6);
  assert.equal(snapped.opacity, 0.55);
});

test('personality and activity reject values outside the enum', () => {
  for (const p of ['natural', 'genki', 'tsundere', 'poison']) {
    assert.equal(petSettings.normalizeSettings({ personality: p }).personality, p);
  }
  assert.equal(petSettings.normalizeSettings({ personality: 'mean' }).personality, 'natural');
  for (const a of ['quiet', 'balanced', 'active']) {
    assert.equal(petSettings.normalizeSettings({ activity: a }).activity, a);
  }
  assert.equal(petSettings.normalizeSettings({ activity: 'hyper' }).activity, 'balanced');
});

test('boolean fields keep booleans and fall back on anything else', () => {
  const on = petSettings.normalizeSettings({
    selfTalk: false, wander: false, lockPosition: true, shiftToDrag: true,
    powerSave: true, clickSound: true, chatEnabled: false, approvalButtons: true,
  });
  assert.equal(on.selfTalk, false);
  assert.equal(on.wander, false);
  assert.equal(on.lockPosition, true);
  assert.equal(on.shiftToDrag, true);
  assert.equal(on.powerSave, true);
  assert.equal(on.clickSound, true);
  assert.equal(on.chatEnabled, false);
  assert.equal(on.approvalButtons, true);
  const junk = petSettings.normalizeSettings({ selfTalk: 'yes', approvalButtons: 1 });
  assert.equal(junk.selfTalk, true);
  assert.equal(junk.approvalButtons, false);
});

test('lookModel trims, caps, and falls back like every other field', () => {
  assert.equal(petSettings.normalizeSettings({ lookModel: '  qwen-vl-max  ' }).lookModel, 'qwen-vl-max');
  assert.equal(petSettings.normalizeSettings({ lookModel: 7 }).lookModel, '');
  assert.equal(petSettings.normalizeSettings({ lookModel: 'x'.repeat(400) }).lookModel.length,
    petSettings.LOOK_MODEL_MAX);
  const cur = petSettings.normalizeSettings({ lookModel: 'vis-a' });
  // Patch sets, clears (empty = feature off), and preserves on junk.
  assert.equal(petSettings.normalizePatch(cur, { lookModel: '  vis-b ' }).lookModel, 'vis-b');
  assert.equal(petSettings.normalizePatch(cur, { lookModel: ' ' }).lookModel, '');
  assert.equal(petSettings.normalizePatch(cur, { lookModel: 1 }).lookModel, 'vis-a');
  assert.equal(petSettings.normalizePatch(cur, {}).lookModel, 'vis-a');
});

test('lookProvider rides the same trim/cap/patch rules as lookModel', () => {
  assert.equal(petSettings.normalizeSettings({ lookProvider: '  custom  ' }).lookProvider, 'custom');
  assert.equal(petSettings.normalizeSettings({ lookProvider: 7 }).lookProvider, '');
  const cur = petSettings.normalizeSettings({ lookProvider: 'prov-a' });
  assert.equal(petSettings.normalizePatch(cur, { lookProvider: ' prov-b ' }).lookProvider, 'prov-b');
  assert.equal(petSettings.normalizePatch(cur, { lookProvider: '' }).lookProvider, '');
  assert.equal(petSettings.normalizePatch(cur, { lookProvider: 1 }).lookProvider, 'prov-a');
  assert.equal(petSettings.normalizePatch(cur, {}).lookProvider, 'prov-a');
});

test('activityRow covers exactly three tiers with ordered intervals', () => {
  for (const key of petSettings.ACTIVITIES) {
    const row = petSettings.activityRow(key);
    assert.ok(row.talk[0] > 0 && row.talk[0] <= row.talk[1], `${key} talk range`);
    assert.ok(row.wander[0] > 0 && row.wander[0] <= row.wander[1], `${key} wander range`);
  }
  // Quieter tiers wait strictly longer than livelier ones.
  const q = petSettings.activityRow('quiet');
  const b = petSettings.activityRow('balanced');
  const a = petSettings.activityRow('active');
  assert.ok(q.talk[0] > b.talk[0] && b.talk[0] > a.talk[0]);
  assert.ok(q.wander[0] > b.wander[0] && b.wander[0] > a.wander[0]);
  // Unknown values ride the balanced row.
  assert.deepEqual(petSettings.activityRow('nope'), b);
});

test('normalizeDshState folds watermarks safely', () => {
  const d = petSettings.defaultDshState();
  assert.deepEqual(petSettings.normalizeDshState('x'), d);
  const n = petSettings.normalizeDshState({
    day: '2026-09-15', activeMsToday: 3000.9, milestoneMarks: [1e9, -2, 'x', 1e9],
    lastRestReminder: 100, lastGreetDay: '2026-09-15',
  });
  assert.equal(n.day, '2026-09-15');
  assert.equal(n.activeMsToday, 3000);
  assert.deepEqual(n.milestoneMarks, [1e9]); // deduped, junk dropped
  assert.equal(n.lastRestReminder, 100);
});

test('normalizeDshState keeps tail cursors as bounded num maps', () => {
  const n = petSettings.normalizeDshState({
    files: { 'a/session.jsonl.zstd': 1024.9, '': 5, 'b/x': -1, 'c/y': 'z' },
    openTurns: { 'ws/sess': 3, 'bad': -4 },
    dayTokens: { day: '2026-09-15', used: 1234.5 },
    activeSince: 99, lastActiveAt: 88, lastSeenAt: 77,
  });
  assert.deepEqual(n.files, { 'a/session.jsonl.zstd': 1024 });
  assert.deepEqual(n.openTurns, { 'ws/sess': 3 });
  assert.deepEqual(n.dayTokens, { day: '2026-09-15', used: 1234 });
  assert.equal(n.activeSince, 99);
  assert.equal(n.lastActiveAt, 88);
  assert.equal(n.lastSeenAt, 77);
  // Garbage → clean defaults, never a crash.
  const d = petSettings.normalizeDshState(null);
  assert.deepEqual(d.files, {});
  assert.deepEqual(d.openTurns, {});
  assert.deepEqual(d.dayTokens, { day: '', used: 0 });
});

test('normalizeFileEaten caps history at 50 and counts only valid entries', () => {
  assert.deepEqual(petSettings.normalizeFileEaten(undefined), { total: 0, history: [] });
  const history = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.txt`, at: i, day: 'd' }));
  const n = petSettings.normalizeFileEaten({ total: 99, history });
  assert.equal(n.total, 99);
  assert.equal(n.history.length, 50);
  assert.equal(n.history[0].name, 'f10.txt'); // oldest dropped
  // Garbage entries are filtered, long names truncated.
  const mixed = petSettings.normalizeFileEaten({
    history: [{ name: `${'a'.repeat(300)}.bin`, at: 1, day: 'd' }, 'junk', { name: 7 }],
  });
  assert.equal(mixed.history.length, 1);
  assert.equal(mixed.history[0].name.length, 200);
  // Missing total falls back to history length.
  assert.equal(petSettings.normalizeFileEaten({ history: [{ name: 'a', at: 1 }] }).total, 1);
});
