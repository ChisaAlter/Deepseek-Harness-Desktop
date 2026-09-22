import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { botDisplayName } from './bot-identity.js';
import { isPassContent } from './group-chat.js';

/** Tools that let a Bot address another Bot or create/manage a delegated task. */
export const GROUP_MEMBER_DENIED_TOOLS = Object.freeze([
  'send_to_agent',
  'delegate_to_agent',
  'update_task',
  'list_tasks',
  'ask_participant',
]);

const MEMBER_TURN_TIMEOUT_MS = 300_000;
const GROUP_MEMBER_SESSION_PREFIX = 'dshbot-group-member-v3-';
const LEGACY_GROUP_MEMBER_SESSION_PREFIX = 'dshbot-group-member-';

/** @type {Map<string, { roomSessionId: string, botId: string }>} */
const profiles = new Map();
/** @type {Map<string, { handle: object, roomSessionId: string, botId: string, abortController?: AbortController, stopStatus?: string, cancelCause?: object }>} */
const activeHandles = new Map();
/** @type {Map<string, object>} */
const residentHandles = new Map();
/** @type {Map<string, Promise<object>>} */
const ensureLocks = new Map();
/** @type {Map<string, object>} */
const runtimeStates = new Map();
/** @type {Map<string, string>} */
const currentPersonas = new Map();
/** @type {Map<string, () => void>} */
const recoveryWatchers = new Map();

export class GroupMemberRuntimeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ roomSessionId?: string, botId?: string, sessionId?: string, cause?: unknown, details?: object }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GroupMemberRuntimeError';
    this.code = code;
    this.roomSessionId = options.roomSessionId ?? '';
    this.botId = options.botId ?? '';
    this.sessionId = options.sessionId ?? '';
    if (options.details !== undefined) this.details = options.details;
  }
}

function stringId(value) {
  return String(value ?? '').trim();
}

function dispatchGroupProtocol(value) {
  if (!value || typeof value !== 'object') return undefined;
  const phase = value.phase === 'continuation' ? 'continuation' : 'normal';
  const round = Number(value.round);
  const continuation = Number(value.continuation);
  return {
    phase,
    round: Number.isInteger(round) && round >= 0 ? round : 0,
    responders: Array.isArray(value.responders)
      ? value.responders.map(stringId).filter(Boolean)
      : [],
    ...(Number.isInteger(continuation) && continuation >= 0 ? { continuation } : {}),
    ...(Array.isArray(value.targets)
      ? { targets: value.targets.map(stringId).filter(Boolean) }
      : {}),
  };
}

function memberDispatchIdentity(value, defaults = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const roomSessionId = stringId(source.roomSessionId ?? defaults.roomSessionId);
  const threadId = stringId(source.threadId ?? source.owningThreadId ?? defaults.threadId);
  const memberSessionId = stringId(source.memberSessionId ?? defaults.memberSessionId);
  const requestId = stringId(source.requestId ?? defaults.requestId);
  const toolCallId = stringId(source.toolCallId ?? source.callId ?? defaults.toolCallId);
  const turn = Number(source.turn ?? defaults.turn ?? 0);
  const step = Number(source.step ?? defaults.step ?? 0);
  const epoch = Number(source.epoch ?? defaults.epoch ?? 0);
  const timeoutAt = Number(source.timeoutAt ?? defaults.timeoutAt ?? 0);
  const groupProtocol = dispatchGroupProtocol(source.groupProtocol ?? defaults.groupProtocol);
  return {
    version: 1,
    roomSessionId,
    threadId,
    owningThreadId: threadId,
    memberSessionId,
    requestId,
    toolCallId,
    callId: toolCallId,
    turn: Number.isFinite(turn) ? turn : 0,
    step: Number.isFinite(step) ? step : 0,
    epoch: Number.isFinite(epoch) ? epoch : 0,
    ...(groupProtocol ? { groupProtocol } : {}),
    ...(Number.isFinite(timeoutAt) && timeoutAt > 0 ? { timeoutAt } : {}),
  };
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch { return value; }
}

/** Keep the old opaque identity readable while new identities are reversible. */
function legacyGroupMemberSessionId(roomSessionId, botId) {
  const digest = createHash('sha256')
    .update(`root-v2\0${String(roomSessionId)}\0${String(botId)}`)
    .digest('hex')
    .slice(0, 40);
  return `${LEGACY_GROUP_MEMBER_SESSION_PREFIX}${digest}`;
}

function encodeMemberIdentity(roomSessionId, botId) {
  return Buffer.from(JSON.stringify([String(roomSessionId), String(botId)]), 'utf8')
    .toString('base64url');
}

function decodeMemberIdentity(sessionId) {
  const raw = String(sessionId ?? '');
  if (!raw.startsWith(GROUP_MEMBER_SESSION_PREFIX)) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw.slice(GROUP_MEMBER_SESSION_PREFIX.length), 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const roomSessionId = stringId(value[0]);
    const botId = stringId(value[1]);
    if (!roomSessionId || !botId) return undefined;
    return { roomSessionId, botId };
  } catch {
    return undefined;
  }
}

/**
 * Derive a stable, self-describing member session identity. The encoded pair
 * lets a fresh plugin runtime recover ownership without a process registry.
 */
export function groupMemberSessionId(roomSessionId, botId) {
  return `${GROUP_MEMBER_SESSION_PREFIX}${encodeMemberIdentity(roomSessionId, botId)}`;
}

/** @param {string | undefined} sessionId */
export function groupMemberSessionIdentity(sessionId) {
  const parsed = decodeMemberIdentity(sessionId);
  if (parsed) return parsed;
  const profile = profiles.get(String(sessionId ?? ''));
  return profile ? { ...profile } : undefined;
}

export const groupMemberIdentityForSession = groupMemberSessionIdentity;

function memberPresentation(sessionId, room, bot) {
  const roomName = String(room?.name ?? 'Group');
  const botName = botDisplayName(bot, bot?.id ?? 'Bot');
  return {
    owner: `dshbot-group:${sessionId}`,
    title: `${roomName} \u00b7 ${botName}`.slice(0, 240),
    composer: 'managed',
  };
}

/**
 * Bind one stable member session to its current catalog profile. Both the
 * reversible identity and the pre-v3 hash are indexed for upgrade recovery.
 * @param {{ sessionId?: string, roomSessionId: string, botId: string }} profile
 */
export function registerGroupMemberProfile(profile) {
  const roomSessionId = stringId(profile?.roomSessionId);
  const botId = stringId(profile?.botId);
  if (!roomSessionId || !botId) return undefined;
  const value = { roomSessionId, botId };
  const sessionId = stringId(profile?.sessionId) || groupMemberSessionId(roomSessionId, botId);
  for (const alias of new Set([
    sessionId,
    groupMemberSessionId(roomSessionId, botId),
    legacyGroupMemberSessionId(roomSessionId, botId),
  ])) profiles.set(alias, value);
  return { sessionId, ...value };
}

/** Register every room/member relation in a catalog-shaped value. */
export function registerGroupMemberProfiles(value) {
  const items = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(items)) return [];
  const rooms = items.filter((item) => item?.kind === 'room');
  const bots = new Map(items
    .filter((item) => item?.kind !== 'room' && item?.id)
    .map((item) => [String(item.id), item]));
  const registered = [];
  for (const room of rooms) {
    const roomSessionId = stringId(room.sessionId);
    if (!roomSessionId) continue;
    for (const botId of Array.isArray(room.memberBotIds) ? room.memberBotIds : []) {
      if (!bots.has(String(botId))) continue;
      const profile = registerGroupMemberProfile({ roomSessionId, botId });
      if (profile) registered.push(profile);
    }
  }
  return registered;
}

/** @param {string | undefined} sessionId */
export function groupMemberProfileForSession(sessionId) {
  if (!sessionId) return undefined;
  const id = String(sessionId);
  const profile = profiles.get(id) ?? decodeMemberIdentity(id);
  return profile ? { ...profile } : undefined;
}

/** @param {string | undefined} sessionId */
export function isGroupMemberSession(sessionId) {
  return groupMemberProfileForSession(sessionId) !== undefined;
}

/** Return a detached runtime view for control-plane consumers. */
export function groupMemberRuntimeSnapshot() {
  return [...runtimeStates.values()].map((state) => cloneValue(state));
}

