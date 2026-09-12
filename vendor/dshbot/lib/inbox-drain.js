/**
 * A2A inbox drain state machine, dependency-free so it is directly testable.
 *
 * Delivery contract is at-least-once: the systemPrompt assemble PEEKS the
 * inbox into a wake prompt and snapshots the batch in the process-local
 * `pendingDrain` map; the catalog is only mutated by an explicit ack after
 * the turn that consumed the peek. A crash or restart between peek and ack
 * loses only the in-memory snapshot — the durable inbox is untouched, so the
 * next assemble redelivers the same messages instead of dropping them.
 */
import {
  agentRelaySource,
  buildAgentInboundWakePrompt,
  prioritizeAgentInbound,
} from './agent-messaging.js';
import { wakeAgent } from './agent-resolution.js';
import { appendTaskDeliveredAudit, markTaskDelivered } from './tasks.js';
import { projectCatalog } from './catalog-scope.js';
import { routineRunFor, ROUTINE_RUN_STATUS, updateRoutineRun } from './routine-runs.js';

/**
 * Pending drain snapshot keyed by bot id (acked after successful wake or explicit drain).
 * @type {WeakMap<object, Map<string, object[]>>}
 */
let pendingDrain = new WeakMap();
let assembledDrain = new WeakMap();
let restoreAttempts = new WeakMap();
let admittedDrain = new WeakMap();
let ownedAdmission = new WeakMap();
let admittedOwned = new WeakMap();
let reservedAdmission = new WeakMap();
let ownedSnapshots = new WeakMap();
let ownedTurns = new WeakMap();
let activeTurns = new WeakMap();

function pendingFor(scope) {
  let pending = pendingDrain.get(scope);
  if (!pending) pendingDrain.set(scope, pending = new Map());
  return pending;
}

function assembledFor(scope) {
  let assembled = assembledDrain.get(scope);
  if (!assembled) assembledDrain.set(scope, assembled = new Map());
  return assembled;
}

function restoreFor(scope) {
  let attempts = restoreAttempts.get(scope);
  if (!attempts) restoreAttempts.set(scope, attempts = new Set());
  return attempts;
}

function admittedFor(scope) {
  let admitted = admittedDrain.get(scope);
  if (!admitted) admittedDrain.set(scope, admitted = new Map());
  return admitted;
}

function ownedFor(scope) {
  let owned = ownedAdmission.get(scope);
  if (!owned) ownedAdmission.set(scope, owned = new Map());
  return owned;
}

function admittedOwnedFor(scope) {
  let owned = admittedOwned.get(scope);
  if (!owned) admittedOwned.set(scope, owned = new Map());
  return owned;
}

function reservedFor(scope) {
  let reserved = reservedAdmission.get(scope);
  if (!reserved) reservedAdmission.set(scope, reserved = new Map());
  return reserved;
}

function snapshotsFor(scope) {
  let snapshots = ownedSnapshots.get(scope);
  if (!snapshots) ownedSnapshots.set(scope, snapshots = new Map());
  return snapshots;
}

function turnsFor(scope, botId) {
  let turns = ownedTurns.get(scope);
  if (!turns) ownedTurns.set(scope, turns = new Map());
  let botTurns = turns.get(botId);
  if (!botTurns) turns.set(botId, botTurns = new Map());
  return botTurns;
}

function activeFor(scope) {
  let active = activeTurns.get(scope);
  if (!active) activeTurns.set(scope, active = new Map());
  return active;
}

const inboxMessageKey = (msg) => JSON.stringify([msg.timestampMs, msg.fromId, msg.text, msg.kind ?? 'message', msg.taskId ?? '', msg.routineId ?? '', msg.runId ?? '', msg.priority === true]);

function isRelayMessage(message) {
  const source = message?.source;
  if (source?.kind === 'plugin') {
    return source.plugin === 'dshbot' && source.form === 'relay';
  }
  return source?.kind === 'agent-message'
    && source.form === 'relay'
    && typeof source.senderSessionId === 'string'
    && source.senderSessionId.length > 0;
}

function isExactRelayMessage(message) {
  return message?.source?.kind === 'agent-message'
    && message.source.form === 'relay'
    && typeof message.source.senderSessionId === 'string'
    && message.source.senderSessionId.length > 0;
}

