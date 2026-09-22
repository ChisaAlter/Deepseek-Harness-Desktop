'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  DESKTOP_PET_FEATURE,
  boundsForPosition,
  configureDesktopPet,
  createDesktopPetManager,
  getDesktopPet,
  isPetFrameUrl,
  normalizePetState,
  positionFromBounds,
} = require('./desktop-pet');

function stubIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  };
}

function petDeps(overrides = {}) {
  return {
    electron: {
      BrowserView: class {},
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
      ipcMain: stubIpcMain(),
    },
    rendererFile: (name) => `C:/app/src/renderer/${name}`,
    preloadFile: () => 'C:/app/src/preload/index.js',
    loadConfig: () => ({}),
    saveConfig: () => {},
    currentTheme: () => ({}),
    discoverPets: () => [],
    ...overrides,
  };
}

test('DESKTOP_PET_FEATURE=false hides the manager while the code path stays usable', (t) => {
  assert.equal(DESKTOP_PET_FEATURE, false);
  assert.equal(configureDesktopPet(petDeps()), null);
  assert.equal(getDesktopPet(), null);

  const deps = petDeps();
  const manager = createDesktopPetManager(deps);
  t.after(() => manager.dispose());
  assert.deepEqual(
    [...deps.electron.ipcMain.handlers.keys()].sort(),
    ['shell:pet-drag-commit', 'shell:pet-menu', 'shell:pet-state'],
  );
  manager.dispose();
  assert.equal(deps.electron.ipcMain.handlers.size, 0);
});

test('pet state normalizes malformed values to bounded defaults', () => {
  assert.deepEqual(normalizePetState({ enabled: false, xRatio: -2, yRatio: 'bad', petId: 42 }), {
    enabled: false,
    xRatio: 0,
    yRatio: 0.72,
    petId: '',
  });
  assert.deepEqual(normalizePetState(null), {
    enabled: true,
    xRatio: 0.82,
    yRatio: 0.72,
    petId: '',
  });
});

test('pet payload falls back to the first discovered pet or the placeholder', (t) => {
  const pets = [
    { id: 'alpha', displayName: 'Alpha', version: 1, cols: 8, rows: 9, cellWidth: 192, cellHeight: 208, sheetPath: '/pets/alpha/sheet.webp' },
    { id: 'beta', displayName: 'Beta', version: 2, cols: 8, rows: 11, cellWidth: 192, cellHeight: 208, sheetPath: '/pets/beta/sheet.webp' },
  ];
  const manager = createDesktopPetManager(petDeps({ discoverPets: () => pets }));
  t.after(() => manager.dispose());

  const fallback = manager.petPayload();
  assert.equal(fallback.pet.id, 'alpha');
  assert.equal(fallback.pet.sheetUrl, pathToFileURL('/pets/alpha/sheet.webp').href);
  assert.deepEqual(fallback.pets.map((pet) => pet.id), ['alpha', 'beta']);

  manager.setPet('beta');
  assert.equal(manager.getState().petId, 'beta');
  assert.equal(manager.petPayload().pet.id, 'beta');

  manager.setPet('deleted-pet');
  assert.equal(manager.petPayload().pet.id, 'alpha');

  const empty = createDesktopPetManager(petDeps({ discoverPets: () => [] }));
  t.after(() => empty.dispose());
  assert.equal(empty.petPayload().pet, null);
});

test('pet bounds stay inside the content area and leave an edge gap', () => {
  const bounds = boundsForPosition({ width: 1_440, height: 872 }, {
    enabled: true,
    xRatio: 1,
    yRatio: 1,
    petId: '',
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