function stateKey(roomSessionId, botId) {
  return `${String(roomSessionId)}\0${String(botId)}`;
}

function setState(roomSessionId, botId, patch) {
  const roomId = String(roomSessionId);
  const memberId = String(botId);
  const key = stateKey(roomId, memberId);
  const prior = runtimeStates.get(key) ?? {
    roomSessionId: roomId,
    botId: memberId,
    sessionId: groupMemberSessionId(roomId, memberId),
    status: 'idle',
  };
  const next = { ...prior, ...patch, updatedAt: Date.now() };
  if (next.pending !== undefined) next.pending = cloneValue(next.pending);
  runtimeStates.set(key, next);
  return next;
}

function cancelKind(signal) {
  return signal?.reason && typeof signal.reason === 'object'
    ? String(signal.reason.kind ?? '')
    : '';
}

function isUserCancellation(signal) {
  return cancelKind(signal) === 'user';
}

function isStaleCancellation(signal) {
  return ['stale', 'epoch', 'superseded'].includes(cancelKind(signal));
}

function stoppedStatus(roomSessionId, botId) {
  const current = runtimeStates.get(stateKey(roomSessionId, botId));
  return current?.status === 'pending' || current?.pending !== undefined ? 'held' : 'stopped';
}

function clearPendingState(roomSessionId, botId, status) {
  setState(roomSessionId, botId, {
    status,
    pending: undefined,
    lastError: undefined,
  });
}

function isTerminalMemberStatus(status) {
  return ['held', 'stopped', 'stale', 'timed-out', 'failed', 'passed'].includes(String(status ?? ''));
}

function isMissingSessionError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  if (code.includes('NOT_FOUND') || code.includes('UNKNOWN_SESSION')) return true;
  return /session.+(not found|does not exist|unknown)|(?:not found|unknown).+session/i.test(
    String(error?.message ?? error),
  );
}

function serviceFor(ownerCtx, name) {
  try {
    const provided = ownerCtx?.get?.(name);
    if (provided !== undefined) return provided;
  } catch {
    // Cordis throws when a service is not in the plugin's inject list.
  }
  try {
    return ownerCtx?.[name];
  } catch {
    return undefined;
  }
}

function sessionControllerFor(ownerCtx) {
  return serviceFor(ownerCtx, 'sessionController');
}

function memberSetup({ ownerCtx, sessionId, persona }) {
  return (agentCtx) => {
    const tools = serviceFor(ownerCtx, 'tools');
    const available = GROUP_MEMBER_DENIED_TOOLS
      .filter((name) => tools?.get?.(name) !== undefined);
    if (available.length > 0) agentCtx.tools.restrict({ deny: available });
    agentCtx.systemPrompt.section({
      name: 'dshbot:group-member-persona',
      order: 19,
      text: () => currentPersonas.get(sessionId) ?? persona,
    });
  };
}

/**
 * Read the canonical Bot workspace without activating or inheriting the room
 * parent Session. A group member must never silently run from the room cwd.
 */
export async function resolveGroupMemberCwd({ ownerCtx, bot, roomSessionId, sessionId }) {
  const controller = sessionControllerFor(ownerCtx);
  let inspection;
  if (typeof controller?.inspect === 'function') {
    try {
      inspection = await controller.inspect(bot.sessionId);
    } catch (error) {
      throw new GroupMemberRuntimeError(
        'MEMBER_BOT_CWD_UNAVAILABLE',
        `Bot ${bot.name ?? bot.id} canonical Session cwd could not be inspected.`,
        { roomSessionId, botId: bot.id, sessionId, cause: error, details: { botSessionId: bot.sessionId } },
      );
    }
  } else {
    const sessions = serviceFor(ownerCtx, 'sessions');
    const attached = sessions?.get?.(bot.sessionId);
    const attachedCwd = attached?.header?.cwd;
    if (typeof attachedCwd === 'string' && attachedCwd) return attachedCwd;
    throw new GroupMemberRuntimeError(
      'MEMBER_BOT_CWD_UNAVAILABLE',
      `Bot ${bot.name ?? bot.id} canonical Session cwd is unavailable: no read-only Session inspection is mounted.`,
      { roomSessionId, botId: bot.id, sessionId, details: { botSessionId: bot.sessionId } },
    );
  }
  const cwd = inspection?.meta?.cwd ?? inspection?.header?.cwd;
  if (typeof cwd !== 'string' || !cwd) {
    throw new GroupMemberRuntimeError(
      'MEMBER_BOT_CWD_UNAVAILABLE',
      `Bot ${bot.name ?? bot.id} canonical Session has no cwd.`,
      { roomSessionId, botId: bot.id, sessionId, details: { botSessionId: bot.sessionId } },
    );
  }
  return cwd;
}

function assertSessionCwd(agent, expectedCwd, options) {
  const actualCwd = agent?.session?.header?.cwd;
  if (typeof actualCwd !== 'string' || !actualCwd) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_CWD_UNAVAILABLE',
      `Group member session ${options.sessionId} has no canonical cwd.`,
      options,
    );
  }
  if (actualCwd !== expectedCwd) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_CWD_MISMATCH',
      `Group member session ${options.sessionId} cwd does not match Bot ${options.bot.name ?? options.bot.id} workspace.`,
      { ...options, details: { expectedCwd, actualCwd } },
    );
  }
}

function assertSessionIdentity(agent, expectedSessionId, options) {
  const actualSessionId = String(agent?.session?.id ?? agent?.id ?? '');
  if (!actualSessionId) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_ID_UNAVAILABLE',
      `Group member session ${expectedSessionId} has no durable Session ID.`,
      options,
    );
  }
  if (actualSessionId !== expectedSessionId) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_ID_MISMATCH',
      `Group member resume returned Session ${actualSessionId} instead of ${expectedSessionId}.`,
      { ...options, details: { expectedSessionId, actualSessionId } },
    );
  }
}

function eventSessionId(session) {
  return String(session?.id ?? session?.header?.id ?? '');
}

function eventData(event) {
  return event?.data && typeof event.data === 'object' ? event.data : {};
}

function messageFromEvent(event) {
  const data = eventData(event);
  return event?.type === 'user/message' ? data : data.message;
}

function threadIdFromEvents(events) {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events[index];
    const data = eventData(event);
    const source = messageFromEvent(event)?.source ?? data.source;
    const threadId = source?.threadId
      ?? source?.groupThreadId
      ?? data.threadId
      ?? data.groupThreadId
      ?? data.owningThreadId;
    if (typeof threadId === 'string' && threadId.trim()) return threadId.trim();
  }
  return '';
}

function interactionFromEvent(event, sessionId, threadId, tail) {
  const data = eventData(event);
  const id = stringId(data.id ?? data.requestId);
  if (!id) return undefined;
  const turn = tail?.turn;
  const step = tail?.step;
  const toolCallId = stringId(data.callId ?? data.toolCallId) || stringId(tail?.callId);
  const base = {
    id,
    requestId: id,
    memberSessionId: sessionId,
    sessionId,
    ...(threadId ? { threadId, owningThreadId: threadId } : {}),
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
    ...(toolCallId ? { toolCallId, callId: toolCallId } : {}),
  };
  if (event.type === 'approval/asked') {
    return {
      kind: 'approval',
      ...base,
      ...(data.toolName === undefined ? {} : { toolName: String(data.toolName) }),
      ...(data.reason === undefined ? {} : { reason: String(data.reason) }),
    };
  }
  if (event.type === 'user-questions/asked') {
    return {
      kind: 'question',
      ...base,
      questions: Array.isArray(data.questions) ? cloneValue(data.questions) : [],
    };
  }
  return undefined;
}

function interactionFromQuestionRequest(request, sessionId, threadId, tail) {
  const requestId = stringId(request?.requestId);
  const callId = stringId(request?.callId);
  const stable = requestId || callId;
  if (!stable) {
    return {
      kind: 'question',
      questions: Array.isArray(request?.questions) ? cloneValue(request.questions) : [],
    };
  }
  return {
    kind: 'question',
    id: requestId || callId,
    requestId: requestId || callId,
    memberSessionId: sessionId,
    sessionId,
    ...(threadId ? { threadId, owningThreadId: threadId } : {}),
    ...(tail?.turn === undefined ? {} : { turn: tail.turn }),
    ...(tail?.step === undefined ? {} : { step: tail.step }),
    ...(callId ? { toolCallId: callId, callId } : {}),
    questions: Array.isArray(request?.questions) ? cloneValue(request.questions) : [],
  };
}