function isTaskOrRoutineMail(message) {
  return message?.kind === 'task' || message?.kind === 'routine';
}

function isDeliverableMail(catalog, mail) {
  if (mail.kind === 'routine') return (catalog.routines ?? []).some((routine) => (
    routine.id === mail.routineId
    && routine.pendingRunId === mail.runId
    && ['queued', 'running'].includes(routine.lastOutcome)
  ));
  if (mail.kind !== 'task') return true;
  const task = (catalog.tasks ?? []).find((entry) => entry.id === mail.taskId);
  return Boolean(task && ['queued', 'delivered'].includes(task.status));
}

function messageCounts(messages) {
  const counts = new Map();
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function rememberPending(scope, botId, batch) {
  const prior = pendingFor(scope).get(botId) ?? [];
  const current = Array.isArray(batch) ? [...batch] : [];
  const currentCounts = messageCounts(current);
  const retained = [];
  for (const message of prior) {
    if (!isInboxMessageOwned(scope, botId, message)) continue;
    const key = inboxMessageKey(message);
    const count = currentCounts.get(key) ?? 0;
    if (count > 0) currentCounts.set(key, count - 1);
    else retained.push(message);
  }
  const merged = [...current, ...retained];
  if (merged.length) pendingFor(scope).set(botId, merged);
  else pendingFor(scope).delete(botId);
}

function adjustCounts(bucket, botId, messages, delta) {
  const counts = bucket.get(botId) ?? new Map();
  for (const message of messages) {
    const key = inboxMessageKey(message);
    const next = (counts.get(key) ?? 0) + delta;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
  }
  if (counts.size > 0) bucket.set(botId, counts);
  else bucket.delete(botId);
}

function adjustAdmitted(scope, botId, messages, delta) {
  adjustCounts(admittedFor(scope), botId, messages, delta);
}

function adjustOwned(scope, botId, messages, delta) {
  adjustCounts(ownedFor(scope), botId, messages, delta);
}

function ensureCounts(bucket, botId, messages) {
  const required = messageCounts(messages);
  const counts = bucket.get(botId) ?? new Map();
  for (const [key, count] of required) {
    if ((counts.get(key) ?? 0) < count) counts.set(key, count);
  }
  if (counts.size > 0) bucket.set(botId, counts);
}

function removeOccurrences(messages, removed) {
  const counts = messageCounts(removed);
  return (messages ?? []).filter((message) => {
    const key = inboxMessageKey(message);
    const count = counts.get(key) ?? 0;
    if (count === 0) return true;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
    return false;
  });
}

function ensureOwned(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  ensureCounts(ownedFor(scope), botId, batch);
  const snapshots = snapshotsFor(scope);
  const current = snapshots.get(botId) ?? [];
  const required = messageCounts(batch);
  const existing = messageCounts(current);
  const next = [...current];
  for (const message of batch) {
    const key = inboxMessageKey(message);
    const have = existing.get(key) ?? 0;
    const need = required.get(key) ?? 0;
    if (have < need) {
      next.push(message);
      existing.set(key, have + 1);
    }
  }
  if (next.length > 0) snapshots.set(botId, next);
}

function selectOwned(scope, botId, messages) {
  const available = new Map(ownedFor(scope).get(botId) ?? []);
  const selected = [];
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    const count = available.get(key) ?? 0;
    if (count > 0) {
      selected.push(message);
      if (count === 1) available.delete(key);
      else available.set(key, count - 1);
    }
  }
  return selected;
}

function selectCounted(bucket, botId, messages) {
  const available = new Map(bucket.get(botId) ?? []);
  const selected = [];
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    const count = available.get(key) ?? 0;
    if (count > 0) {
      selected.push(message);
      if (count === 1) available.delete(key);
      else available.set(key, count - 1);
    }
  }
  return selected;
}

function newlyOwned(before, scope, botId, messages) {
  const after = ownedFor(scope).get(botId) ?? new Map();
  const delta = new Map();
  for (const [key, count] of after) {
    const added = count - (before.get(key) ?? 0);
    if (added > 0) delta.set(key, added);
  }
  const selected = [];
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    const count = delta.get(key) ?? 0;
    if (count > 0) {
      selected.push(message);
      if (count === 1) delta.delete(key);
      else delta.set(key, count - 1);
    }
  }
  return selected;
}

