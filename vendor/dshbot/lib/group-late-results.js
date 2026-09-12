import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { botDisplayName } from './bot-identity.js';
import {
  GROUP_MAX_MESSAGES_PER_TURN,
  memberVisibleText,
} from './catalog.js';
import {
  groupMemberProfileForSession,
  inspectGroupMemberSession,
} from './group-member-runtime.js';
import { declaredGroupThreadIdForUserEvent } from './group-chat.js';

export const GROUP_LATE_RESULT_SOURCE_KEY = 'dshbotGroupLateResult';

const harvestLocks = new Map();

function stringId(value) {
  return String(value ?? '').trim();
}

function serviceFor(ownerCtx, name) {
  try {
    const provided = ownerCtx?.get?.(name);
    if (provided !== undefined) return provided;
  } catch {
    // Cordis rejects services outside the current injection set.
  }
  try { return ownerCtx?.[name]; } catch { return undefined; }
}

function eventData(event) {
  return event?.data && typeof event.data === 'object' ? event.data : {};
}

function contentText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    if (block?.type === 'tool-result') return contentText(block.content);
    return '';
  }).join('');
}

function resultCallId(event) {
  const data = eventData(event);
  return stringId(
    data.message?.source?.callId
      ?? data.message?.source?.toolCallId
      ?? data.message?.toolCallId
      ?? data.toolCallId
      ?? data.callId,
  );
}

function resultFailed(event) {
  const data = eventData(event);
  if (data.error) return true;
  const content = data.message?.content ?? data.content;
  return (Array.isArray(content) ? content : []).some((block) => (
    block?.isError === true
      || (block?.type === 'tool-result' && block.isError === true)
  ));
}

function normalizedGroupProtocol(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['normal', 'continuation'].includes(value.phase)
    || !Number.isInteger(value.round) || value.round < 0
    || !Array.isArray(value.responders)
    || value.responders.some((entry) => typeof entry !== 'string')
    || (value.continuation !== undefined
      && (!Number.isInteger(value.continuation) || value.continuation < 0))
    || (value.targets !== undefined
      && (!Array.isArray(value.targets) || value.targets.some((entry) => typeof entry !== 'string')))) {
    return null;
  }
  return {
    phase: value.phase,
    round: value.round,
    responders: [...value.responders],
    ...(value.continuation === undefined ? {} : { continuation: value.continuation }),
    ...(value.targets === undefined ? {} : { targets: [...value.targets] }),
  };
}

function normalizedDispatchIdentity(value) {
  if (!value || typeof value !== 'object') return undefined;
  const roomSessionId = stringId(value.roomSessionId);
  const threadId = stringId(value.threadId ?? value.owningThreadId);
  const memberSessionId = stringId(value.memberSessionId);
  const requestId = stringId(value.requestId);
  const toolCallId = stringId(value.toolCallId ?? value.callId);
  if (!roomSessionId || !threadId || !memberSessionId || !requestId || !toolCallId) return undefined;
  const groupProtocol = normalizedGroupProtocol(value.groupProtocol);
  if (groupProtocol === null) return undefined;
  return {
    version: 1,
    roomSessionId,
    threadId,
    owningThreadId: threadId,
    memberSessionId,
    requestId,
    toolCallId,
    callId: toolCallId,
    turn: Number(value.turn ?? 0),
    step: Number(value.step ?? 0),
    epoch: Number(value.epoch ?? 0),
    ...(groupProtocol ? { groupProtocol } : {}),
    ...(Number(value.timeoutAt) > 0 ? { timeoutAt: Number(value.timeoutAt) } : {}),
  };
}

function dispatchIdentityFromEvent(event) {
  if (event?.type !== 'user/message') return undefined;
  return normalizedDispatchIdentity(eventData(event).source?.dshbotGroupTurn);
}

export function groupLateResultCarrierId(identity) {
  const value = normalizedDispatchIdentity(identity);
  if (!value) return '';
  const digest = createHash('sha256').update(JSON.stringify([
    value.roomSessionId,
    value.threadId,
    value.memberSessionId,
    value.requestId,
    value.turn,
    value.step,
    value.toolCallId,
    value.epoch,
    value.groupProtocol ?? null,
  ])).digest('hex').slice(0, 40);
  return `dshbot-group-late-v1-${digest}`;
}

