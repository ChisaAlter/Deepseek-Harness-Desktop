'use strict';

const path = require('node:path');
const { parseSyncArgs, syncHarness } = require('../src/shared/harness-sync');

const root = path.join(__dirname, '..');
const args = parseSyncArgs(process.argv.slice(2));
const result = syncHarness({ root, args });
if (result.status === 'conflict') {
  process.exit(2);
}
if (result.status === 'aborted' || result.status === 'dry-run' || result.status === 'applied') {
  process.exit(0);
}
process.exit(1);