function interactionFromApprovalRequest(request, sessionId, threadId, tail) {
  const requestId = stringId(request?.requestId);
  const callId = stringId(request?.callId);
  if (!requestId && !callId) return undefined;
  return {
    kind: 'approval',
    id: requestId || callId,
    requestId: requestId || callId,
    memberSessionId: sessionId,
    sessionId,
    ...(threadId ? { threadId, owningThreadId: threadId } : {}),
    ...(tail?.turn === undefined ? {} : { turn: tail.turn }),
    ...(tail?.step === undefined ? {} : { step: tail.step }),
    ...(callId ? { toolCallId: callId, callId } : {}),
    ...(request?.toolName === undefined ? {} : { toolName: String(request.toolName) }),
    ...(request?.reason === undefined ? {} : { reason: String(request.reason) }),
  };
}

function applyInteractionState(profile, interaction, status = 'pending') {
  if (!profile || !interaction) return;
  setState(profile.roomSessionId, profile.botId, {
    status,
    ...(interaction.memberSessionId || interaction.sessionId
      ? { sessionId: interaction.memberSessionId || interaction.sessionId }
      : {}),
    pending: interaction,
  });
}

function hasUnknownExternalOutcome(events, turn) {
  return (events ?? []).some((event) => (
    event?.type === 'tool/result'
    && (turn === undefined || Number(eventData(event).turn ?? 0) === Number(turn))
    && String(eventData(event).error?.code ?? '') === 'TOOL_OUTCOME_UNKNOWN'
  ));
}

function applySessionEventState(session, event, threadId = '') {
  const sessionId = eventSessionId(session);
  const profile = groupMemberProfileForSession(sessionId);
  if (!profile) return;
  const current = runtimeStates.get(stateKey(profile.roomSessionId, profile.botId));
  const events = session?.snapshotEvents?.() ?? [];
  const tail = recoveryTail(events);
  const effectiveThreadId = threadId || current?.threadId || threadIdFromEvents(events);
  if (isTerminalMemberStatus(current?.status)) return;
  if (event?.type === 'approval/asked' || event?.type === 'user-questions/asked') {
    applyInteractionState(profile, interactionFromEvent(event, sessionId, effectiveThreadId, tail));
    return;
  }
  if (event?.type === 'approval/decided' || event?.type === 'user-questions/answered') {
    setState(profile.roomSessionId, profile.botId, {
      status: 'running',
      pending: undefined,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
    });
    return;
  }
  if (event?.type !== 'turn/end') return;
  const reason = eventData(event).reason;
  if (reason?.kind === 'completed') {
    setState(profile.roomSessionId, profile.botId, {
      status: memberTurnStatus(events, Number(eventData(event).turn ?? 0)),
      pending: undefined,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      lastError: undefined,
    });
  } else if (reason?.kind === 'error' || reason?.kind === 'interrupted') {
    const turn = Number(eventData(event).turn ?? 0);
    const unknownExternal = tail.lastEndHadUnknownExternalOutcome || hasUnknownExternalOutcome(events, turn);
    setState(profile.roomSessionId, profile.botId, {
      status: 'failed',
      pending: undefined,
      lastError: {
        code: reason.kind === 'interrupted' && unknownExternal
          ? 'MEMBER_EXTERNAL_OUTCOME_UNKNOWN'
          : reason.kind === 'interrupted' ? 'MEMBER_TURN_INTERRUPTED' : 'MEMBER_TURN_FAILED',
        message: reason.kind === 'interrupted' && unknownExternal
          ? 'An in-flight external tool outcome was not replayed.'
          : `Group member turn ended with ${reason.kind}.`,
      },
    });
  }
}

function watchSession(ownerCtx, sessionId, threadId = '') {
  const root = ownerCtx?.root;
  if (typeof root?.on !== 'function') return;
  recoveryWatchers.get(sessionId)?.();
  let dispose;
  try {
    dispose = root.on('session/event', (session, event) => {
      if (eventSessionId(session) !== sessionId) return;
      applySessionEventState(session, event, threadId);
    });
  } catch {
    dispose = undefined;
  }
  if (typeof dispose === 'function') recoveryWatchers.set(sessionId, dispose);
}

function disposeSessionWatcher(sessionId) {
  const dispose = recoveryWatchers.get(sessionId);
  recoveryWatchers.delete(sessionId);
  try { dispose?.(); } catch { /* best effort */ }
}

function pendingRecordsFromServices(ownerCtx, agent) {
  const session = agent?.session;
  if (!session) return [];
  const records = [];
  const approval = serviceFor(ownerCtx, 'approval');
  if (typeof approval?.pending === 'function') {
    try {
      for (const record of approval.pending(session) ?? []) {
        const id = stringId(record?.id);
        if (!id) continue;
        records.push({
          kind: 'approval',
          id,
          requestId: id,
          memberSessionId: String(session.id),
          sessionId: String(session.id),
          ...(record.callId === undefined ? {} : { callId: String(record.callId), toolCallId: String(record.callId) }),
          ...(record.toolName === undefined ? {} : { toolName: String(record.toolName) }),
          ...(record.reason === undefined ? {} : { reason: String(record.reason) }),
        });
      }
    } catch {
      // Event folding below remains the fail-closed fallback.
    }
  }
  const userQuestions = serviceFor(ownerCtx, 'userQuestions');
  if (typeof userQuestions?.pending === 'function') {
    try {
      for (const record of userQuestions.pending(session) ?? []) {
        const id = stringId(record?.id);
        if (!id) continue;
        records.push({
          kind: 'question',
          id,
          requestId: id,
          memberSessionId: String(session.id),
          sessionId: String(session.id),
          ...(record.callId === undefined ? {} : { callId: String(record.callId), toolCallId: String(record.callId) }),
          questions: Array.isArray(record.questions) ? cloneValue(record.questions) : [],
        });
      }
    } catch {
      // Event folding below remains the fail-closed fallback.
    }
  }
  return records;
}

function pendingRecordsFromEvents(events, sessionId) {
  const records = new Map();
  const threadId = threadIdFromEvents(events);
  const tail = recoveryTail(events);
  for (const event of events ?? []) {
    if (event?.type === 'approval/asked' || event?.type === 'user-questions/asked') {
      const interaction = interactionFromEvent(event, sessionId, threadId, tail);
      if (interaction) records.set(interaction.requestId, interaction);
      continue;
    }
    if (event?.type === 'approval/decided' || event?.type === 'user-questions/answered') {
      const data = eventData(event);
      records.delete(stringId(data.id ?? data.requestId));
    }
  }
  return [...records.values()];
}

function enrichInteraction(interaction, events) {
  if (!interaction) return undefined;
  const tail = recoveryTail(events);
  const threadId = interaction.threadId || interaction.owningThreadId || threadIdFromEvents(events);
  const result = {
    ...interaction,
    memberSessionId: interaction.memberSessionId || interaction.sessionId,
    sessionId: interaction.sessionId || interaction.memberSessionId,
    ...(threadId ? { threadId, owningThreadId: threadId } : {}),
    ...(tail.turn === undefined ? {} : { turn: interaction.turn ?? tail.turn }),
    ...(tail.step === undefined ? {} : { step: interaction.step ?? tail.step }),
    ...(interaction.toolCallId || interaction.callId || tail.pending?.callId
      ? { toolCallId: interaction.toolCallId || interaction.callId || tail.pending?.callId,
        callId: interaction.callId || interaction.toolCallId || tail.pending?.callId }
      : {}),
  };
  return result;
}

function pendingInteractionForAgent(ownerCtx, agent, requestId = '') {
  const events = agent?.session?.snapshotEvents?.() ?? [];
  const records = [
    ...pendingRecordsFromServices(ownerCtx, agent),
    ...pendingRecordsFromEvents(events, String(agent?.session?.id ?? '')),
  ].map((record) => enrichInteraction(record, events));
  const unique = new Map(records.map((record) => [`${record.kind}:${record.requestId}`, record]));
  const list = [...unique.values()];
  return requestId ? list.find((record) => record.requestId === String(requestId)) : list.at(-1);
}

