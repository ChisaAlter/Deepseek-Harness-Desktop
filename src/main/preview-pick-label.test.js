'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeLabelPosition } = require('./preview-pick-label.js');

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 800 };

test('anchors to the element top-left when there is room above and to the right', () => {
  const { x, y } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: 200,
    targetTop: 200,
    targetBottom: 240,
    labelWidth: 120,
    labelHeight: 18,
  });
  assert.equal(x, 200);
  assert.equal(y, 200 - 18 - 4);
});

test('clamps the left edge so the label stays inside the viewport', () => {
  const { x } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: -50,
    targetTop: 200,
    targetBottom: 240,
    labelWidth: 120,
    labelHeight: 18,
  });
  assert.equal(x, 4);
});

test('clamps the right edge when the label would overflow the viewport', () => {
  const { x } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: 1240,
    targetTop: 200,
    targetBottom: 240,
    labelWidth: 200,
    labelHeight: 18,
  });
  assert.equal(x, 1076);
});

test('flips the label below the element when there is no room above', () => {
  const { y } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: 200,
    targetTop: 4,
    targetBottom: 44,
    labelWidth: 120,
    labelHeight: 18,
  });
  assert.equal(y, 48);
});

test('pins to the bottom margin when the element fills the viewport', () => {
  const { y } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: 200,
    targetTop: 0,
    targetBottom: 800,
    labelWidth: 120,
    labelHeight: 18,
  });
  assert.equal(y, 800 - 18 - 4);
});

test('never returns a negative coordinate', () => {
  const { x, y } = computeLabelPosition({
    ...VIEWPORT,
    targetLeft: -1000,
    targetTop: -1000,
    targetBottom: -900,
    labelWidth: 5000,
    labelHeight: 5000,
  });
  assert.ok(x >= 0);
  assert.ok(y >= 0);
});
