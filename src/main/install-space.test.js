'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkInstallSpace } = require('./install-space');

test('space preflight uses available blocks on the nearest existing parent', () => {
  const root = path.resolve('space-fixture');
  const seen = [];
  const result = checkInstallSpace(path.join(root, 'missing'), 800, { reserve: 100, statfs: (dir) => {
    seen.push(dir);
    if (dir !== root) throw Object.assign(new Error(), { code: 'ENOENT' });
    return { bavail: 10, bfree: 100, bsize: 100 };
  } });
  assert.equal(result.available, 1000);
  assert.equal(result.required, 900);
  assert.deepEqual(seen, [path.join(root, 'missing'), root]);
});

test('space preflight distinguishes low space, unsupported probes and permission failures', () => {
  assert.throws(() => checkInstallSpace('.', 800, { reserve: 100, statfs: () => ({ bavail: 1, bsize: 100 }) }), { code: 'ENOSPC' });
  assert.deepEqual(checkInstallSpace('.', 800, { statfs: () => { throw Object.assign(new Error(), { code: 'ENOSYS' }); } }), { checked: false });
  assert.throws(() => checkInstallSpace('.', 800, { statfs: () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }), { code: 'EACCES' });
});