function completedDispatches(events) {
  const dispatches = [];
  let openTurn = 0;
  for (let index = 0; index < (events?.length ?? 0); index += 1) {
    const event = events[index];
    if (event?.type === 'turn/start') {
      openTurn = Number(eventData(event).turn ?? 0);
      continue;
    }
    if (event?.type === 'turn/end'
      && Number(eventData(event).turn ?? 0) === openTurn) openTurn = 0;
    const identity = dispatchIdentityFromEvent(event);
    if (identity) dispatches.push({ identity, memberTurn: openTurn, startIndex: index });
  }
  for (let index = 0; index < dispatches.length; index += 1) {
    const dispatch = dispatches[index];
    if (dispatch.memberTurn > 0) continue;
    const boundary = dispatches[index + 1]?.startIndex ?? events.length;
    const start = events.slice(dispatch.startIndex + 1, boundary)
      .find((event) => event?.type === 'turn/start');
    dispatch.memberTurn = Number(eventData(start).turn ?? 0);
  }
  return dispatches;
}

function lateDispatchCandidate(events, sessionId) {
  const list = Array.isArray(events) ? events : [];
  const dispatches = completedDispatches(list);
  for (let dispatchIndex = dispatches.length - 1; dispatchIndex >= 0; dispatchIndex -= 1) {
    const dispatch = dispatches[dispatchIndex];
    if (dispatch.identity.memberSessionId !== sessionId) {
      return { kind: 'blocked', reason: 'member-session-mismatch', identity: dispatch.identity };
    }
    const endIndex = list.findIndex((event, index) => (
      index > dispatch.startIndex
        && event?.type === 'turn/end'
        && Number(eventData(event).turn ?? 0) === dispatch.memberTurn
    ));
    if (endIndex < 0) continue;
    const end = list[endIndex];
    const reason = eventData(end).reason;
    const cancellationKind = reason?.kind === 'aborted' ? stringId(reason.reason?.kind) : '';
    const afterDeadline = Number(dispatch.identity.timeoutAt) > 0
      && Number(end.time ?? 0) >= Number(dispatch.identity.timeoutAt);
    if (reason?.kind === 'error' || reason?.kind === 'interrupted') {
      return { kind: 'blocked', reason: 'member-turn-failed', identity: dispatch.identity };
    }
    if (reason?.kind === 'aborted' && cancellationKind !== 'timeout') {
      return { kind: 'blocked', reason: 'member-turn-aborted', identity: dispatch.identity };
    }
    const timedOut = reason?.kind === 'aborted' && cancellationKind === 'timeout';
    const completedAfterDeadline = reason?.kind === 'completed' && afterDeadline;
    if (!timedOut && !completedAfterDeadline) continue;

    const calls = new Map();
    const deliveries = [];
    for (const event of list.slice(dispatch.startIndex + 1, endIndex)) {
      if (event?.type === 'tool/call') {
        const data = eventData(event);
        const callId = stringId(data.callId ?? data.toolCallId ?? data.id);
        if (callId) calls.set(callId, stringId(data.name));
        continue;
      }
      if (event?.type !== 'tool/result') continue;
      const callId = resultCallId(event);
      const name = calls.get(callId);
      if (!callId || !name) continue;
      calls.delete(callId);
      if (name !== 'send_room_message' || resultFailed(event)) continue;
      const raw = contentText(eventData(event).message?.content ?? eventData(event).content);
      let body = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.content === 'string') body = parsed.content;
      } catch {
        // Plain text tool results are already the delivery body.
      }
      const visible = memberVisibleText(body);
      if (visible && deliveries.length < GROUP_MAX_MESSAGES_PER_TURN) deliveries.push(visible);
    }
    if (calls.size > 0) {
      return { kind: 'blocked', reason: 'unknown-external-outcome', identity: dispatch.identity };
    }
    if (deliveries.length === 0) return { kind: 'empty', identity: dispatch.identity };
    return {
      kind: 'ready',
      identity: dispatch.identity,
      memberTurn: dispatch.memberTurn,
      texts: deliveries,
    };
  }
  return { kind: 'none' };
}