function recoveryTail(events) {
  let turn;
  let step;
  let lastTurn = 0;
  const blocks = new Map();
  const calls = new Map();
  const results = new Set();
  const interactions = new Map();
  let lastEnd;
  let lastEndHadUnknownExternalOutcome = false;
  let hadUnknownExternalOutcome = false;
  for (const event of events ?? []) {
    const type = String(event?.type ?? '');
    const data = eventData(event);
    if (type === 'turn/start') {
      turn = Number(data.turn);
      lastTurn = turn;
      step = undefined;
      blocks.clear();
      calls.clear();
      results.clear();
      interactions.clear();
      hadUnknownExternalOutcome = false;
      continue;
    }
    if (type === 'turn/end') {
      lastEnd = event;
      lastEndHadUnknownExternalOutcome = hadUnknownExternalOutcome;
      turn = undefined;
      step = undefined;
      blocks.clear();
      calls.clear();
      results.clear();
      interactions.clear();
      hadUnknownExternalOutcome = false;
      continue;
    }
    if (type === 'step/start') {
      step = Number(data.step);
      blocks.clear();
      calls.clear();
      results.clear();
      interactions.clear();
      continue;
    }
    if (type === 'step/end') {
      step = undefined;
      blocks.clear();
      calls.clear();
      results.clear();
      interactions.clear();
      continue;
    }
    if (turn === undefined || step === undefined) continue;
    if (type === 'assistant/message') {
      for (const block of data.message?.content ?? []) {
        if (block?.type === 'tool-call') blocks.set(String(block.id), block);
      }
      continue;
    }
    if (type === 'tool/call') {
      const callId = stringId(data.callId ?? data.toolCallId ?? data.id);
      if (callId) calls.set(callId, event.seq);
      continue;
    }
    if (type === 'tool/result') {
      const callId = stringId(
        data.message?.source?.callId
          ?? data.message?.source?.toolCallId
          ?? data.message?.toolCallId
          ?? data.toolCallId,
      );
      if (callId) results.add(callId);
      if (String(data.error?.code ?? '') === 'TOOL_OUTCOME_UNKNOWN') {
        hadUnknownExternalOutcome = true;
      }
      continue;
    }
    if (type === 'approval/asked' || type === 'user-questions/asked') {
      const id = stringId(data.id ?? data.requestId);
      if (id) interactions.set(id, {
        kind: type === 'approval/asked' ? 'approval' : 'question',
        id,
        callId: stringId(data.callId ?? data.toolCallId),
        terminal: undefined,
        event,
      });
      continue;
    }
    if (type === 'approval/decided' || type === 'user-questions/answered') {
      const interaction = interactions.get(stringId(data.id ?? data.requestId));
      if (interaction) interaction.terminal = String(data.outcome ?? 'answered');
    }
  }
  const open = turn !== undefined;
  const unresolvedCalls = [...calls.keys()].filter((callId) => !results.has(callId));
  let pending;
  if (open && step !== undefined && unresolvedCalls.length === 1) {
    const callId = unresolvedCalls[0];
    const interaction = [...interactions.values()].find((candidate) => candidate.callId === callId);
    const block = blocks.get(callId);
    if (interaction && block && interaction.terminal !== 'allowed-once') {
      const siblingUnknown = [...blocks.keys()].some((blockId) => (
        blockId !== callId && !results.has(blockId)
      ));
      if (!siblingUnknown) {
        pending = {
          kind: 'pending',
          turn,
          step,
          callId,
          callSeq: calls.get(callId),
          interaction,
        };
      }
    }
  }
  const unknownExternal = open && unresolvedCalls.length > 0 && pending === undefined;
  return {
    open,
    turn,
    step,
    lastTurn,
    lastEnd,
    unresolvedCalls,
    pending,
    lastEndHadUnknownExternalOutcome,
    kind: !open
      ? lastEndHadUnknownExternalOutcome ? 'unknown-external' : 'complete'
      : pending ? 'pending' : unknownExternal ? 'unknown-external' : 'interrupted',
  };
}

function pendingInteractionForRecovery(tail, sessionId, threadId) {
  if (!tail?.pending) return undefined;
  const event = tail.pending.interaction.event;
  const interaction = interactionFromEvent(event, sessionId, threadId, tail);
  if (interaction) return interaction;
  return {
    kind: tail.pending.interaction.kind,
    id: tail.pending.interaction.id,
    requestId: tail.pending.interaction.id,
    memberSessionId: sessionId,
    sessionId,
    ...(threadId ? { threadId, owningThreadId: threadId } : {}),
    turn: tail.turn,
    step: tail.step,
    toolCallId: tail.callId,
    callId: tail.callId,
  };
}

function lastTurn(events) {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') return Number(eventData(events[index]).turn ?? 0);
  }
  return 0;
}

function turnEndFor(events, turn) {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'turn/end' && Number(eventData(event).turn ?? 0) === turn) return event;
  }
  return undefined;
}

function resultText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    if (block?.type === 'tool-result') return resultText(block.content);
    return '';
  }).join('');
}

function memberTurnStatus(events, turn) {
  const start = (events ?? []).findLastIndex((event) => (
    event?.type === 'turn/start' && Number(eventData(event).turn ?? 0) === turn
  ));
  const pending = new Set();
  for (const event of (events ?? []).slice(Math.max(0, start))) {
    if (event?.type === 'tool/call' && eventData(event).name === 'send_room_message') {
      const callId = stringId(eventData(event).callId ?? eventData(event).toolCallId ?? eventData(event).id);
      if (callId) pending.add(callId);
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = stringId(
      eventData(event).message?.source?.callId
        ?? eventData(event).message?.source?.toolCallId
        ?? eventData(event).message?.toolCallId
        ?? eventData(event).toolCallId,
    );
    if (!callId || !pending.delete(callId)) continue;
    if (eventData(event).error || eventData(event).message?.content?.some((block) => block?.isError === true)) continue;
    const raw = resultText(eventData(event).message?.content);
    let body = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.content === 'string') body = parsed.content;
    } catch {
      // Plain text tool results stay as-is.
    }
    if (isPassContent(body)) return 'passed';
  }
  return 'idle';
}

function memberUserMessage(content, threadId, dispatchIdentity) {
  const source = {
    kind: 'user',
    ...(threadId ? { threadId } : {}),
    ...(dispatchIdentity ? { dshbotGroupTurn: dispatchIdentity } : {}),
  };
  return createUserMessage({
    content,
    source,
    ...(threadId ? { threadId } : {}),
  });
}

async function inspectPersistedSession(ownerCtx, sessionId) {
  const controller = sessionControllerFor(ownerCtx);
  if (typeof controller?.inspect === 'function') {
    let observed;
    try {
      observed = await controller.inspect(sessionId);
    } catch (error) {
      if (isMissingSessionError(error)) return undefined;
      throw error;
    }
    if (observed === undefined || observed === null) return undefined;
    return {
      meta: observed.meta ?? observed.header,
      events: cloneValue(Array.isArray(observed.events) ? observed.events : []) ?? [],
    };
  }

  const persistence = serviceFor(ownerCtx, 'sessionPersistence');
  if (!persistence) return undefined;
  let observed;
  if (typeof persistence.inspect === 'function') {
    try {
      observed = await persistence.inspect(sessionId);
    } catch (error) {
      if (isMissingSessionError(error)) return undefined;
      throw error;
    }
    if (observed === undefined || observed === null) return undefined;
  } else if (typeof persistence.stat === 'function') {
    try {
      observed = await persistence.stat(sessionId);
    } catch (error) {
      if (isMissingSessionError(error)) return undefined;
      throw error;
    }
    if (observed === undefined || observed === null) return undefined;
  } else {
    return undefined;
  }

  const meta = observed?.meta ?? observed?.header;
  if (Array.isArray(observed?.events)) return { meta, events: cloneValue(observed.events) };
  if (typeof persistence.open !== 'function') return { meta, events: [] };
  let reader;
  try {
    reader = await persistence.open(sessionId, 'read');
    const events = Array.isArray(reader?.events)
      ? reader.events
      : typeof reader?.read === 'function' ? await reader.read(0, undefined) : [];
    return {
      meta: meta ?? reader?.header,
      events: cloneValue(events) ?? [],
    };
  } catch (error) {
    if (isMissingSessionError(error)) return undefined;
    throw error;
  } finally {
    try { await reader?.close?.(); } catch { /* best effort */ }
  }
}

