'use strict';

// Pure-function drag-physics core for the desktop pet: spring stepping while
// dragged, release-velocity estimation on drop, and thrown-object integration
// with boundary bounces. Ported 1:1 from pet/physics.py — same constants, same
// math, same semantics; pure functions keep it unit-testable while the caller
// (pet-live2d.js) only feeds state and repaints the character.
//
// Loaded via a plain <script> tag (no bundler), so the public API hangs off
// the single global `PetPhysics` below.
var PetPhysics = (() => {

  // ---- drag spring ----
  const SPRING_K = 200.0;          // spring stiffness: higher = tighter follow
  const SPRING_C = 30.0;           // damping: ζ=c/(2√k)≈1.06 overdamped, no overshoot

  // ---- release-velocity estimation ----
  const TRAIL_KEEP_SEC = 0.15;     // how much drag trail history the caller keeps
  const RELEASE_WINDOW_SEC = 0.12; // estimate uses this tail window of the trail
  const RELEASE_STALE_SEC = 0.15;  // a pause before release longer than this =
                                   // "set down in place" (no residual velocity)
  const MIN_SPAN_SEC = 0.02;       // window shorter than this is not estimable
  const SEG_MIN_DT = 0.008;        // min per-segment dt: high-rate mouse events
                                   // can arrive 1ms apart; too-small dt turns
                                   // jitter into fake peaks, so short segments
                                   // merge forward into the next sample
  const DEAD_ZONE_SPEED = 500.0;   // below this = dropped in place (px/s) —
                                   // enforced by the caller, not this module
  const MAX_THROW_SPEED = 6000.0;  // default throw-speed cap (px/s): the
                                   // soft-knee asymptote
  const PEAK_WEIGHT = 0.5;         // |v0| = endpoint mean*(1-w) + window peak*w
  const ACCEL_REF = 8000.0;        // reference accel (px/s²): a still-accelerating
                                   // tail segment at this rate eats the full gain
  const ACCEL_GAIN_MAX = 0.6;      // accel gain cap: a still-accelerating flick
                                   // is amplified by at most 60%

  // ---- throw strength tiers ----
  const THROW_STRENGTH_CAPS = {
    gentle: 3600.0,
    standard: 4800.0,
    strong: 7200.0,
    crazy: 9000.0,
  };

  /**
   * Normalize a user-supplied strength name to a known tier ("standard" when
   * unknown/empty). Mirrors Python `str(value or "").strip().lower()`.
   * @param {*} value
   * @returns {string}
   */
  function normalizeThrowStrength(value) {
    const s = String(value || '').trim().toLowerCase();
    // own-key check (NOT `s in THROW_STRENGTH_CAPS`): Python's `in` on a dict
    // sees only own keys, while JS `in` would also match e.g. "constructor".
    return Object.prototype.hasOwnProperty.call(THROW_STRENGTH_CAPS, s)
      ? s
      : 'standard';
  }

  /**
   * Speed cap (px/s) for a strength tier name.
   * @param {string} strength
   * @returns {number}
   */
  function throwSpeedCap(strength) {
    return THROW_STRENGTH_CAPS[normalizeThrowStrength(strength)];
  }

  // ---- slingshot parameters (non-configurable constants) ----
  const SLINGSHOT_MIN_DISTANCE = 24.0;
  const SLINGSHOT_MAX_DISTANCE = 160.0;
  const SLINGSHOT_BASE_SPEED = 900.0;
  const SLINGSHOT_MAX_DEFORMATION = 1.3;

  /**
   * Smooth x/y scale factors for an anisotropic slingshot stretch.
   *
   * The stretch and compression axes are projected onto the widget axes, so
   * changing the pull angle never selects between discontinuous branches.
   * @param {number} pullX
   * @param {number} pullY
   * @param {number} progress clamped to [0, 1]
   * @param {number} [maximum] clamped to >= 1
   * @returns {{sx: number, sy: number}}
   */
  function slingshotDeformation(pullX, pullY, progress, maximum = SLINGSHOT_MAX_DEFORMATION) {
    progress = Math.max(0.0, Math.min(1.0, progress));
    maximum = Math.max(1.0, maximum);
    const distance = Math.hypot(pullX, pullY);
    if (distance <= 1e-6 || progress <= 0.0) {
      return { sx: 1.0, sy: 1.0 };
    }
    const ux = pullX / distance;
    const uy = pullY / distance;
    const stretch = 1.0 + (maximum - 1.0) * progress;
    const squeeze = 1.0 - (1.0 - 1.0 / maximum) * progress;
    return {
      sx: Math.hypot(stretch * ux, squeeze * uy),
      sy: Math.hypot(stretch * uy, squeeze * ux),
    };
  }

  // ---- throw ----
  const GRAVITY = 1400.0;          // px/s²
  const RESTITUTION = 0.78;        // edge-bounce restitution
  const GROUND_FRICTION = 2.5;     // ground horizontal friction (/s)
  const REST_VY = 40.0;            // |vy| below this on landing stops vertically
  const REST_VX = 15.0;            // |vx| below this on the ground counts as stopped

  /**
   * Soft speed cap: cap*(1-e^(-s/cap)). A hard clamp would crush every fast
   * flick into the same speed ("any throw feels identical"); the soft-knee
   * curve keeps speed monotonically distinguishable at any input strength
   * while still asymptotically staying under `cap`.
   * @param {number} speed
   * @param {number} [cap]
   * @returns {number}
   */
  function softClampSpeed(speed, cap = MAX_THROW_SPEED) {
    if (speed <= 0.0 || cap <= 0.0) {
      return 0.0;
    }
    return cap * (1.0 - Math.exp(-speed / cap));
  }

  /**
   * Map pull distance to an ease-out launch speed bounded by `cap`.
   * @param {number} distance
   * @param {number} minimum pull distance that starts counting
   * @param {number} maximum pull distance that saturates the ease curve
   * @param {number} cap soft-knee cap
   * @returns {number}
   */
  function slingshotSpeed(distance, minimum, maximum, cap) {
    if (distance < minimum || maximum <= minimum || cap <= 0.0) {
      return 0.0;
    }
    const u = Math.max(0.0, Math.min(1.0, (distance - minimum) / (maximum - minimum)));
    const eased = 1.0 - (1.0 - u) ** 2;
    const raw = SLINGSHOT_BASE_SPEED + (3.0 * cap - SLINGSHOT_BASE_SPEED) * eased;
    return softClampSpeed(raw, cap);
  }

  /**
   * Sample a first-flight parabolic path relative to its launch point.
   * @param {number} vx
   * @param {number} vy
   * @param {number} [duration]
   * @param {number} [points]
   * @param {number} [gravity]
   * @returns {Array<[number, number]>} list of [x, y] offsets
   */
  function slingshotTrajectory(vx, vy, duration = 0.8, points = 12, gravity = GRAVITY) {
    if (duration <= 0.0 || points <= 0) {
      return [];
    }
    if (points === 1) {
      return [[0.0, 0.0]];
    }
    const step = duration / (points - 1);
    const out = [];
    for (let i = 0; i < points; i += 1) {
      const t = i * step;
      out.push([vx * t, vy * t + 0.5 * gravity * t * t]);
    }
    return out;
  }

  /**
   * Overdamped spring single-axis velocity step (caller then does x += v*dt).
   * @param {number} v current velocity
   * @param {number} x current position
   * @param {number} target drag target
   * @param {number} dt step (s)
   * @param {number} [k] stiffness
   * @param {number} [c] damping
   * @returns {number} new velocity
   */
  function springVelocity(v, x, target, dt, k = SPRING_K, c = SPRING_C) {
    return v + ((target - x) * k - v * c) * dt;
  }

  /**
   * Estimate release velocity (vx, vy) from the drag trail.
   *
   * Direction: displacement between window endpoints (jitter-resistant).
   * Magnitude: endpoint-mean speed blended with the in-window peak segment
   * speed by PEAK_WEIGHT — a pure endpoint average under-estimates fast flicks
   * because their displacement is concentrated in a small slice of the window.
   * Gain: when the tail is still accelerating (last segment speed > first
   * segment speed) the speed is scaled by the accel's share of ACCEL_REF, up
   * to ACCEL_GAIN_MAX.
   * Stale release: a pause longer than RELEASE_STALE_SEC before release
   * returns zero velocity (pet was set down, not thrown).
   * @param {Array<[number, number, number]>} trail [t, x, y] triples, time-sorted
   * @param {number} now release time (same clock as trail t values)
   * @param {number} [cap] soft-knee cap
   * @returns {{vx: number, vy: number}}
   */
  function estimateReleaseVelocity(trail, now, cap = MAX_THROW_SPEED) {
    if (!trail || trail.length === 0) {
      return { vx: 0.0, vy: 0.0 };
    }
    if (now - trail[trail.length - 1][0] > RELEASE_STALE_SEC) {
      return { vx: 0.0, vy: 0.0 };
    }
    const cutoff = now - RELEASE_WINDOW_SEC;
    const win = trail.filter((s) => s[0] >= cutoff);
    if (win.length < 2) {
      return { vx: 0.0, vy: 0.0 };
    }
    const t0 = win[0][0];
    const x0 = win[0][1];
    const y0 = win[0][2];
    const t1 = win[win.length - 1][0];
    const x1 = win[win.length - 1][1];
    const y1 = win[win.length - 1][2];
    const span = t1 - t0;
    if (span < MIN_SPAN_SEC) {
      return { vx: 0.0, vy: 0.0 };
    }

    const dx = x1 - x0;
    const dy = y1 - y0;
    const baseVx = dx / span;
    const baseVy = dy / span;
    const baseSpeed = Math.hypot(baseVx, baseVy);

    // Per-segment speeds (over-dense samples merge forward, dt floor SEG_MIN_DT).
    const segSpeeds = []; // [speed, tEnd]
    let px = x0;
    let py = y0;
    let pt = t0;
    for (let i = 1; i < win.length; i += 1) {
      const t = win[i][0];
      const x = win[i][1];
      const y = win[i][2];
      const dt = t - pt;
      if (dt >= SEG_MIN_DT) {
        segSpeeds.push([Math.hypot(x - px, y - py) / dt, t]);
        px = x;
        py = y;
        pt = t;
      }
    }
    // Python: max(seg speeds, default=base_speed) — the default only applies
    // when there are no valid segments; base_speed itself is not a candidate.
    let peakSpeed = baseSpeed;
    if (segSpeeds.length > 0) {
      peakSpeed = segSpeeds[0][0];
      for (let i = 1; i < segSpeeds.length; i += 1) {
        if (segSpeeds[i][0] > peakSpeed) {
          peakSpeed = segSpeeds[i][0];
        }
      }
    }

    // Tail acceleration: last valid segment vs first valid segment.
    let accel = 0.0;
    if (segSpeeds.length >= 2) {
      accel = (segSpeeds[segSpeeds.length - 1][0] - segSpeeds[0][0])
        / Math.max(segSpeeds[segSpeeds.length - 1][1] - segSpeeds[0][1], MIN_SPAN_SEC);
    }

    let speed = (1.0 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed;
    const gain = 1.0 + Math.min(Math.max(accel, 0.0) / ACCEL_REF, 1.0) * ACCEL_GAIN_MAX;
    speed = softClampSpeed(speed * gain, cap);

    if (baseSpeed < 1e-6) {
      // Near-pure jitter inside the window: no reliable direction, so the pet
      // just falls vertically with the estimated magnitude.
      return { vx: 0.0, vy: speed };
    }
    return { vx: baseVx / baseSpeed * speed, vy: baseVy / baseSpeed * speed };
  }

  /**
   * One throw-integration step plus boundary bounce.
   * @param {number} px
   * @param {number} py
   * @param {number} vx
   * @param {number} vy
   * @param {number} dt step (s)
   * @param {number} left
   * @param {number} top
   * @param {number} right
   * @param {number} bottom ground line; touching it applies friction and the
   *   REST_VY stop rule
   * @param {number} [gravity]
   * @returns {{px: number, py: number, vx: number, vy: number, bounced: boolean}}
   */
  function throwStep(px, py, vx, vy, dt, left, top, right, bottom, gravity = GRAVITY) {
    vy += gravity * dt;
    px += vx * dt;
    py += vy * dt;
    let bounced = false;
    if (px < left) {
      px = left;
      vx = Math.abs(vx) * RESTITUTION;
      bounced = true;
    } else if (px > right) {
      px = right;
      vx = -Math.abs(vx) * RESTITUTION;
      bounced = true;
    }
    if (py < top) {
      py = top;
      vy = Math.abs(vy) * RESTITUTION;
      bounced = true;
    } else if (py >= bottom) {
      py = bottom;
      vx *= Math.max(0.0, 1.0 - GROUND_FRICTION * dt);
      if (Math.abs(vy) < REST_VY) {
        vy = 0.0;
      } else {
        vy = -Math.abs(vy) * RESTITUTION;
      }
      bounced = true;
    }
    return { px, py, vx, vy, bounced };
  }

  /**
   * Throw termination check: resting on the ground with both axes slow, or
   * overall slow right after a bounce.
   * @param {number} py
   * @param {number} vx
   * @param {number} vy
   * @param {number} bottom
   * @param {boolean} bounced result of the last throwStep
   * @param {number} speed overall speed |v|
   * @returns {boolean}
   */
  function isAtRest(py, vx, vy, bottom, bounced, speed) {
    if (py >= bottom - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX) {
      return true;
    }
    return bounced && speed < REST_VY && Math.abs(vy) < 1;
  }

  return {
    SPRING_K,
    SPRING_C,
    TRAIL_KEEP_SEC,
    RELEASE_WINDOW_SEC,
    RELEASE_STALE_SEC,
    MIN_SPAN_SEC,
    SEG_MIN_DT,
    DEAD_ZONE_SPEED,
    MAX_THROW_SPEED,
    PEAK_WEIGHT,
    ACCEL_REF,
    ACCEL_GAIN_MAX,
    THROW_STRENGTH_CAPS,
    normalizeThrowStrength,
    throwSpeedCap,
    SLINGSHOT_MIN_DISTANCE,
    SLINGSHOT_MAX_DISTANCE,
    SLINGSHOT_BASE_SPEED,
    SLINGSHOT_MAX_DEFORMATION,
    slingshotDeformation,
    GRAVITY,
    RESTITUTION,
    GROUND_FRICTION,
    REST_VY,
    REST_VX,
    softClampSpeed,
    slingshotSpeed,
    slingshotTrajectory,
    springVelocity,
    estimateReleaseVelocity,
    throwStep,
    isAtRest,
  };
})();
