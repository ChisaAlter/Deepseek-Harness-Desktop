'use strict';

/** Discrete zoom levels mirroring Chrome's preset list. */
const ZOOM_LEVELS = Object.freeze([
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
]);

const DEFAULT_ZOOM_FACTOR = 1;
const ZOOM_EPSILON = 0.001;

/**
 * Index of the table step at or just below `current`.
 * @param {number} current
 * @returns {number}
 */
function findZoomStep(current) {
  const index = ZOOM_LEVELS.findIndex(
    (level) => Math.abs(level - current) < ZOOM_EPSILON || level > current,
  );
  if (index < 0) return ZOOM_LEVELS.length - 1;
  return Math.abs(ZOOM_LEVELS[index] - current) < ZOOM_EPSILON ? index : index - 1;
}

/**
 * Next Chrome-preset zoom factor from `current`.
 * @param {number} current
 * @param {'in' | 'out'} direction
 * @returns {number}
 */
function nextZoomLevel(current, direction) {
  const step = findZoomStep(current);
  if (direction === 'in') {
    return ZOOM_LEVELS[Math.min(step + 1, ZOOM_LEVELS.length - 1)] ?? current;
  }
  return ZOOM_LEVELS[Math.max(step - 1, 0)] ?? current;
}

module.exports = {
  ZOOM_LEVELS,
  DEFAULT_ZOOM_FACTOR,
  ZOOM_EPSILON,
  findZoomStep,
  nextZoomLevel,
};
