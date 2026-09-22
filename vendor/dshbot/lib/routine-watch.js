/**
 * Routine watch checks: fetch a URL or run a local shell command and hash the
 * observed content so the scheduler can skip unchanged runs. Errors throw —
 * a failed check is not 'unchanged'; the caller records lastError and still
 * queues the run.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';

const MAX_WATCH_CHARS = 65_536;
const DEFAULT_TIMEOUT_MS = 15_000;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function timeoutMs(watch) {
  const value = Number(watch?.timeoutMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

async function runUrlWatch(watch) {
  const ms = timeoutMs(watch);
  const response = await fetch(String(watch.value), {
    signal: AbortSignal.timeout(ms),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Watch URL returned HTTP ${response.status}.`);
  const content = (await response.text()).slice(0, MAX_WATCH_CHARS);
  return { hash: sha256(content), content };
}

function runCommandWatch(watch, { cwd } = {}) {
  const ms = timeoutMs(watch);
  const command = String(watch.value);
  const [file, args] = process.platform === 'win32'
    ? ['cmd', ['/d', '/s', '/c', command]]
    : ['sh', ['-c', command]];
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      timeout: ms,
      maxBuffer: MAX_WATCH_CHARS,
      ...(cwd ? { cwd } : {}),
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = error.killed ? `timed out after ${ms}ms` : String(error.message ?? error);
        reject(new Error(`Watch command failed: ${detail}`));
        return;
      }
      const content = `${String(stdout ?? '')}${String(stderr ?? '')}`.slice(0, MAX_WATCH_CHARS);
      resolve({ hash: sha256(content), content });
    });
  });
}

/**
 * Run one watch check.
 * @param {{ kind: 'url' | 'command', value: string, timeoutMs?: number }} watch
 * @param {{ cwd?: string }} [options] bot workspace for command watches
 * @returns {Promise<{ hash: string, content: string }>}
 */
export function runWatch(watch, options = {}) {
  if (watch?.kind === 'url') return runUrlWatch(watch);
  if (watch?.kind === 'command') return runCommandWatch(watch, options);
  return Promise.reject(new Error('Invalid routine watch.'));
}
