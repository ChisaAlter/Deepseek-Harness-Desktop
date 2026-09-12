'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DESKTOP_PET_FEATURE,
  boundsForPosition,
  configureDesktopPet,
  getDesktopPet,
  isPetFrameUrl,
  normalizePetState,
  positionFromBounds,
} = require('./desktop-pet');

test('DESKTOP_PET_FEATURE=false disables the manager without touching electron', () => {
  assert.equal(DESKTOP_PET_FEATURE, false);
  assert.equal(configureDesktopPet(), null);
  assert.equal(getDesktopPet(), null);
});

test('pet state normalizes malformed values to bounded defaults', () => {
  assert.deepEqual(normalizePetState({ enabled: false, xRatio: -2, yRatio: 'bad' }), {
    enabled: false,
    xRatio: 0,
    yRatio: 0.72,
  });
  assert.deepEqual(normalizePetState(null), {
    enabled: true,
    xRatio: 0.82,
    yRatio: 0.72,
  });
});

test('pet bounds stay inside the content area and leave an edge gap', () => {
  const bounds = boundsForPosition({ width: 1_440, height: 872 }, {
    enabled: true,
    xRatio: 1,
    yRatio: 1,
  });
  assert.equal(bounds.width, 88);
  assert.equal(bounds.height, 88);
  assert.equal(bounds.x, 1336);
  assert.equal(bounds.y, 768);
  assert.ok(bounds.x + bounds.width <= 1_440 - 16);
  assert.ok(bounds.y + bounds.height <= 872 - 16);
});

test('drag position round-trips through normalized coordinates', () => {
  const windowBounds = { width: 1_440, height: 872 };
  const state = { enabled: true, xRatio: 0.35, yRatio: 0.4 };
  const bounds = boundsForPosition(windowBounds, state);
  const next = positionFromBounds(windowBounds, bounds.x + 48, bounds.y + 24);
  assert.ok(next.xRatio > state.xRatio);
  assert.ok(next.yRatio > state.yRatio);
  assert.deepEqual(positionFromBounds(windowBounds, -1000, -1000), { xRatio: 0, yRatio: 0 });
});

test('pet IPC accepts only its exact file frame', () => {
  const petUrl = 'file:///C:/app/src/renderer/pet.html';
  assert.equal(isPetFrameUrl(petUrl, petUrl), true);
  assert.equal(isPetFrameUrl(`${petUrl}#hash`, petUrl), true);
  assert.equal(isPetFrameUrl('file:///C:/app/src/renderer/boot.html', petUrl), false);
  assert.equal(isPetFrameUrl('https://example.test/pet.html', petUrl), false);
});
