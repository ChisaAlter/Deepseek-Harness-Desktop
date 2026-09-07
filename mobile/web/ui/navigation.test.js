import test from 'node:test';
import assert from 'node:assert/strict';
import { backTarget, createNavigation } from './navigation.js';

test('Back resolves only the top task, keeping business objects out of history', () => {
  assert.equal(backTarget({ settingsOpen: true, settingsPane: '模型', pickerSheet: 'model' }), 'picker');
  assert.equal(backTarget({ newSession: { step: 'browse' }, folderCreate: {} }), 'folderCreate');
  assert.equal(backTarget({ newSession: { step: 'browse' } }), 'directory');
  assert.equal(backTarget({ gitDialog: 'create-branch' }), 'git');
  assert.equal(backTarget({ lightbox: {}, sessionConfirm: {} }), 'lightbox');
  assert.equal(backTarget({}), 'root');
});

function fixture() {
  const entries = [{ url: '/dshd/' }];
  let index = 0;
  let listener;
  let pending;
  let depth = 0;
  let blocked = false;
  const history = {
    get state() { return entries[index].state; },
    replaceState(state) { entries[index] = { url: '/dshd/', state }; },
    pushState(state) { entries.splice(index + 1); entries.push({ state }); index++; },
    back() { pending = () => { if (index > 0) index--; listener({ state: history.state }); }; },
  };
  const nav = createNavigation({ history, listen: (fn) => { listener = fn; },
    hasSurface: () => depth > 0, isBlocked: () => blocked,
    getSurfaceKey: () => depth,
    onBack: () => { depth--; }, canTrack: () => true });
  return { nav, entries, history, setDepth(value) { depth = value; nav.sync(); },
    get depth() { return depth; }, block(value) { blocked = value; },
    flush() { const fn = pending; pending = null; fn?.(); },
    forward() { index = Math.min(entries.length - 1, index + 1); listener({ state: history.state }); },
  };
}

test('one transient history entry closes nested layers one at a time', () => {
  const f = fixture(); f.setDepth(3);
  assert.equal(f.entries.length, 2);
  assert.equal(f.nav.back(), 'handled');
  assert.equal(f.nav.back(), 'busy');
  f.flush(); assert.equal(f.depth, 2);
  f.nav.back(); f.flush(); assert.equal(f.depth, 1);
  f.nav.back(); f.flush(); assert.equal(f.depth, 0);
  assert.equal(f.nav.back(), 'root');
  f.forward(); f.flush(); assert.equal(f.depth, 0);
  assert.equal(f.history.state?.dshdSurface, undefined);
});

test('closing tasks and immediately opening another does not double-dismiss', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    f.setDepth(1); f.setDepth(0); f.setDepth(1); f.flush();
    assert.equal(f.depth, 1);
    f.setDepth(0); f.flush();
  }
  assert.equal(f.entries.length, 2);
});

test('pending writes cannot be dismissed by Back and no payload enters history', () => {
  const f = fixture(); f.setDepth(1); f.block(true);
  assert.equal(f.nav.back(), 'busy');
  f.history.back(); f.flush(); assert.equal(f.depth, 1);
  assert.deepEqual(Object.keys(f.history.state), ['dshdSurface']);
  f.block(false); f.nav.back(); f.flush(); assert.equal(f.depth, 0);
});

test('a queued Back cannot dismiss a replacement surface', () => {
  const f = fixture(); f.setDepth(1);
  f.nav.back();
  f.setDepth(0); f.setDepth(2); f.flush();
  assert.equal(f.depth, 2);
  f.nav.back(); f.flush(); assert.equal(f.depth, 1);
});
