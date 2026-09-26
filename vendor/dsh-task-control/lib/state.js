/**
 * Task-control state machine: admission lock ownership, pending-work drain,
 * and generation bookkeeping. Pure module — no cordis imports — so the shell
 * can exercise it under plain `node --test`.
 */

import { randomUUID } from 'node:crypto';

export const LOCKED_CODE = 'dshd/admission-locked';

/**
 * One shared control record per Host process.
 * @returns {{
 *   hostGeneration: string,
 *   startedAt: number,
 *   lockEpoch: number,
 *   lock: null | { lockId: string, owner: string, kind: string, generation: number, acquiredAt: number, expiresAt: number },
 *   pending: Set<Promise<unknown>>,
 *   stopping: boolean,
 * }}
 */
export function createControlState() {
  return {
    hostGeneration: randomUUID(),
    startedAt: Date.now(),
    lockEpoch: 0,
    lock: null,
    pending: new Set(),
    stopping: false,
  };
}

function lockLive(state, now) {
  return state.lock !== null && state.lock.expiresAt > now;
}

function pruneExpiredLock(state, now) {
  if (state.lock !== null && state.lock.expiresAt <= now) {
    state.lock = null;
    state.lockEpoch += 1;
  }
}

/**
 * Admit one unit of independent work while unlocked. Admitted work registers
 * in `pending` until `done()` runs; a lock acquire drains exactly this set, so
 * the admit check and the pending add stay synchronous/atomic.
 * @param {ReturnType<typeof createControlState>} state
 * @returns {{ accepted: true, done: () => void } | { accepted: false, code: string }}
 */
export function admit(state) {
  pruneExpiredLock(state, Date.now());
  if (state.stopping) return { accepted: false, code: 'dshd/host-stopping' };
  if (lockLive(state, Date.now())) return { accepted: false, code: LOCKED_CODE };
  let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  state.pending.add(pending);
  let closed = false;
  return {
    accepted: true,
    done() {
      if (closed) return;
      closed = true;
      state.pending.delete(pending);
      settle();
    },
  };
}

async function waitForDrain(state, timeoutMs) {
  const pending = [...state.pending];
  if (pending.length === 0) return { drained: true, count: 0 };
  const settled = Promise.allSettled(pending);
  if (!(timeoutMs > 0)) {
    await settled;
    return { drained: true, count: pending.length };
  }
  const timeout = new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), timeoutMs);
    if (typeof t.unref === 'function') t.unref();
  });
  const winner = await Promise.race([settled.then(() => 'drained'), timeout]);
  return { drained: winner === 'drained', count: pending.length };
}

/**
 * Take the admission lock: refuse new work, drain previously admitted work,
 * and verify the lock was not superseded during the drain.
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ owner: string, kind?: string, ttlMs?: number, drainTimeoutMs?: number }} request
 */
export async function acquireLock(state, request) {
  const now = Date.now();
  pruneExpiredLock(state, now);
  if (state.stopping) return { ok: false, code: 'dshd/host-stopping' };
  const owner = String(request.owner || '').trim();
  if (!owner) return { ok: false, code: 'dshd/bad-owner' };
  const ttlMs = Number.isFinite(request.ttlMs) && request.ttlMs > 0 ? request.ttlMs : 60000;
  if (lockLive(state, now)) {
    if (state.lock.owner === owner) {
      // Same-owner re-acquire renews and re-drains; the lock identity is stable
      // so a held lockId remains valid.
      state.lock.expiresAt = now + ttlMs;
    } else {
      return { ok: false, code: 'dshd/lock-held', owner: state.lock.owner };
    }
  } else {
    state.lock = {
      lockId: randomUUID(),
      owner,
      kind: String(request.kind || 'generic'),
      generation: ++state.lockEpoch,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
  }
  const generation = state.lock.generation;
  const drain = await waitForDrain(state, Number(request.drainTimeoutMs) || 30000);
  if (state.stopping) {
    releaseLock(state, { lockId: state.lock.lockId, owner });
    return { ok: false, code: 'dshd/host-stopping' };
  }
  // Expiry is lazy — prune BEFORE the generation check so a lock whose TTL
  // lapsed mid-drain reads as superseded rather than committing stale.
  pruneExpiredLock(state, Date.now());
  if (state.lock === null || state.lock.generation !== generation) {
    return { ok: false, code: 'dshd/lock-superseded' };
  }
  if (!drain.drained) {
    releaseLock(state, { lockId: state.lock.lockId, owner });
    return { ok: false, code: 'dshd/drain-timeout', pendingCount: drain.count };
  }
  return {
    ok: true,
    lockId: state.lock.lockId,
    owner,
    generation,
    hostGeneration: state.hostGeneration,
    expiresAt: state.lock.expiresAt,
    drainedPending: drain.count,
  };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ lockId: string, owner: string }} request
 */
export function releaseLock(state, request) {
  if (state.lock === null) return { ok: true, released: false };
  if (state.lock.lockId !== request.lockId || state.lock.owner !== request.owner) {
    return { ok: false, code: 'dshd/lock-mismatch' };
  }
  state.lock = null;
  state.lockEpoch += 1;
  return { ok: true, released: true };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ lockId: string, owner: string, ttlMs?: number }} request
 */
export function renewLock(state, request) {
  if (state.lock === null) return { ok: false, code: 'dshd/no-lock' };
  if (state.lock.lockId !== request.lockId || state.lock.owner !== request.owner) {
    return { ok: false, code: 'dshd/lock-mismatch' };
  }
  const ttlMs = Number.isFinite(request.ttlMs) && request.ttlMs > 0 ? request.ttlMs : 60000;
  state.lock.expiresAt = Date.now() + ttlMs;
  return { ok: true, expiresAt: state.lock.expiresAt };
}

/** Lock + pending snapshot for the `status` op. */
export function lockStatus(state) {
  const now = Date.now();
  pruneExpiredLock(state, now);
  return {
    locked: state.lock !== null,
    lock: state.lock === null ? null : { ...state.lock },
    pendingCount: state.pending.size,
    lockEpoch: state.lockEpoch,
    hostGeneration: state.hostGeneration,
    stopping: state.stopping,
  };
}
