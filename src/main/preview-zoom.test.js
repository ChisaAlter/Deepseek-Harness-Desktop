'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ZOOM_FACTOR,
  ZOOM_EPSILON,
  ZOOM_LEVELS,
  findZoomStep,
  nextZoomLevel,
} = require('./preview-zoom.js');

test('ZOOM_LEVELS matches the Chrome preset table', () => {
  assert.deepEqual(
    [...ZOOM_LEVELS],
    [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5],
  );
  assert.equal(DEFAULT_ZOOM_FACTOR, 1);
  assert.equal(ZOOM_EPSILON, 0.001);
});

test('nextZoomLevel steps from 1.0 to 1.1 and 0.9', () => {
  assert.equal(nextZoomLevel(1, 'in'), 1.1);
  assert.equal(nextZoomLevel(1, 'out'), 0.9);
  assert.equal(nextZoomLevel(DEFAULT_ZOOM_FACTOR, 'in'), 1.1);
});

test('nextZoomLevel clamps at the table ends', () => {
  assert.equal(nextZoomLevel(0.25, 'out'), 0.25);
  assert.equal(nextZoomLevel(5, 'in'), 5);
});

test('findZoomStep snaps off-grid values down to the current step', () => {
  assert.equal(ZOOM_LEVELS[findZoomStep(1)], 1);
  assert.equal(ZOOM_LEVELS[findZoomStep(1.05)], 1);
  assert.equal(nextZoomLevel(1.05, 'in'), 1.1);
  assert.equal(nextZoomLevel(1.05, 'out'), 0.9);
  assert.equal(ZOOM_LEVELS[findZoomStep(10)], 5);
});