function releaseOwned(scope, botId, messages) {
  const selected = selectOwned(scope, botId, messages);
  if (selected.length === 0) return selected;
  adjustOwned(scope, botId, selected, -1);
  const snapshots = snapshotsFor(scope);
  const remaining = removeOccurrences(snapshots.get(botId), selected);
  if (remaining.length > 0) snapshots.set(botId, remaining);
  else snapshots.delete(botId);
  return selected;
}

function availableFromCatalog(catalog, botId, messages) {
  const target = (catalog?.items ?? []).find((item) => item.id === botId && item.kind !== 'room');
  const available = messageCounts(target?.inbox ?? []);
  const selected = [];
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    const count = available.get(key) ?? 0;
    if (count > 0) {
      selected.push(message);
      if (count === 1) available.delete(key);
      else available.set(key, count - 1);
    }
  }
  return selected;
}

function currentInboxMessages(scope, botId, messages, { deliverable = false } = {}) {
  const catalog = scope.get() ?? { items: [], tasks: [], routines: [] };
  const target = (catalog.items ?? []).find((item) => item.id === botId && item.kind !== 'room');
  const available = new Map();
  for (const message of target?.inbox ?? []) {
    if (deliverable && !isDeliverableMail(catalog, message)) continue;
    const key = inboxMessageKey(message);
    const rows = available.get(key) ?? [];
    rows.push(message);
    available.set(key, rows);
  }
  const selected = [];
  for (const message of messages ?? []) {
    const key = inboxMessageKey(message);
    const rows = available.get(key);
    if (!rows?.length) continue;
    selected.push(message);
    rows.shift();
    if (rows.length === 0) available.delete(key);
  }
  return selected;
}

function messagesForCounts(scope, botId, bucket, { deliverable = false } = {}) {
  const catalog = scope.get() ?? { items: [], tasks: [], routines: [] };
  const target = (catalog.items ?? []).find((item) => item.id === botId && item.kind !== 'room');
  const counts = new Map(bucket.get(botId) ?? []);
  const selected = [];
  for (const message of target?.inbox ?? []) {
    if (deliverable && !isDeliverableMail(catalog, message)) continue;
    const key = inboxMessageKey(message);
    const count = counts.get(key) ?? 0;
    if (count > 0) {
      selected.push(message);
      if (count === 1) counts.delete(key);
      else counts.set(key, count - 1);
    }
  }
  return selected;
}

