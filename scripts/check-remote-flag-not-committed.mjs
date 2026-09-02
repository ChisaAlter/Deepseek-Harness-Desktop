#!/usr/bin/env node
/**
 * The mobile-remote feature ships parked (REMOTE_FEATURE_ENABLED = false).
 * Local LAN rehearsals flip it in the working tree; that flip must never be
 * staged. Exit 1 when the staged diff of src/main/config.js enables it.
 */
import { execFileSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (staged.includes('src/main/config.js')) {
  const diff = execFileSync('git', ['diff', '--cached', '--', 'src/main/config.js'], { encoding: 'utf8' });
  if (/^\+const REMOTE_FEATURE_ENABLED = true;/m.test(diff)) {
    console.error('REMOTE_FEATURE_ENABLED=true must not be committed (local unpark only).');
    process.exit(1);
  }
}
console.log('remote flag guard ok');