async function existingMemberSession(ownerCtx, roomSessionId, botId) {
  const candidates = [
    groupMemberSessionId(roomSessionId, botId),
    legacyGroupMemberSessionId(roomSessionId, botId),
  ];
  for (const sessionId of candidates) {
    const live = ownerCtx?.agents?.get?.(sessionId);
    if (live) return { sessionId, agent: live, inspection: { meta: live.session?.header, events: live.session?.snapshotEvents?.() ?? [] } };
    const inspection = await inspectPersistedSession(ownerCtx, sessionId);
    if (inspection) return { sessionId, inspection };
  }
  return { sessionId: candidates[0] };
}

/** Inspect the exact deterministic member Session without activating it. */
export async function inspectGroupMemberSession({ ownerCtx, roomSessionId, botId }) {
  const selected = await existingMemberSession(ownerCtx, roomSessionId, botId);
  if (!selected.agent && !selected.inspection) return undefined;
  return {
    sessionId: selected.sessionId,
    meta: cloneValue(selected.inspection?.meta ?? selected.agent?.session?.header),
    events: cloneValue(
      selected.agent?.session?.snapshotEvents?.()
        ?? selected.inspection?.events
        ?? [],
    ) ?? [],
    live: Boolean(selected.agent),
  };
}

function defaultMemberAgentOptions(bot) {
  const model = bot?.model;
  if (!model?.provider || !model?.model) return {};
  return {
    provider: model.provider,
    model: model.model,
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
  };
}

async function createOrResumeHandle({
  ownerCtx,
  room,
  sessionId,
  bot,
  persona,
  agentOptions,
  roomSessionId,
  botCwd,
  persistedInspection,
  allowCreate = true,
}) {
  const setup = memberSetup({ ownerCtx, sessionId, persona });
  const controller = sessionControllerFor(ownerCtx);
  if (typeof controller?.setPresentation !== 'function') {
    throw new GroupMemberRuntimeError(
      'MEMBER_PRESENTATION_UNAVAILABLE',
      `Group member ${bot.name ?? bot.id} cannot be hidden because Session presentation is unavailable.`,
      { roomSessionId, botId: bot.id, sessionId },
    );
  }
  const persisted = persistedInspection !== undefined;
  if (!persisted && !allowCreate) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_NOT_FOUND',
      `Persisted group member session ${sessionId} does not exist.`,
      { roomSessionId, botId: bot.id, sessionId },
    );
  }
  if (persisted) {
    const persistedCwd = persistedInspection?.meta?.cwd ?? persistedInspection?.header?.cwd;
    if (typeof persistedCwd !== 'string' || !persistedCwd) {
      throw new GroupMemberRuntimeError(
        'MEMBER_SESSION_CWD_UNAVAILABLE',
        `Persisted group member session ${sessionId} has no canonical cwd.`,
        { roomSessionId, botId: bot.id, sessionId, details: { botCwd } },
      );
    }
    if (persistedCwd !== botCwd) {
      throw new GroupMemberRuntimeError(
        'MEMBER_SESSION_CWD_MISMATCH',
        `Persisted group member session ${sessionId} cwd does not match Bot ${bot.name ?? bot.id} workspace.`,
        { roomSessionId, botId: bot.id, sessionId, details: { expectedCwd: botCwd, actualCwd: persistedCwd } },
      );
    }
  }
  let handle;
  try {
    const withoutInitiator = (operation) => typeof ownerCtx.agents.withoutInitiator === 'function'
      ? ownerCtx.agents.withoutInitiator(operation)
      : operation();
    handle = persisted
      ? await withoutInitiator(() => ownerCtx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        setup,
      }))
      : await withoutInitiator(() => ownerCtx.agents.create({
        sessionId,
        meta: { cwd: botCwd },
        agentOptions,
        setup,
      }));
  } catch (error) {
    throw new GroupMemberRuntimeError(
      persisted ? 'MEMBER_SESSION_RESUME_FAILED' : 'MEMBER_SESSION_CREATE_FAILED',
      `Could not ${persisted ? 'resume' : 'create'} group member ${bot.name ?? bot.id} session: ${String(error?.message ?? error)}`,
      { roomSessionId, botId: bot.id, sessionId, cause: error },
    );
  }
  try {
    assertSessionIdentity(handle.agent, sessionId, { roomSessionId, botId: bot.id, sessionId, bot });
    assertSessionCwd(handle.agent, botCwd, { roomSessionId, botId: bot.id, sessionId, bot });
    await controller.setPresentation({
      sessionId,
      presentation: memberPresentation(sessionId, room, bot),
    });
  } catch (error) {
    await Promise.resolve(handle.dispose?.()).catch(() => {});
    if (error instanceof GroupMemberRuntimeError) throw error;
    throw new GroupMemberRuntimeError(
      'MEMBER_PRESENTATION_FAILED',
      `Could not hide group member ${bot.name ?? bot.id} Session.`,
      { roomSessionId, botId: bot.id, sessionId, cause: error },
    );
  }
  residentHandles.set(sessionId, handle);
  const events = handle.agent?.session?.snapshotEvents?.() ?? persistedInspection?.events ?? [];
  return {
    handle,
    persisted,
    recovery: recoveryTail(events),
  };
}

async function ensureHandle(options) {
  const sessionId = options.sessionId;
  const resident = residentHandles.get(sessionId);
  if (resident?.agent && options.ownerCtx.agents.get(sessionId) === resident.agent) {
    return {
      handle: resident,
      persisted: true,
      recovery: recoveryTail(resident.agent.session?.snapshotEvents?.() ?? []),
    };
  }
  const live = options.ownerCtx.agents.get(sessionId);
  if (live) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_BUSY',
      `Group member session ${sessionId} is already active and cannot accept a second turn.`,
      { roomSessionId: options.roomSessionId, botId: options.bot.id, sessionId },
    );
  }
  const prior = ensureLocks.get(sessionId);
  if (prior) return prior;
  const creating = createOrResumeHandle(options);
  ensureLocks.set(sessionId, creating);
  try {
    return await creating;
  } finally {
    if (ensureLocks.get(sessionId) === creating) ensureLocks.delete(sessionId);
  }
}

