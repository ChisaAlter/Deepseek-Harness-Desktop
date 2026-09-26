'use strict';

// Slim-launcher boot evidence: the spawned external runtime is detached and
// its stdio would otherwise be discarded, so a plugin-caused startup crash
// left no attributable lines for collectForensics. attachBootLog pipes child
// stdout/stderr into one bounded file that keeps the TAIL — the crash lines
// live at the end — and every fs failure degrades to a no-op so logging can
// never take the spawn path down. readBootLogTail feeds the forensics corpus
// in launcher-service.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;
const ROTATE_KEEP_BYTES = Math.floor(MAX_BYTES / 2);
const TAIL_LINES = 200;

function noop() {}

function bootLogPath(stateDir) {
  return path.join(stateDir, 'logs', 'last-external-boot.log');
}

// Drop the oldest half once over cap, restarting on a line boundary so the
// kept tail stays parseable evidence instead of a mid-token fragment.
function rotateTail(file, fsm) {
  const buf = fsm.readFileSync(file);
  let tail = buf.subarray(Math.max(0, buf.length - ROTATE_KEEP_BYTES));
  const newline = tail.indexOf(0x0a);
  if (newline >= 0 && newline < tail.length - 1) {
    tail = tail.subarray(newline + 1);
  }
  fsm.writeFileSync(file, tail);
  return tail.length;
}

function attachBootLog(child, file, deps = {}) {
  const fsm = deps.fs || fs;
  if (!file) {
    return { write: noop, line: noop };
  }
  let size = 0;
  try {
    fsm.mkdirSync(path.dirname(file), { recursive: true });
    fsm.writeFileSync(file, '');
  } catch {
    // Fresh-boot truncate failed (ACL, dir-is-file): appends below still try
    // per chunk, each independently guarded, so a transient deny is not fatal.
  }
  const write = (chunk) => {
    try {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      fsm.appendFileSync(file, buf);
      size += buf.length;
      if (size > MAX_BYTES) {
        size = rotateTail(file, fsm);
      }
    } catch {
      // EACCES/EPERM/ENOENT: best-effort evidence, never a spawn-path hazard.
    }
  };
  const line = (text) => {
    write(`\n[${new Date().toISOString()}] ${String(text)}\n`);
  };
  for (const stream of [child && child.stdout, child && child.stderr]) {
    if (stream && typeof stream.on === 'function') {
      stream.on('data', write);
      stream.on('error', noop);
      // Preserve detached-spawn semantics: the pipes must not pin the
      // launcher's event loop open any more than the child handle does.
      if (typeof stream.unref === 'function') {
        stream.unref();
      }
    }
  }
  return { write, line };
}

/**
 * Last `options.maxLines` non-empty lines for the forensics corpus, or []
 * when the file is missing/unreadable (no external boot has happened yet).
 */
function readBootLogTail(file, options = {}, deps = {}) {
  const fsm = deps.fs || fs;
  const maxLines = options.maxLines ?? TAIL_LINES;
  try {
    const text = fsm.readFileSync(file, 'utf8');
    return text
      .split('\n')
      .map((row) => row.replace(/\r$/, ''))
      .filter((row) => row.trim().length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

module.exports = {
  MAX_BYTES,
  TAIL_LINES,
  bootLogPath,
  attachBootLog,
  readBootLogTail,
};