function messageText(message) {
  return (message?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('');
}

function admittedForRelay(scope, botId, relayMessages) {
  const admitted = messagesForCounts(scope, botId, admittedFor(scope));
  const exact = (relayMessages ?? []).filter(isExactRelayMessage);
  if (exact.length === 0) return admitted;
  const catalog = scope.get() ?? { items: [] };
  const senderSessions = new Set(exact.map((message) => message.source.senderSessionId));
  const sourceMatches = admitted.filter((mail) => {
    const sender = (catalog.items ?? []).find((item) => item.id === mail.fromId && item.kind !== 'room');
    return senderSessions.has(sender?.sessionId);
  });
  const relayTexts = exact.map(messageText).filter(Boolean);
  if (relayTexts.length === 0) return sourceMatches;
  const contentMatches = sourceMatches.filter((mail) => (
    relayTexts.includes(buildAgentInboundWakePrompt(mail))
  ));
  return contentMatches.length > 0 ? contentMatches : sourceMatches;
}

function ownedSnapshot(scope, botId) {
  return currentInboxMessages(scope, botId, snapshotsFor(scope).get(botId) ?? []);
}

function isAdmitted(scope, botId, message) {
  return (admittedFor(scope).get(botId)?.get(inboxMessageKey(message)) ?? 0) > 0;
}

function isReserved(scope, botId, message) {
  return (reservedFor(scope).get(botId)?.get(inboxMessageKey(message)) ?? 0) > 0;
}

function removePending(scope, botId, messages) {
  const pending = pendingFor(scope);
  const batch = pending.get(botId);
  if (!batch?.length) return;
  const counts = new Map();
  for (const message of messages) {
    const key = inboxMessageKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const remaining = batch.filter((message) => {
    const key = inboxMessageKey(message);
    const count = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1);
    return false;
  });
  if (remaining.length > 0) pending.set(botId, remaining);
  else pending.delete(botId);
}

/**
 * Mark durable mail whose content is carried by an already accepted Harness
 * user message. It remains pending for acknowledgement, but is omitted from
 * the same turn's system-prompt inbox projection.
 * @param {{ get: () => any }} scope
 * @param {string} botId
 * @param {readonly object[]} messages
 */
export function markInboxMessageAdmitted(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  if (batch.length === 0) return;
  ensureCounts(admittedFor(scope), botId, batch);
  if (!assembledFor(scope).has(botId)) rememberPending(scope, botId, batch);
  if (activeFor(scope).has(botId)) ensureCounts(reservedFor(scope), botId, batch);
  else {
    const before = new Map(ownedFor(scope).get(botId) ?? []);
    ensureOwned(scope, botId, batch);
    ensureCounts(admittedOwnedFor(scope), botId, newlyOwned(before, scope, botId, batch));
  }
}

/**
 * Undo admission bookkeeping after a wake was rejected. The durable mail is
 * intentionally left untouched for a later wake.
 * @param {{ get: () => any }} scope
 * @param {string} botId
 * @param {readonly object[]} messages
 */
export function unmarkInboxMessageAdmitted(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  adjustAdmitted(scope, botId, batch, -1);
  adjustCounts(reservedFor(scope), botId, batch, -1);
  const admittedOwnedBatch = selectCounted(admittedOwnedFor(scope), botId, batch);
  if (admittedOwnedBatch.length > 0) {
    adjustCounts(admittedOwnedFor(scope), botId, admittedOwnedBatch, -1);
    releaseOwned(scope, botId, admittedOwnedBatch);
    const turns = turnsFor(scope, botId);
    for (const [key, owned] of turns) {
      const remaining = removeOccurrences(owned, admittedOwnedBatch);
      if (remaining.length > 0) turns.set(key, remaining);
      else turns.delete(key);
    }
  }
}

/** Keep a durable snapshot reserved while a generic relay wake is pending. */
export function reserveInboxMessages(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  if (batch.length === 0) return;
  if (!assembledFor(scope).has(botId)) rememberPending(scope, botId, batch);
  ensureCounts(reservedFor(scope), botId, batch);
}

/**
 * Claim the exact durable messages for one accepted relay turn. Repeating the
 * same turn claim is idempotent and never adds a second ownership count.
 */
export function claimInboxMessages(scope, botId, messages, { sessionId = '', turn } = {}) {
  const batch = Array.isArray(messages) ? messages : [];
  const key = turn === undefined ? '' : `${String(sessionId)}\0${String(turn)}`;
  const turns = turnsFor(scope, botId);
  if (key && turns.has(key)) return turns.get(key);
  const selected = currentInboxMessages(scope, botId, batch);
  if (selected.length === 0) return [];
  ensureOwned(scope, botId, selected);
  adjustCounts(reservedFor(scope), botId, selected, -1);
  if (key) turns.set(key, selected);
  if (!assembledFor(scope).has(botId)) rememberPending(scope, botId, selected);
  return selected;
}

/** Promote a reserved snapshot after followup accepted, without hiding it. */
export function commitInboxMessages(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  const selected = currentInboxMessages(scope, botId, batch);
  if (selected.length === 0) return [];
  const active = activeFor(scope).get(botId);
  if (!active) ensureOwned(scope, botId, selected);
  const owned = selected.filter((message) => isInboxMessageOwned(scope, botId, message));
  if (owned.length > 0) adjustCounts(reservedFor(scope), botId, owned, -1);
  return owned;
}

/** Release a rejected wake reservation while retaining its durable mail. */
export function releaseInboxMessages(scope, botId, messages) {
  adjustCounts(reservedFor(scope), botId, Array.isArray(messages) ? messages : [], -1);
}

export function isInboxMessageOwned(scope, botId, message) {
  return (ownedFor(scope).get(botId)?.get(inboxMessageKey(message)) ?? 0) > 0;
}

export function inboxMessagesOwned(scope, botId, messages) {
  const required = messageCounts(messages);
  const owned = ownedFor(scope).get(botId) ?? new Map();
  for (const [key, count] of required) {
    if ((owned.get(key) ?? 0) < count) return false;
  }
  return true;
}

export function inboxMessagesPresent(scope, botId, messages) {
  const batch = Array.isArray(messages) ? messages : [];
  return currentInboxMessages(scope, botId, batch).length === batch.length;
}

function relayWakeBatch(catalog, target) {
  const batch = (target.inbox ?? []).filter((mail) => isDeliverableMail(catalog, mail));
  if (batch.length === 0 || batch.some((mail) => mail.kind && mail.kind !== 'message')) {
    return { messages: [], source: undefined };
  }
  const senderSessionIds = new Set();
  for (const mail of batch) {
    const sender = (catalog.items ?? []).find((item) => item.id === mail.fromId && item.kind !== 'room');
    const source = agentRelaySource(sender?.sessionId);
    if (!source) return { messages: [], source: undefined };
    senderSessionIds.add(source.senderSessionId);
  }
  if (senderSessionIds.size !== 1) return { messages: [], source: undefined };
  return {
    messages: batch,
    source: agentRelaySource([...senderSessionIds][0]),
  };
}

/**
 * Reset drain snapshots (tests).
 */
export function resetPendingDrainForTests() {
  pendingDrain = new WeakMap();
  assembledDrain = new WeakMap();
  restoreAttempts = new WeakMap();
  admittedDrain = new WeakMap();
  ownedAdmission = new WeakMap();
  admittedOwned = new WeakMap();
  reservedAdmission = new WeakMap();
  ownedSnapshots = new WeakMap();
  ownedTurns = new WeakMap();
  activeTurns = new WeakMap();
}

/**
 * Wake each catalog bot with actionable durable mail once per runtime. A
 * failed cold resolve is deliberately remembered for this restore pass only;
 * the mail stays queued for a later explicit wake and is never retried here.
 */
export async function restorePendingInbox(ctx, scope) {
  const attempts = restoreFor(scope);
  const catalog = scope.get() ?? { items: [], tasks: [], routines: [] };
  const results = [];
  for (const target of catalog.items ?? []) {
    if (target.kind === 'room' || attempts.has(target.id)) continue;
    if (!(target.inbox ?? []).some((mail) => isDeliverableMail(catalog, mail))) continue;
    attempts.add(target.id);
    const relay = relayWakeBatch(catalog, target);
    const snapshot = relay.messages.length > 0
      ? relay.messages
      : prioritizeAgentInbound((target.inbox ?? []).filter((mail) => isDeliverableMail(catalog, mail)));
    const relayPrompt = relay.messages.map((message) => buildAgentInboundWakePrompt(message)).join('\n\n');
    if (relay.messages.length > 0) markInboxMessageAdmitted(scope, target.id, relay.messages);
    else reserveInboxMessages(scope, target.id, snapshot);
    const wake = await wakeAgent(
      ctx,
      target,
      relayPrompt || 'Check your current dshbot inbox for pending work. Process durable messages and tasks; ignore paused or cancelled tasks.',
      relay.source,
    );
    if (wake.ok) commitInboxMessages(scope, target.id, snapshot);
    else if (relay.messages.length > 0) unmarkInboxMessageAdmitted(scope, target.id, relay.messages);
    else releaseInboxMessages(scope, target.id, snapshot);
    results.push({ botId: target.id, ...wake });
  }
  return results;
}

/**
 * Remove exactly the given messages from a bot's durable inbox. Messages
 * that arrived after the snapshot keep their place.
 * @param {{ get: () => any, set: (next: any, previous: any) => Promise<void> }} scope
 * @param {string} botId
 * @param {readonly object[]} messages
 */
export async function ackInboxMessages(scope, botId, messages) {
  await projectCatalog(scope, (catalog) => {
    const counts = new Map();
    for (const message of messages) {
      if (message.kind === 'task') {
        const task = (catalog.tasks ?? []).find((entry) => entry.id === message.taskId);
        if (task?.status === 'paused') continue;
      }
      const key = inboxMessageKey(message);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const nextItems = (catalog.items ?? []).map((entry) => {
      if (entry.id !== botId) return entry;
      const remaining = (entry.inbox ?? []).filter((msg) => {
        const key = inboxMessageKey(msg);
        const count = counts.get(key) ?? 0;
        if (!count) return true;
        counts.set(key, count - 1);
        return false;
      });
      return { ...entry, inbox: remaining };
    });
    return { ...catalog, items: nextItems };
  });
}

/**
 * Peek inbox into a wake prompt without clearing (assemble-safe).
 * Cleared only via ackPendingInboxDrain after a successful open/wake.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ getScope: () => { get: () => any, set: (next: any, previous: any) => Promise<void> } }} deps
 */
export function registerInboxDrain(ctx, deps) {
  const scope = deps.getScope();
  const now = deps.now ?? Date.now;
  ctx.effect?.(() => {
    const timer = setImmediate(() => {
      void restorePendingInbox(ctx, scope).catch((error) => {
        ctx.logger?.warn?.('dshbot inbox restore failed: %s', String(error?.message ?? error));
      });
    });
    return () => {
      clearImmediate(timer);
      pendingDrain.delete(scope);
      assembledDrain.delete(scope);
      restoreAttempts.delete(scope);
      admittedDrain.delete(scope);
      ownedAdmission.delete(scope);
      admittedOwned.delete(scope);
      reservedAdmission.delete(scope);
      ownedSnapshots.delete(scope);
      ownedTurns.delete(scope);
      activeTurns.delete(scope);
    };
  });
  ctx.on?.('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const relay = messages === undefined || messages.some(isRelayMessage);
    const catalog = scope.get() ?? { items: [] };
    const bot = (catalog.items ?? []).find((item) => item.sessionId === agent.session.id && item.kind !== 'room');
    if (!bot || Number(step ?? 1) !== 1) return decision;
    activeFor(scope).set(bot.id, {
      sessionId: agent.session.id,
      turn,
      relay,
    });
    if (!relay) return decision;

    const admitted = admittedForRelay(scope, bot.id, messages);
    const exactWake = (messages === undefined || messages.some(isExactRelayMessage)) && admitted.length > 0;
    const reserved = messagesForCounts(scope, bot.id, reservedFor(scope));
    const owned = ownedSnapshot(scope, bot.id);
    const assembled = assembledFor(scope).get(bot.id);
    const protectedOwned = owned.some(isTaskOrRoutineMail);
    const snapshot = exactWake
      ? admitted
      : reserved.length > 0
        ? reserved
        : protectedOwned
          ? owned
          : assembled ?? prioritizeAgentInbound((bot.inbox ?? []).filter((mail) => isDeliverableMail(catalog, mail)));
    const claimed = claimInboxMessages(scope, bot.id, snapshot, {
      sessionId: agent.session.id,
      turn,
    });
    if (claimed.length === 0) return decision;
    await projectCatalog(scope, (catalog) => {
      const currentBot = (catalog.items ?? []).find((item) => item.id === bot.id && item.kind !== 'room');
      if (!currentBot) return catalog;
      let tasks = catalog.tasks ?? [];
      let routines = catalog.routines ?? [];
      let audit = catalog.audit ?? [];
      const startedAt = now();
      for (const mail of claimed) {
        if (!isInboxMessageOwned(scope, bot.id, mail)
          || availableFromCatalog(catalog, bot.id, [mail]).length === 0) continue;
        if (mail.kind === 'routine') {
          routines = routines.map((routine) => {
            if (routine.lastOutcome !== ROUTINE_RUN_STATUS.QUEUED
              || routine.pendingRunId !== mail.runId
              || routine.id !== mail.routineId) return routine;
            const run = routineRunFor(routine, mail.runId);
            const updated = updateRoutineRun(routine, mail.runId, {
              status: ROUTINE_RUN_STATUS.RUNNING,
              sessionId: agent.session.id,
              turn,
              startedAt: run?.startedAt || startedAt,
            });
            return { ...updated, lastOutcome: ROUTINE_RUN_STATUS.RUNNING,
              runSessionId: agent.session.id, runTurn: turn };
          });
        }
        if (mail.kind !== 'task') continue;
        const task = tasks.find((entry) => entry.id === mail.taskId);
        if (!task) continue;
        if (task.status === 'queued') {
          const delivered = markTaskDelivered(tasks, task.id, bot.id, now());
          if (delivered.ok) tasks = delivered.tasks;
        }
        if (task.status === 'queued' || task.status === 'delivered') {
          audit = appendTaskDeliveredAudit(audit, {
            taskId: task.id,
            fromId: task.fromId,
            toId: bot.id,
            detail: 'Task entered a recipient turn.',
          }, now());
        }
      }
      return tasks !== catalog.tasks || routines !== catalog.routines || audit !== catalog.audit
        ? { ...catalog, tasks, routines, audit }
        : catalog;
    });
    return decision;
  });
  ctx.on?.('session/event', async (session, event) => {
    if (event?.type !== 'turn/end') return;
    const catalog = scope.get() ?? { items: [] };
    const bot = (catalog.items ?? []).find((item) => (
      item.sessionId === session?.id && item.kind !== 'room'
    ));
    if (!bot) return;
    const active = activeFor(scope).get(bot.id);
    if (!active
      || active.sessionId !== session.id
      || active.turn !== event.data?.turn) return;
    if (event.data?.reason?.kind === 'completed') {
      await ackPendingInboxDrain(scope, bot.id);
      return;
    }
    // The durable inbox and ownership snapshot stay intact for a later retry.
    activeFor(scope).delete(bot.id);
  });
  ctx.systemPrompt.section({
    name: 'dshbot:inbox',
    order: 21,
    text: (assembleCtx) => {
      const sessionId = assembleCtx.agent?.session?.id ?? assembleCtx.agent?.id;
      if (!sessionId) return '';
      const scope = deps.getScope();
      const catalog = scope.get() ?? { items: [] };
      const items = catalog.items ?? [];
      const bot = items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
      if (!bot || !Array.isArray(bot.inbox) || bot.inbox.length === 0) {
        if (bot) assembledFor(scope).set(bot.id, []);
        return '';
      }
      const batch = prioritizeAgentInbound(bot.inbox.filter((mail) => isDeliverableMail(catalog, mail)));
      assembledFor(scope).set(bot.id, batch);
      rememberPending(scope, bot.id, batch);
      // Legacy normal streams may not expose pre-step metadata. Ordinary mail
      // remains acknowledgeable in that host path. A pending wake reservation
      // keeps task and routine mail out of this compatibility fallback until a
      // relay turn can establish its ownership.
      ensureOwned(scope, bot.id, batch.filter((mail) => (
        !isAdmitted(scope, bot.id, mail)
        && (!isTaskOrRoutineMail(mail) || !isReserved(scope, bot.id, mail))
      )));
      return batch
        .filter((msg) => !isAdmitted(scope, bot.id, msg))
        .map((msg) => buildAgentInboundWakePrompt(msg))
        .join('\n\n');
    },
  });
}

/**
 * Ack peeked inbox after the turn that consumed it (call from host after
 * followup or client open). Idempotent: a second call for the same bot is a
 * no-op, so a duplicate injection of the drain listener cannot double-delete.
 * @param {{ get: () => any, set: (next: any, previous: any) => Promise<void> }} scope
 * @param {string} botId
 */
export async function ackPendingInboxDrain(scope, botId) {
  const active = activeFor(scope).get(botId);
  const turnKey = active?.relay ? `${String(active.sessionId)}\0${String(active.turn)}` : '';
  const turnBatch = turnKey ? turnsFor(scope, botId).get(turnKey) : undefined;
  const pending = pendingFor(scope).get(botId) ?? [];
  const candidates = turnBatch?.length
    ? turnBatch
    : active?.relay ? [] : [...pending, ...ownedSnapshot(scope, botId)];
  const ackable = active && !active.relay
    ? candidates.filter((message) => !isTaskOrRoutineMail(message))
    : candidates;
  const batch = selectOwned(scope, botId, ackable);
  if (batch.length > 0) await ackInboxMessages(scope, botId, batch);
  if (batch.length > 0) {
    releaseOwned(scope, botId, batch);
    adjustAdmitted(scope, botId, batch, -1);
    removePending(scope, botId, batch);
    const turns = turnsFor(scope, botId);
    for (const [key, owned] of turns) {
      const remaining = removeOccurrences(owned, batch);
      if (remaining.length > 0) turns.set(key, remaining);
      else turns.delete(key);
    }
  }
  if (active) activeFor(scope).delete(botId);
}