function waitForTurnEnd(ownerCtx, sessionId, turnBefore, signal, threadId = '', initialEvents = [], timeoutMs = MEMBER_TURN_TIMEOUT_MS) {
  let disposeSession = () => {};
  let disposeQuestion = () => {};
  let disposeApproval = () => {};
  let disposeAbort = () => {};
  let timer;
  let settled = false;
  let resolveWait;
  let rejectWait;
  const promise = new Promise((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  promise.catch(() => {});
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    disposeSession();
    disposeQuestion();
    disposeApproval();
    disposeAbort();
    callback(value);
  };
  const onEvent = (session, event) => {
    if (eventSessionId(session) !== sessionId) return;
    if (signal?.aborted) return;
    applySessionEventState(session, event, threadId);
    if (event?.type !== 'turn/end') return;
    const turn = Number(eventData(event).turn ?? 0);
    if (turn <= turnBefore) return;
    finish(resolveWait, { turn, event });
  };
  const root = ownerCtx?.root;
  if (typeof root?.on === 'function') {
    disposeSession = root.on('session/event', onEvent) ?? (() => {});
    disposeQuestion = root.on('user-questions/request', async (request, next) => {
      const requestSessionId = request?.agent?.session?.id ?? request?.agent?.id;
      if (String(requestSessionId ?? '') !== sessionId) return typeof next === 'function' ? next() : undefined;
      if (signal?.aborted) return typeof next === 'function' ? next() : undefined;
      const events = request?.agent?.session?.snapshotEvents?.() ?? [];
      const interaction = interactionFromQuestionRequest(request, sessionId, threadId, recoveryTail(events));
      const profile = groupMemberProfileForSession(sessionId);
      if (profile) applyInteractionState(profile, interaction);
      try {
        return typeof next === 'function' ? await next() : undefined;
      } finally {
        const current = profile && runtimeStates.get(stateKey(profile.roomSessionId, profile.botId));
        if (profile && !signal?.aborted && !isTerminalMemberStatus(current?.status)) {
          setState(profile.roomSessionId, profile.botId, { status: 'running', pending: undefined });
        }
      }
    }) ?? (() => {});
    disposeApproval = root.on('approval/request', async (request, next) => {
      const requestSessionId = request?.agent?.session?.id ?? request?.agent?.id;
      if (String(requestSessionId ?? '') !== sessionId) return typeof next === 'function' ? next() : undefined;
      if (signal?.aborted) return typeof next === 'function' ? next() : undefined;
      const events = request?.agent?.session?.snapshotEvents?.() ?? [];
      const profile = groupMemberProfileForSession(sessionId);
      const interaction = interactionFromApprovalRequest(request, sessionId, threadId, recoveryTail(events));
      if (profile && interaction) applyInteractionState(profile, interaction);
      try {
        return typeof next === 'function' ? await next() : undefined;
      } finally {
        const current = profile && runtimeStates.get(stateKey(profile.roomSessionId, profile.botId));
        if (profile && !signal?.aborted && !isTerminalMemberStatus(current?.status)) {
          setState(profile.roomSessionId, profile.botId, { status: 'running', pending: undefined });
        }
      }
    }) ?? (() => {});
  }
  if (signal?.aborted) {
    finish(rejectWait, new GroupMemberRuntimeError('MEMBER_TURN_ABORTED', 'Group member turn was aborted.', { sessionId }));
  } else {
    const onAbort = () => finish(
      rejectWait,
      new GroupMemberRuntimeError('MEMBER_TURN_ABORTED', 'Group member turn was aborted.', { sessionId }),
    );
    signal?.addEventListener?.('abort', onAbort, { once: true });
    disposeAbort = () => signal?.removeEventListener?.('abort', onAbort);
    timer = setTimeout(() => finish(
      rejectWait,
      new GroupMemberRuntimeError('MEMBER_TURN_TIMEOUT', `Group member turn timed out after ${timeoutMs}ms.`, { sessionId }),
    ), timeoutMs);
    timer.unref?.();
    const initialEnd = [...(initialEvents ?? [])].reverse().find((event) => (
      event?.type === 'turn/end' && Number(eventData(event).turn ?? 0) > turnBefore
    ));
    if (initialEnd) queueMicrotask(() => finish(resolveWait, {
      turn: Number(eventData(initialEnd).turn ?? 0),
      event: initialEnd,
    }));
  }
  return {
    promise,
    abort: () => finish(rejectWait, new GroupMemberRuntimeError('MEMBER_TURN_ABORTED', 'Group member turn was aborted.', { sessionId })),
  };
}

function cancelCauseFor(signal) {
  const kind = cancelKind(signal);
  return kind ? { kind } : { kind: 'parent' };
}

function recoveryFailure(tail, options) {
  if (tail.kind === 'unknown-external') {
    return new GroupMemberRuntimeError(
      'MEMBER_EXTERNAL_OUTCOME_UNKNOWN',
      `Group member ${options.bot.name ?? options.bot.id} has an in-flight external tool outcome that cannot be replayed safely.`,
      { ...options, details: { unresolvedCallIds: tail.unresolvedCalls } },
    );
  }
  return new GroupMemberRuntimeError(
    'MEMBER_TURN_INTERRUPTED',
    `Group member ${options.bot.name ?? options.bot.id} has an interrupted turn that cannot be replayed safely.`,
    { ...options, details: { turn: tail.turn, step: tail.step } },
  );
}

function completionFailure(reason, options) {
  return new GroupMemberRuntimeError(
    reason?.kind === 'aborted' ? 'MEMBER_TURN_ABORTED' : 'MEMBER_TURN_FAILED',
    `Group member ${options.bot.name ?? options.bot.id} ended without a completed turn (${reason?.kind ?? 'unknown'}).`,
    { ...options, details: { reason }, cause: reason?.error },
  );
}

function setRecoveryState(profile, tail, threadId, events, sessionId = groupMemberSessionId(profile.roomSessionId, profile.botId)) {
  if (!profile) return;
  if (tail.kind === 'pending') {
    const interaction = pendingInteractionForRecovery(tail, sessionId, threadId || threadIdFromEvents(events));
    const effectiveThreadId = threadId || threadIdFromEvents(events);
    setState(profile.roomSessionId, profile.botId, {
      status: 'pending',
      sessionId,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      pending: interaction,
      lastError: undefined,
    });
    return;
  }
  if (tail.kind === 'unknown-external' || tail.kind === 'interrupted') {
    setState(profile.roomSessionId, profile.botId, {
      status: 'failed',
      sessionId,
      ...(threadId ? { threadId } : {}),
      pending: undefined,
      lastError: {
        code: tail.kind === 'unknown-external' ? 'MEMBER_EXTERNAL_OUTCOME_UNKNOWN' : 'MEMBER_TURN_INTERRUPTED',
        message: tail.kind === 'unknown-external'
          ? 'An in-flight external tool outcome was not replayed.'
          : 'An interrupted member turn was not replayed.',
      },
    });
    return;
  }
  if (tail.kind === 'complete') {
    const end = tail.lastEnd;
    const reason = eventData(end).reason;
    const effectiveThreadId = threadId || threadIdFromEvents(events);
    const turn = Number(eventData(end).turn ?? 0);
    const unknownExternal = tail.lastEndHadUnknownExternalOutcome || hasUnknownExternalOutcome(events, turn);
    const cancellationKind = reason?.kind === 'aborted' ? String(reason.reason?.kind ?? '') : '';
    let status = 'idle';
    let lastError;
    if (unknownExternal || reason?.kind === 'interrupted') {
      status = 'failed';
      lastError = {
        code: unknownExternal ? 'MEMBER_EXTERNAL_OUTCOME_UNKNOWN' : 'MEMBER_TURN_INTERRUPTED',
        message: unknownExternal
          ? 'An in-flight external tool outcome was not replayed.'
          : 'An interrupted member turn was not replayed.',
      };
    } else if (reason?.kind === 'error') {
      status = 'failed';
      lastError = { code: 'MEMBER_TURN_FAILED', message: 'The persisted member turn failed.' };
    } else if (reason?.kind === 'aborted') {
      if (['stale', 'epoch', 'superseded'].includes(cancellationKind)) {
        status = 'stale';
      } else if (cancellationKind === 'timeout') {
        status = 'timed-out';
        lastError = { code: 'MEMBER_TURN_TIMEOUT', message: 'The persisted member turn timed out.' };
      } else if (cancellationKind === 'user') {
        status = pendingRecordsFromEvents(events, sessionId).length > 0 ? 'held' : 'stopped';
      } else {
        status = 'failed';
        lastError = { code: 'MEMBER_TURN_ABORTED', message: 'The persisted member turn was aborted.' };
      }
    } else if (reason?.kind === 'completed') {
      status = memberTurnStatus(events, turn);
    }
    setState(profile.roomSessionId, profile.botId, {
      status,
      sessionId,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      pending: undefined,
      lastError,
    });
  }
}

/**
 * Run one turn on the durable room/member session. A recovered pending turn
 * resumes the AgentLoop's recorded tool call and deliberately skips followup.
 */
export async function runGroupMemberTurn({
  ownerCtx,
  parent,
  room,
  roomSessionId,
  threadId,
  bot,
  persona,
  agentOptions,
  content,
  signal,
  abortController,
  dispatchIdentity,
  timeoutMs = MEMBER_TURN_TIMEOUT_MS,
}) {
  const selected = await existingMemberSession(ownerCtx, roomSessionId, bot.id);
  const sessionId = selected.sessionId;
  registerGroupMemberProfile({ sessionId, roomSessionId, botId: bot.id });
  currentPersonas.set(sessionId, persona);
  const initialEvents = selected.inspection?.events ?? selected.agent?.session?.snapshotEvents?.() ?? [];
  const effectiveThreadId = stringId(threadId) || threadIdFromEvents(initialEvents);
  const effectiveDispatchIdentity = memberDispatchIdentity(dispatchIdentity, {
    roomSessionId,
    threadId: effectiveThreadId,
    memberSessionId: sessionId,
    timeoutAt: Date.now() + timeoutMs,
  });
  const effectiveAgentOptions = agentOptions ?? defaultMemberAgentOptions(bot);
  const priorState = runtimeStates.get(stateKey(String(roomSessionId), String(bot.id)));
  const profile = { roomSessionId: String(roomSessionId), botId: String(bot.id) };
  setState(roomSessionId, bot.id, {
    status: 'starting',
    sessionId,
    ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
    pending: undefined,
    lastError: undefined,
  });

  let handle;
  let agent;
  let afterEnsureEvents;
  let recovery;
  try {
    const botCwd = await resolveGroupMemberCwd({ ownerCtx, bot, roomSessionId, sessionId });
    const ensured = await ensureHandle({
      ownerCtx,
      room,
      roomSessionId,
      bot,
      persona,
      agentOptions: effectiveAgentOptions,
      sessionId,
      botCwd,
      persistedInspection: selected.inspection,
    });
    handle = ensured.handle;
    agent = handle.agent;
    assertSessionIdentity(agent, sessionId, { roomSessionId, botId: bot.id, sessionId, bot });
    assertSessionCwd(agent, botCwd, { roomSessionId, botId: bot.id, sessionId, bot });
    afterEnsureEvents = agent.session.snapshotEvents();
    recovery = recoveryTail(initialEvents.length ? initialEvents : afterEnsureEvents);
  } catch (error) {
    const failure = error instanceof GroupMemberRuntimeError
      ? error
      : new GroupMemberRuntimeError('MEMBER_TURN_FAILED', `Could not start group member ${bot.name ?? bot.id}.`, {
        roomSessionId,
        botId: bot.id,
        sessionId,
        cause: error,
      });
    setState(roomSessionId, bot.id, {
      status: 'failed',
      sessionId,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      pending: undefined,
      lastError: { code: failure.code, message: failure.message },
    });
    throw failure;
  }
  // A user stop can leave only a turn/start in a lightweight/test Session
  // while the real AgentLoop normally appends aborted closers. There is no
  // side effect to replay when the stopped carrier has no unresolved calls.
  if (priorState?.status === 'stopped'
    && recovery.kind === 'interrupted'
    && recovery.unresolvedCalls.length === 0) {
    recovery = { ...recovery, kind: 'complete' };
  }
  const active = { handle, roomSessionId, threadId: effectiveThreadId, botId: bot.id, abortController };
  activeHandles.set(sessionId, active);
  watchSession(ownerCtx, sessionId, effectiveThreadId);
  setState(roomSessionId, bot.id, {
    status: recovery.kind === 'pending' ? 'pending' : 'running',
    sessionId,
    ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
    ...(recovery.kind === 'pending' ? {
      pending: pendingInteractionForRecovery(recovery, sessionId, effectiveThreadId),
    } : {}),
  });

  let waiter;
  const onAbort = () => {
    try { agent.cancel(cancelCauseFor(signal)); } catch { /* best effort */ }
  };
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    if (signal?.aborted) {
      onAbort();
      throw new GroupMemberRuntimeError('MEMBER_TURN_ABORTED', 'Group member turn was aborted.', { roomSessionId, botId: bot.id, sessionId });
    }
    if (recovery.kind === 'unknown-external' || recovery.kind === 'interrupted') {
      setRecoveryState(profile, recovery, effectiveThreadId, afterEnsureEvents, sessionId);
      try { await agent.whenIdle?.(); } catch { /* the durable failure is already known */ }
      throw recoveryFailure(recovery, { roomSessionId, botId: bot.id, sessionId, bot });
    }
    const turnBefore = lastTurn(initialEvents.length ? initialEvents : afterEnsureEvents);
    waiter = waitForTurnEnd(ownerCtx, sessionId, turnBefore, signal, effectiveThreadId, afterEnsureEvents, timeoutMs);
    if (recovery.kind !== 'pending') {
      await agent.followup(memberUserMessage(content, effectiveThreadId, effectiveDispatchIdentity));
    }
    const ended = await waiter.promise;
    await agent.whenIdle?.();
    await serviceFor(ownerCtx, 'sessions')?.flush?.(agent.session);
    const events = agent.session.snapshotEvents();
    const end = turnEndFor(events, ended.turn) ?? ended.event;
    const reason = eventData(end).reason;
    if (reason?.kind !== 'completed') throw completionFailure(reason, { roomSessionId, botId: bot.id, sessionId, bot });
    setState(roomSessionId, bot.id, {
      status: memberTurnStatus(events, ended.turn),
      sessionId,
      pending: undefined,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      lastError: undefined,
    });
    return { sessionId, turn: ended.turn, events, dispatchIdentity: effectiveDispatchIdentity };
  } catch (error) {
    const kind = cancelKind(signal);
    const stopped = active.stopStatus ?? (isUserCancellation(signal) ? stoppedStatus(roomSessionId, bot.id) : undefined);
    if (stopped) {
      const interrupted = new GroupMemberRuntimeError(
        'MEMBER_TURN_STOPPED',
        `Group member ${bot.name ?? bot.id} was stopped by the user.`,
        { roomSessionId, botId: bot.id, sessionId, details: { status: stopped }, cause: error },
      );
      clearPendingState(roomSessionId, bot.id, stopped);
      throw interrupted;
    }
    if (isStaleCancellation(signal)) {
      clearPendingState(roomSessionId, bot.id, 'stale');
      throw new GroupMemberRuntimeError(
        'MEMBER_TURN_STALE',
        `Group member ${bot.name ?? bot.id} turn was superseded by a newer room turn.`,
        { roomSessionId, botId: bot.id, sessionId, cause: error },
      );
    }
    if (error?.code === 'MEMBER_TURN_TIMEOUT' || kind === 'timeout') {
      try { agent.cancel({ kind: 'timeout' }); } catch { /* best effort */ }
      const timeout = error instanceof GroupMemberRuntimeError
        ? error
        : new GroupMemberRuntimeError('MEMBER_TURN_TIMEOUT', `Group member ${bot.name ?? bot.id} turn timed out.`, {
          roomSessionId, botId: bot.id, sessionId, cause: error,
        });
      setState(roomSessionId, bot.id, {
        status: 'timed-out',
        sessionId,
        pending: undefined,
        lastError: { code: timeout.code, message: timeout.message },
      });
      throw timeout;
    }
    const failure = error instanceof GroupMemberRuntimeError
      ? error
      : new GroupMemberRuntimeError('MEMBER_TURN_FAILED', `Group member ${bot.name ?? bot.id} failed.`, {
        roomSessionId,
        botId: bot.id,
        sessionId,
        cause: error,
      });
    setState(roomSessionId, bot.id, {
      status: 'failed',
      sessionId,
      pending: undefined,
      lastError: { code: failure.code, message: failure.message },
    });
    throw failure;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
    waiter?.abort?.();
    activeHandles.delete(sessionId);
  }
}