function parentCallSettlement(events, toolCallId) {
  const list = Array.isArray(events) ? events : [];
  const callIndex = list.findIndex((event) => (
    event?.type === 'tool/call'
      && eventData(event).name === 'ask_participant'
      && stringId(eventData(event).callId ?? eventData(event).toolCallId) === toolCallId
  ));
  if (callIndex < 0) return 'missing-call';
  const result = list.slice(callIndex + 1).find((event) => (
    event?.type === 'tool/result' && resultCallId(event) === toolCallId
  ));
  if (!result) return 'pending';
  return resultFailed(result) ? 'failed' : 'settled';
}

function explicitParentThreadId(event) {
  if (event?.type !== 'user/message') return '';
  const data = eventData(event);
  const source = data.source ?? data.message?.source;
  const declared = declaredGroupThreadIdForUserEvent(event);
  if (declared) return declared;
  for (const candidate of [source?.threadId, source?.thread, source?.owningThreadId]) {
    const threadId = stringId(candidate);
    if (threadId) return threadId;
  }
  return '';
}

function newerParentInputInThread(events, toolCallId, threadId) {
  const list = Array.isArray(events) ? events : [];
  const callIndex = list.findIndex((event) => (
    event?.type === 'tool/call'
      && eventData(event).name === 'ask_participant'
      && stringId(eventData(event).callId ?? eventData(event).toolCallId) === toolCallId
  ));
  if (callIndex < 0) return false;
  return list.slice(callIndex + 1).some((event) => {
    if (event?.type !== 'user/message') return false;
    const source = eventData(event).source ?? eventData(event).message?.source;
    const admitted = !source || source.kind === 'user'
      || (source.kind === 'plugin' && source.plugin === 'dshbot' && source.form === 'relay');
    return admitted && explicitParentThreadId(event) === threadId;
  });
}

function sourceCarrierId(message) {
  return stringId(message?.source?.[GROUP_LATE_RESULT_SOURCE_KEY]?.carrierId);
}

function parentHasCarrier(events, carrierId) {
  for (const event of events ?? []) {
    if (event?.type === 'user/message' && sourceCarrierId(eventData(event)) === carrierId) return true;
    if (event?.type !== 'agent/inbox/spliced') continue;
    for (const message of eventData(event).inserted ?? []) {
      if (sourceCarrierId(message) === carrierId) return true;
    }
  }
  return false;
}

function lateResultMessage(candidate, bot) {
  const name = botDisplayName(bot, bot?.id ?? 'Bot');
  const carrierId = groupLateResultCarrierId(candidate.identity);
  const payload = {
    carrierId,
    roomSessionId: candidate.identity.roomSessionId,
    threadId: candidate.identity.threadId,
    owningThreadId: candidate.identity.threadId,
    memberSessionId: candidate.identity.memberSessionId,
    requestId: candidate.identity.requestId,
    toolCallId: candidate.identity.toolCallId,
    turn: candidate.identity.turn,
    step: candidate.identity.step,
    memberTurn: candidate.memberTurn,
    epoch: candidate.identity.epoch,
    ...(candidate.identity.groupProtocol
      ? { groupProtocol: candidate.identity.groupProtocol }
      : {}),
    botId: stringId(bot?.id),
    name,
    status: 'late',
    texts: candidate.texts,
  };
  return createUserMessage({
    content: [{ type: 'text', text: candidate.texts.join('\n\n') }],
    source: {
      kind: 'plugin',
      plugin: 'dshbot',
      form: 'notice',
      summary: `Late group result from ${name}`.slice(0, 120),
      [GROUP_LATE_RESULT_SOURCE_KEY]: payload,
    },
  });
}

async function flushParent(ownerCtx, parent) {
  const sessions = serviceFor(ownerCtx, 'sessions');
  if (typeof sessions?.flush !== 'function') {
    throw new Error('Group late-result recovery requires the public Sessions flush API.');
  }
  await sessions.flush(parent.session);
}

