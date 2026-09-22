'use strict';

// Autonomous wandering — pure logic layer (no DOM), testable like
// pet-physics.js / pet-dialogue.js. The pet-live2d.js integration drives
// the FSM; this module only answers "where next" and "where along the
// glide". Whales SWIM: targets may drift vertically inside the upper
// band, unlike the reference project's floor-bound walking.
var PetWander = (function () {
  // x reach per leg: 60–240px (scaled by pet size); 70% odds she keeps her
  // facing, otherwise she turns around. y picks inside the upper 60% band
  // of the display — she cruises mid-air, not on the floor.
  function pickTarget(opts) {
    const { x, y, w, h, bounds, facing, scale, rand } = opts || {};
    const r = typeof rand === 'function' ? rand : Math.random;
    const reach = (60 + r() * 180) * (Number.isFinite(scale) ? scale : 1);
    const dir = r() < 0.7 ? (facing || 1) : -(facing || 1);
    const lo = bounds.x;
    const hi = bounds.x + bounds.width - w;
    let tx = x + dir * reach;
    if (tx < lo || tx > hi) {
      // Edge bounce: pick the other direction instead of clamping flat.
      tx = x - dir * reach;
    }
    tx = Math.min(Math.max(tx, lo), Math.max(lo, hi));
    const bandTop = bounds.y + bounds.height * 0.08;
    const bandBot = bounds.y + bounds.height * 0.6 - h;
    const ty = bandBot > bandTop
      ? bandTop + r() * (bandBot - bandTop)
      : Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - h);
    return { x: tx, y: ty };
  }

  // Glide speed px/s by activity tier; bigger whales glide a touch slower.
  // rand injectable like pickTarget's so tests can pin the roll — the tier
  // ranges overlap, so single random draws are never guaranteed to order.
  function speedFor(activity, scale, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const base = activity === 'quiet' ? 40 + r() * 20
      : activity === 'active' ? 70 + r() * 20
        : 55 + r() * 20;
    const s = Number.isFinite(scale) ? scale : 1;
    return base / Math.max(1, s * 0.85);
  }

  function makeGlide(from, to, speed) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const dur = Math.max(0.4, dist / Math.max(20, speed || 60));
    return { x0: from.x, y0: from.y, x1: to.x, y1: to.y, dur };
  }

  // ease-in-out so she accelerates out of a stop and settles into one.
  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  }

  function glidePos(g, elapsedSec) {
    const k = Math.min(1, Math.max(0, elapsedSec / Math.max(0.001, g.dur)));
    const e = ease(k);
    return {
      x: g.x0 + (g.x1 - g.x0) * e,
      y: g.y0 + (g.y1 - g.y0) * e,
      done: k >= 1,
      dir: Math.sign(g.x1 - g.x0) || 0,
    };
  }

  return { pickTarget, speedFor, makeGlide, ease, glidePos };
})();

if (typeof window !== 'undefined') {
  window.PetWander = PetWander;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PetWander;
}