function catalogRows(value) {
  const items = Array.isArray(value) ? value : value?.items;
  return Array.isArray(items) ? items : [];
}

function requestedThreadId(options, room, bot, events) {
  if (typeof options.threadIdForMember === 'function') {
    const value = options.threadIdForMember(room, bot);
    if (value) return String(value);
  }
  if (typeof options.threadIdForRoom === 'function') {
    const value = options.threadIdForRoom(room);
    if (value) return String(value);
  }
  const map = options.threadIds;
  const key = String(room.sessionId ?? room.id ?? '');
  const mapped = map && typeof map === 'object' ? (map[key] ?? map[room.id]) : undefined;
  return stringId(mapped) || stringId(options.threadId) || threadIdFromEvents(events);
}

/**
 * Reconcile materialized group member Sessions after Host/plugin startup.
 * This never creates a missing member session; it only resumes an existing
 * pending/crash-tail session and reconstructs its process-local ownership.
 */
export async function reconcileGroupMemberRuntime(options = {}) {
  const items = catalogRows(options.items ?? options.catalog);
  registerGroupMemberProfiles(items);
  const rooms = items.filter((item) => item?.kind === 'room');
  const bots = new Map(items.filter((item) => item?.kind !== 'room' && item?.id)
    .map((item) => [String(item.id), item]));
  const results = [];
  for (const room of rooms) {
    const roomSessionId = stringId(room.sessionId);
    if (!roomSessionId) continue;
    for (const memberId of Array.isArray(room.memberBotIds) ? room.memberBotIds : []) {
      const bot = bots.get(String(memberId));
      if (!bot) continue;
      const selected = await existingMemberSession(options.ownerCtx, roomSessionId, bot.id);
      if (!selected.inspection && !selected.agent) continue;
      registerGroupMemberProfile({ sessionId: selected.sessionId, roomSessionId, botId: bot.id });
      const events = selected.inspection?.events ?? selected.agent?.session?.snapshotEvents?.() ?? [];
      const threadId = requestedThreadId(options, room, bot, events);
      const profile = { roomSessionId, botId: String(bot.id) };
      let tail = recoveryTail(events);
      if (tail.kind === 'complete') {
        setRecoveryState(profile, tail, threadId, events, selected.sessionId);
        results.push(groupMemberRuntimeSnapshot().find((state) => stateKey(state.roomSessionId, state.botId) === stateKey(roomSessionId, bot.id)));
        continue;
      }
      try {
        const botCwd = await resolveGroupMemberCwd({
          ownerCtx: options.ownerCtx,
          bot,
          roomSessionId,
          sessionId: selected.sessionId,
        });
        const agentOptions = typeof options.agentOptionsForBot === 'function'
          ? options.agentOptionsForBot(bot)
          : defaultMemberAgentOptions(bot);
        const ensured = await ensureHandle({
          ownerCtx: options.ownerCtx,
          room,
          roomSessionId,
          bot,
          persona: options.personaForBot?.(bot, room) ?? bot.description ?? '',
          agentOptions,
          sessionId: selected.sessionId,
          botCwd,
          persistedInspection: selected.inspection,
          allowCreate: false,
        });
        const agent = ensured.handle.agent;
        watchSession(options.ownerCtx, selected.sessionId, threadId);
        const after = agent.session.snapshotEvents();
        tail = recoveryTail(after);
        if (tail.kind === 'pending') {
          const interaction = pendingInteractionForRecovery(tail, selected.sessionId, threadId || threadIdFromEvents(after));
          setState(roomSessionId, bot.id, {
            status: 'pending',
            sessionId: selected.sessionId,
            ...((threadId || threadIdFromEvents(after)) ? { threadId: threadId || threadIdFromEvents(after) } : {}),
            pending: interaction,
            lastError: undefined,
          });
        } else {
          setRecoveryState(profile, tail, threadId, after, selected.sessionId);
        }
      } catch (error) {
        const failure = error instanceof GroupMemberRuntimeError
          ? error
          : new GroupMemberRuntimeError('MEMBER_SESSION_RECOVERY_FAILED', `Could not recover group member ${bot.name ?? bot.id}.`, {
            roomSessionId, botId: bot.id, sessionId: selected.sessionId, cause: error,
          });
        setState(roomSessionId, bot.id, {
          status: 'failed',
          sessionId: selected.sessionId,
          ...(threadId ? { threadId } : {}),
          pending: undefined,
          lastError: { code: failure.code, message: failure.message },
        });
      }
      results.push(groupMemberRuntimeSnapshot().find((state) => stateKey(state.roomSessionId, state.botId) === stateKey(roomSessionId, bot.id)));
    }
  }
  return results.filter(Boolean);
}