async function harvestMemberLateResult({ ownerCtx, room, bot }) {
  const roomSessionId = stringId(room?.sessionId);
  if (!roomSessionId || !bot?.id) return { status: 'invalid' };
  const inspection = await inspectGroupMemberSession({ ownerCtx, roomSessionId, botId: bot.id });
  if (!inspection) return { status: 'missing-member-session' };
  const candidate = lateDispatchCandidate(inspection.events, inspection.sessionId);
  if (candidate.kind !== 'ready') {
    return { status: candidate.kind, ...(candidate.reason ? { reason: candidate.reason } : {}) };
  }
  const parent = ownerCtx?.agents?.get?.(roomSessionId);
  if (!parent?.session || typeof parent.inject !== 'function') return { status: 'parent-unavailable' };
  const parentEvents = parent.session.snapshotEvents?.() ?? [];
  const settlement = parentCallSettlement(parentEvents, candidate.identity.toolCallId);
  if (settlement !== 'failed') return { status: settlement };
  if (newerParentInputInThread(
    parentEvents,
    candidate.identity.toolCallId,
    candidate.identity.threadId,
  )) return { status: 'superseded' };
  const message = lateResultMessage(candidate, bot);
  const carrierId = sourceCarrierId(message);
  if (parentHasCarrier(parentEvents, carrierId)) {
    await flushParent(ownerCtx, parent);
    return { status: 'already-carried', carrierId };
  }
  parent.inject(message);
  await flushParent(ownerCtx, parent);
  return { status: 'carried', carrierId, message };
}

async function withHarvestLock(key, operation) {
  const prior = harvestLocks.get(key);
  if (prior) return prior;
  const current = Promise.resolve().then(operation);
  harvestLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (harvestLocks.get(key) === current) harvestLocks.delete(key);
  }
}

function catalogRows(value) {
  const rows = typeof value === 'function' ? value() : value;
  const items = Array.isArray(rows) ? rows : rows?.items;
  return Array.isArray(items) ? items : [];
}

/** Read persisted member logs and inject at most one late carrier per member. */
export async function reconcileGroupLateResults({ ownerCtx, items, roomSessionId = '', botId = '' }) {
  const rows = catalogRows(items);
  const bots = new Map(rows.filter((item) => item?.kind !== 'room' && item?.id)
    .map((item) => [String(item.id), item]));
  const results = [];
  for (const room of rows.filter((item) => item?.kind === 'room')) {
    if (roomSessionId && room.sessionId !== roomSessionId) continue;
    for (const memberId of room.memberBotIds ?? []) {
      if (botId && String(memberId) !== String(botId)) continue;
      const bot = bots.get(String(memberId));
      if (!bot) continue;
      const key = `${String(room.sessionId)}\0${String(bot.id)}`;
      const result = await withHarvestLock(key, () => harvestMemberLateResult({ ownerCtx, room, bot }));
      results.push({ roomSessionId: room.sessionId, botId: bot.id, ...result });
    }
  }
  return results;
}

/**
 * Install live retry boundaries and expose an explicit startup reconciliation.
 * Registration itself performs no Session activation or asynchronous scan.
 */
export function registerGroupLateResultRecovery({ ownerCtx, items, logger = () => {} }) {
  let disposed = false;
  const pending = new Set();
  const run = (filter = {}) => reconcileGroupLateResults({ ownerCtx, items, ...filter });
  const schedule = (filter) => {
    if (disposed) return;
    const task = run(filter).catch((error) => logger('Group late-result recovery failed.', error));
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const root = ownerCtx?.root ?? ownerCtx;
  const disposeSession = root?.on?.('session/event', (session, event) => {
    if (event?.type === 'turn/end') {
      const profile = groupMemberProfileForSession(session?.id ?? session?.header?.id);
      if (profile) schedule(profile);
      return;
    }
    if (event?.type === 'tool/result') {
      const room = catalogRows(items).find((item) => item?.kind === 'room' && item.sessionId === session?.id);
      if (room) schedule({ roomSessionId: room.sessionId });
    }
  }) ?? (() => {});
  const disposeAgent = root?.on?.('agent/created', ({ agent } = {}) => {
    const room = catalogRows(items).find((item) => item?.kind === 'room' && item.sessionId === agent?.session?.id);
    if (room) schedule({ roomSessionId: room.sessionId });
  }) ?? (() => {});
  return {
    reconcile: () => run(),
    async dispose() {
      disposed = true;
      disposeSession();
      disposeAgent();
      await Promise.allSettled([...pending]);
    },
  };
}
