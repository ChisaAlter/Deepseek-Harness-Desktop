'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const PetWander = require('./pet-wander');

const BOUNDS = { x: 0, y: 0, width: 1000, height: 700 };
const PET = { w: 240, h: 260 };

test('pickTarget stays inside the bounds for any roll', () => {
  // Try the corners and the middle; every roll must produce an in-bounds
  // target the pet rect can actually sit at.
  for (const [x, y] of [[0, 0], [700, 400], [500, 60], [0, 300]]) {
    for (let i = 0; i < 200; i += 1) {
      const t = PetWander.pickTarget({
        x, y, ...PET, bounds: BOUNDS, facing: i % 2 ? 1 : -1, scale: 1,
      });
      assert.ok(t.x >= BOUNDS.x && t.x <= BOUNDS.x + BOUNDS.width - PET.w,
        `x ${t.x} in bounds from (${x},${y})`);
      assert.ok(t.y >= BOUNDS.y && t.y <= BOUNDS.y + BOUNDS.height - PET.h,
        `y ${t.y} in bounds`);
      assert.ok(t.y <= BOUNDS.y + BOUNDS.height * 0.6 - PET.h + 0.001
        || t.y === y && (BOUNDS.y + BOUNDS.height * 0.6 - PET.h) < BOUNDS.y + BOUNDS.height * 0.08,
        'y cruises the upper band');
    }
  }
});

test('pickTarget biases x along the current facing', () => {
  let forward = 0;
  const rolls = 400;
  for (let i = 0; i < rolls; i += 1) {
    const t = PetWander.pickTarget({
      x: 400, y: 200, ...PET, bounds: BOUNDS, facing: 1, scale: 1,
      rand: () => 0.4, // deterministic-ish roll under the 0.7 keep-facing cut
    });
    if (t.x > 400) { forward += 1; }
  }
  assert.ok(forward > rolls * 0.6, `mostly forward, got ${forward}/${rolls}`);
});

test('pickTarget edge-bounces instead of clamping flat', () => {
  // Hugging the left edge facing left — a plain clamp would return x=0
  // (no motion); the bounce flips direction so she still moves.
  const t = PetWander.pickTarget({
    x: 30, y: 200, ...PET, bounds: BOUNDS, facing: -1, scale: 1, rand: () => 0.9,
  });
  assert.ok(t.x > 30, `bounced off the left edge, got x=${t.x}`);
});

test('makeGlide + glidePos ease between endpoints and report done', () => {
  const g = PetWander.makeGlide({ x: 0, y: 0 }, { x: 300, y: 0 }, 100);
  assert.ok(g.dur >= 0.4);
  const mid = PetWander.glidePos(g, g.dur / 2);
  assert.ok(mid.x > 0 && mid.x < 300, 'midway');
  assert.equal(mid.done, false);
  const end = PetWander.glidePos(g, g.dur + 1);
  assert.equal(end.x, 300);
  assert.equal(end.done, true);
  assert.equal(end.dir, 1);
  // Ease-in-out is symmetric: both end quarters cover less than linear.
  const q1 = PetWander.glidePos(g, g.dur * 0.25).x;
  const q3 = PetWander.glidePos(g, g.dur * 0.75).x;
  assert.ok(q1 < 75, `eases in (${q1} < 75)`);
  assert.ok(300 - q3 < 75, `eases out (${300 - q3} < 75)`);
});

test('speedFor: livelier tiers glide faster, bigger pets slower', () => {
  // Tier ranges overlap (active 70–90, balanced 55–75, quiet 40–60), so the
  // ordering only holds at a pinned roll — sweep it to cover every roll.
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    const rand = () => roll;
    assert.ok(PetWander.speedFor('active', 1, rand) > PetWander.speedFor('balanced', 1, rand));
    assert.ok(PetWander.speedFor('balanced', 1, rand) > PetWander.speedFor('quiet', 1, rand));
    assert.ok(PetWander.speedFor('balanced', 1.6, rand) < PetWander.speedFor('balanced', 0.6, rand));
  }
});

test('ease endpoints and midpoint are exact', () => {
  assert.equal(PetWander.ease(0), 0);
  assert.equal(PetWander.ease(1), 1);
  assert.ok(Math.abs(PetWander.ease(0.5) - 0.5) < 1e-9);
});