export const registerGroupMemberRecovery = reconcileGroupMemberRuntime;

/** Read the durable pending interaction for one live/recovered member. */
export function groupMemberPendingInteraction(ownerCtx, sessionId) {
  const agent = ownerCtx?.agents?.get?.(String(sessionId)) ?? residentHandles.get(String(sessionId))?.agent;
  const pending = pendingInteractionForAgent(ownerCtx, agent, '');
  if (pending) return cloneValue(pending);
  const profile = groupMemberProfileForSession(sessionId);
  const state = profile && runtimeStates.get(stateKey(profile.roomSessionId, profile.botId));
  return cloneValue(state?.pending);
}

export const pendingGroupMemberInteraction = groupMemberPendingInteraction;

async function respondToGroupMemberInteraction({ ownerCtx, sessionId, requestId, kind, answer, outcome, cancel = false }) {
  const id = stringId(sessionId);
  const agent = ownerCtx?.agents?.get?.(id) ?? residentHandles.get(id)?.agent;
  if (!agent) {
    throw new GroupMemberRuntimeError(
      'MEMBER_SESSION_OFFLINE',
      `Group member session ${id} is not live; reconcile it before answering.`,
      { sessionId: id },
    );
  }
  const pending = pendingInteractionForAgent(ownerCtx, agent, requestId);
  const resolvedKind = kind || pending?.kind;
  const resolvedRequestId = stringId(requestId) || pending?.requestId;
  if (!resolvedKind || !resolvedRequestId) {
    throw new GroupMemberRuntimeError(
      'MEMBER_INTERACTION_IDENTITY_MISSING',
      `A live group member interaction for ${id} requires its kind and request ID.`,
      { sessionId: id, details: { requestId, kind } },
    );
  }
  const service = serviceFor(ownerCtx, resolvedKind === 'approval' ? 'approval' : 'userQuestions');
  if (!service) {
    throw new GroupMemberRuntimeError(
      'MEMBER_INTERACTION_UNAVAILABLE',
      `No ${resolvedKind === 'approval' ? 'approval' : 'user question'} service is available for ${id}.`,
      { sessionId: id, details: { requestId } },
    );
  }
  let result;
  if (resolvedKind === 'approval') {
    if (typeof service.respond !== 'function') throw new GroupMemberRuntimeError('MEMBER_INTERACTION_UNAVAILABLE', 'Approval service cannot respond.', { sessionId: id });
    result = await service.respond(agent, resolvedRequestId, cancel ? 'cancelled' : String(outcome ?? answer));
  } else {
    if (cancel) {
      if (typeof service.cancel !== 'function') throw new GroupMemberRuntimeError('MEMBER_INTERACTION_UNAVAILABLE', 'User question service cannot cancel.', { sessionId: id });
      result = await service.cancel(agent, resolvedRequestId);
    } else {
      if (typeof service.respond !== 'function') throw new GroupMemberRuntimeError('MEMBER_INTERACTION_UNAVAILABLE', 'User question service cannot respond.', { sessionId: id });
      result = await service.respond(agent, resolvedRequestId, answer);
    }
  }
  const profile = groupMemberProfileForSession(id);
  if (profile) {
    const events = agent.session?.snapshotEvents?.() ?? [];
    if (result?.status === 'accepted') {
      const threadId = threadIdFromEvents(events);
      setState(profile.roomSessionId, profile.botId, {
        status: 'running',
        sessionId: id,
        ...(threadId ? { threadId } : {}),
        pending: undefined,
        lastError: undefined,
      });
    } else {
      setRecoveryState(profile, recoveryTail(events), threadIdFromEvents(events), events, id);
    }
  }
  return result;
}

export function answerGroupMemberInteraction(options) {
  return respondToGroupMemberInteraction(options ?? {});
}

export const respondGroupMemberInteraction = answerGroupMemberInteraction;

export function cancelGroupMemberInteraction(options) {
  return respondToGroupMemberInteraction({ ...options, cancel: true });
}

/** Abort all active member turns for a room without touching other rooms. */
export function abortGroupMemberTurns(roomSessionId, cause = { kind: 'parent' }) {
  for (const [sessionId, active] of activeHandles) {
    if (active.roomSessionId !== roomSessionId) continue;
    active.cancelCause = cause;
    if (cause.kind === 'user') {
      active.stopStatus = stoppedStatus(active.roomSessionId, active.botId);
      clearPendingState(active.roomSessionId, active.botId, active.stopStatus);
    } else if (['stale', 'epoch', 'superseded'].includes(String(cause.kind))) {
      clearPendingState(active.roomSessionId, active.botId, 'stale');
    }
    try { active.abortController?.abort(cause); } catch { /* best effort */ }
    if (!active.abortController) {
      try { active.handle.agent.cancel(cause); } catch { /* best effort */ }
    }
  }
}

/** Release active handles and clear process-local profile/state indexes. */
export async function disposeGroupMemberRuntime() {
  const disposals = [];
  const handles = new Set([...residentHandles.values(), ...[...activeHandles.values()].map((entry) => entry.handle)]);
  for (const active of activeHandles.values()) {
    try { active.abortController?.abort({ kind: 'disposed' }); } catch { /* best effort */ }
  }
  for (const sessionId of recoveryWatchers.keys()) disposeSessionWatcher(sessionId);
  for (const handle of handles) {
    try { handle.agent.cancel({ kind: 'disposed' }); } catch { /* best effort */ }
    disposals.push(Promise.resolve(handle.dispose?.()).catch(() => {}));
  }
  await Promise.all(disposals);
  activeHandles.clear();
  residentHandles.clear();
  ensureLocks.clear();
  currentPersonas.clear();
  profiles.clear();
  runtimeStates.clear();
}
