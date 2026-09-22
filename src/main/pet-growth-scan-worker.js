'use strict';

// Off-thread session-log scanner for the live2d pet's token feeding. It
// lives on a worker thread on purpose: decoding + JSON-parsing a growing
// session log is O(log size), and on the Electron main thread the 60s
// rescan stalled every window and IPC for as long as the decode took.
//
// Loaded through asarUnpack — plain-node worker threads cannot read files
// inside app.asar (same constraint as dshd-daemon-runner). The unchanged
// file cache lives here across scans, so a steady-state tick is stat-only
// per log and only newly-written files pay a decode.

const { parentPort } = require('node:worker_threads');
const { scanSessionTokens } = require('./pet-growth');

const cache = new Map();

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'scan') {
    return;
  }
  try {
    const { total, sessions } = scanSessionTokens(msg.sessionsDir || '', cache);
    parentPort.postMessage({ id: msg.id, ok: true, total, sessions });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
});
