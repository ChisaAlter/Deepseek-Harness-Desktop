'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AFFECTION_LEVELS,
  CARE,
  normalizeStats,
  decayStats,
  applyCare,
  affectionLevel,
  statsSnapshot,
} = require('./pet-stats');

const T0 = 1_700_000_000_000;
const HOUR = 3600000;

test('normalizeStats defaults and clamps', () => {
  assert.deepEqual(normalizeStats(undefined, T0), {
    satiety: 70, mood: 70, affection: 0, lastTick: T0, care: {},
  });
  const s = normalizeStats({ satiety: 250, mood: -10, affection: 12.9, lastTick: 5, care: { pat: 9, bogus: 1, feed: 'x' } }, T0);
  assert.equal(s.satiety, 100);
  assert.equal(s.mood, 0);
  assert.equal(s.affection, 12);
  assert.equal(s.lastTick, 5);
  assert.deepEqual(s.care, { pat: 9 });
});

test('decay: satiety falls per hour, mood settles toward baseline, affection holds', () => {
  const s = { satiety: 70, mood: 90, affection: 33, lastTick: T0, care: {} };
  const d = decayStats(s, T0 + 10 * HOUR);
  assert.equal(d.satiety, 40);          // -3/hr × 10h
  assert.equal(d.mood, 62);             // 90 → settles to baseline, capped by rate
  assert.equal(d.affection, 33);
  assert.equal(d.lastTick, T0 + 10 * HOUR);
});

test('decay: mood also recovers upward and never crosses the baseline', () => {
  const s = { satiety: 50, mood: 20, affection: 0, lastTick: T0, care: {} };
  const d = decayStats(s, T0 + 2 * HOUR);
  assert.equal(d.mood, 36);             // +8/hr toward 62
  const d2 = decayStats({ ...s, mood: 60 }, T0 + 100 * HOUR);
  assert.equal(d2.mood, 62);            // asymptote, not overshoot
});

test('decay: floors at 0 and ignores future timestamps', () => {
  const s = { satiety: 5, mood: 70, affection: 0, lastTick: T0, care: {} };
  assert.equal(decayStats(s, T0 + 10 * HOUR).satiety, 0);
  assert.equal(decayStats(s, T0 - 1000).satiety, 5);
});

test('decay caps offline accumulation at 72h', () => {
  const s = { satiety: 100, mood: 62, affection: 0, lastTick: T0, care: {} };
  const d = decayStats(s, T0 + 1000 * HOUR);
  assert.equal(d.satiety, 0);           // 100 - 3*72 = -116 → clamped
  assert.equal(d.lastTick, T0 + 1000 * HOUR);
});

test('applyCare applies deltas and records the care timestamp', () => {
  const s = { satiety: 40, mood: 60, affection: 0, lastTick: T0, care: {} };
  const { state } = applyCare(s, 'feedToken', T0);
  assert.equal(state.satiety, 85);      // 40 + 45
  assert.equal(state.mood, 72);         // 60 + 12
  assert.equal(state.affection, 5);
  assert.equal(state.care.feedToken, T0);
});

test('applyCare: tease on a grumpy whale backfires', () => {
  const s = { satiety: 50, mood: 20, affection: 10, lastTick: T0, care: {} };
  const { state } = applyCare(s, 'tease', T0);
  assert.equal(state.mood, 16);         // -4 instead of +6
  assert.equal(state.affection, 10);    // no bond growth
});

test('applyCare: same-kind affection is cooled down for 10 minutes', () => {
  const s = { satiety: 50, mood: 60, affection: 0, lastTick: T0, care: { pat: T0 } };
  const soon = applyCare(s, 'pat', T0 + 5 * 60000);
  assert.equal(soon.affectionScaled, true);
  assert.equal(soon.state.affection, 1); // floor(4 * 0.25)
  const later = applyCare(s, 'pat', T0 + 11 * 60000);
  assert.equal(later.affectionScaled, false);
  assert.equal(later.state.affection, 4);
});

test('applyCare: unknown kinds decay only', () => {
  const s = { satiety: 70, mood: 70, affection: 0, lastTick: T0, care: {} };
  const { state } = applyCare(s, 'explode', T0 + HOUR);
  assert.equal(state.satiety, 67);
  assert.equal(state.affection, 0);
});

test('affectionLevel thresholds and snapshot labels', () => {
  assert.equal(affectionLevel(0), 0);
  assert.equal(affectionLevel(39), 0);
  assert.equal(affectionLevel(40), 1);
  assert.equal(affectionLevel(99999), AFFECTION_LEVELS.length - 1);
  const snap = statsSnapshot({ satiety: 15, mood: 20, affection: 300, lastTick: T0, care: {} }, T0);
  assert.equal(snap.satietyLabel, '饿扁了');
  assert.equal(snap.moodLabel, '闹别扭中');
  assert.equal(snap.affectionLevel, 4);
  assert.equal(snap.affectionName, '信赖');
  assert.equal(snap.hearts, 4);
  assert.equal(snap.affectionNext, 520);
  const maxed = statsSnapshot({ affection: 9999, lastTick: T0, care: {} }, T0);
  assert.equal(maxed.affectionNext, null);
});

test('every CARE kind has finite deltas and care decay stays in range', () => {
  for (const kind of Object.keys(CARE)) {
    const { state } = applyCare({ satiety: 95, mood: 95, affection: 0, lastTick: T0, care: {} }, kind, T0);
    assert.ok(state.satiety <= 100 && state.mood <= 100 && state.satiety >= 0 && state.mood >= 0, kind);
  }
});
