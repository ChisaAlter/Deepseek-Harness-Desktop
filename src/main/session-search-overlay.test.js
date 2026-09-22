'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureSessionSearchOverlay } = require('./session-search-overlay');

test('ensureSessionSearchOverlay writes a full-start overlay that opts into first-search FTS', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const profileDir = path.join(home, 'profiles', 'web');
  try {
    const result = ensureSessionSearchOverlay({ profileDir, dshHome: home });
    assert.equal(result.ok, true);
    const overlayFile = path.join(
      profileDir,
      'desktop-plugins',
      'session-search',
      'desktop-session-search.patch.yml',
    );
    assert.equal(result.overlayFile, overlayFile);
    const overlay = fs.readFileSync(overlayFile, 'utf8');
    assert.match(overlay, /id: session-query-sqlite/);
    assert.match(overlay, /openAt: first-search/);
    assert.equal(overlay.includes('openAt: never'), false);
    assert.equal(overlay.includes("path: ':memory:'"), false);
    const indexPath = path.join(home, 'session-query.sqlite');
    assert.ok(overlay.includes(JSON.stringify(indexPath.replace(/\\/g, '/'))));
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('ensureSessionSearchOverlay does not rewrite the user-owned profile patch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const profileDir = path.join(home, 'profiles', 'web');
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(patchFile, '- id: message-edit\n  disabled: true\n', 'utf8');
    const result = ensureSessionSearchOverlay({ profileDir, dshHome: home });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(patchFile, 'utf8'), '- id: message-edit\n  disabled: true\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('ensureSessionSearchOverlay fails closed without a desktop home', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-'));
  try {
    const result = ensureSessionSearchOverlay({ profileDir, dshHome: '' });
    assert.equal(result.ok, false);
    assert.match(String(result.error || ''), /DSH home/i);
    assert.equal(result.overlayFile, undefined);
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
