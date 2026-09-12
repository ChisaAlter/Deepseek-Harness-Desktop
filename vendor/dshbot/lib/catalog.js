/**
 * Pure catalog helpers for dshbot contacts and rooms.
 * Host apply, the room tool, and node:test share this module.
 * Group protocol symbols live in group-chat.js (Grok-aligned).
 */

import {
  GROUP_MAX_CONTINUATIONS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MESSAGES,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_MIN_MEMBERS,
  GROUP_PROTOCOL_STATES,
  GROUP_THREAD_GAP_MS,
  GROUP_TURN_STATES,
  admitGroupMemberResult,
  admitGroupTurnResult,
  advanceGroupThreadWatermark,
  applyGroupHoldDirective,
  assignLegacyThreads,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  classifyGroupHoldDirective,
  classifyGroupTurnOutcome,
  declaredGroupThreadIdForUserEvent,
  groupResultThreadId,
  groupPendingIdentityKey,
  groupPendingRequestIdentity,
  groupThreadDelta,
  groupThreadIdForUserEvent,
  groupThreadOf,
  groupThreadWatermarkKey,
  heldMemberWatermarkAdvance,
  isPassContent,
  isValidGroupThreadId,
  mainGroupThreadTarget,
  mainThreadTarget,
  memberVisibleText,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  parseGroupMentions as parseGroupMentionsCore,
  parseGroupThreadReply,
  readGroupThreadWatermark,
  replyGroupThreadTarget,
  replyThreadTarget,
  resolveGroupThreadTarget,
  resolveResponders,
  shouldCommitMemberTurn,
  stripLegacyNextFooter,
  trimGroupChatLog,
  unaddressedGroupMentionDetails as unaddressedGroupMentionDetailsCore,
  unaddressedGroupMentions as unaddressedGroupMentionsCore,
} from './group-chat.js';
import { botDisplayName, stableBotName } from './bot-identity.js';

export {
  GROUP_MAX_CONTINUATIONS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MESSAGES,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_MIN_MEMBERS,
  GROUP_PROTOCOL_STATES,
  GROUP_THREAD_GAP_MS,
  GROUP_TURN_STATES,
  admitGroupMemberResult,
  admitGroupTurnResult,
  advanceGroupThreadWatermark,
  applyGroupHoldDirective,
  assignLegacyThreads,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  classifyGroupHoldDirective,
  classifyGroupTurnOutcome,
  groupResultThreadId,
  groupPendingIdentityKey,
  groupPendingRequestIdentity,
  groupThreadDelta,
  groupThreadIdForUserEvent,
  groupThreadOf,
  groupThreadWatermarkKey,
  heldMemberWatermarkAdvance,
  isPassContent,
  isPotentialPassPrefix,
  isSameMemberSet,
  isValidGroupThreadId,
  mainGroupThreadTarget,
  mainThreadTarget,
  memberVisibleText,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  parseGroupThreadReply,
  readGroupThreadWatermark,
  replyGroupThreadTarget,
  replyThreadTarget,
  resolveGroupThreadTarget,
  resolveResponders,
  shouldCommitMemberTurn,
  stripLegacyNextFooter,
  trimGroupChatLog,
  unaddressedGroupMentionDetails,
} from './group-chat.js';

export const AVATAR_HUE_COUNT = 6;
/** @deprecated Use GROUP_MAX_MEMBER_TURNS */
export const DEFAULT_MAX_SPEAKS = GROUP_MAX_MEMBER_TURNS;
/** @deprecated Use GROUP_MAX_ROUNDS */
export const DEFAULT_MAX_ROUNDS = GROUP_MAX_ROUNDS;

/**
 * Clamp legacy config names to the fixed group protocol bounds.
 * @param {{ maxSpeaks?: number, maxRounds?: number }} [limits]
 * @returns {{ maxSpeaks: number, maxRounds: number }}
 */
export function resolveGroupProtocolLimits(limits = {}) {
  const clamp = (value, fallback, maximum) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(maximum, Math.trunc(value)));
  };
  return {
    maxSpeaks: clamp(limits.maxSpeaks, GROUP_MAX_MEMBER_TURNS, GROUP_MAX_MEMBER_TURNS),
    maxRounds: clamp(limits.maxRounds, GROUP_MAX_ROUNDS, GROUP_MAX_ROUNDS),
  };
}

/**
 * Preserve member failures for the parent room instead of converting them to
 * a protocol pass. Stale epoch cancellation is handled by ask_participant.
 * @param {{ id?: string, name?: string }} bot
 * @param {() => Promise<{ botId: string, name: string, text: string, texts: string[] }>} operation
 * @returns {Promise<{ botId: string, name: string, text: string, texts: string[] }>}
 */
export async function memberTurnOrPass(bot, operation) {
  void bot;
  return operation();
}

/**
 * @param {string | undefined} name
 * @returns {string}
 */
export function avatarInitial(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? [...trimmed][0] : '?';
}

/**
 * @param {string | undefined} name
 * @returns {number}
 */
export function avatarHue(name) {
  const text = String(name ?? '');
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return hash % AVATAR_HUE_COUNT;
}

/**
 * @param {readonly object[]} items
 * @param {string | undefined} query
 * @returns {object[]}
 */
export function filterItems(items, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => {
    const hay = [item.name, item.title, item.description]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return hay.includes(needle);
  });
}

/**
 * @param {{ blank?: boolean } | undefined} session
 * @returns {boolean}
 */
export function canChangeWorkspace(session) {
  return session?.blank === true;
}

/**
 * @param {readonly object[]} items
 * @param {object} item
 * @returns {object[]}
 */
export function upsertItem(items, item) {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

/**
 * @param {readonly object[]} items
 * @param {string} id
 * @param {number} updatedAt
 * @returns {object[]}
 */
export function touchItem(items, id, updatedAt) {
  return items.map((item) => (item.id === id ? { ...item, updatedAt } : item));
}

/**
 * @param {readonly object[]} items
 * @param {string} id
 * @returns {object[]}
 */
export function removeItem(items, id) {
  return items.filter((item) => item.id !== id);
}

/**
 * Contacts shown in an empty dshbot transcript: the 1:1 bot, or a room's
 * known members. Missing catalog rows and unknown session ids yield null.
 * @param {readonly object[]} items
 * @param {string | undefined} sessionId
 * @returns {object[] | null}
 */
export function emptyRoster(items, sessionId) {
  if (!sessionId) return null;
  const item = items.find((entry) => entry.sessionId === sessionId);
  if (!item) return null;
  if (item.kind === 'room') {
    const members = [];
    for (const botId of item.memberBotIds ?? []) {
      const member = items.find((entry) => entry.id === botId);
      if (member) members.push(member);
    }
    return members;
  }
  return [item];
}

/**
 * @param {readonly object[]} items
 * @param {string | undefined} sessionId
 * @returns {string}
 */
export function personaText(items, sessionId) {
  if (!sessionId) return '';
  const item = items.find((entry) => entry.sessionId === sessionId);
  if (!item || item.kind === 'room') return '';
  return typeof item.description === 'string' ? item.description : '';
}

/**
 * Display name for a catalog member id or a unique member name.
 * @param {readonly object[]} items
 * @param {string | undefined} botId
 * @returns {string}
 */
export function memberDisplayName(items, botId) {
  const id = String(botId ?? '');
  if (!id) return 'Bot';
  const byId = items.find((entry) => entry.id === id && entry.kind !== 'room');
  if (byId) return botDisplayName(byId, id);
  const named = items.filter((entry) => entry.kind !== 'room' && entry.name === id);
  if (named.length === 1) return botDisplayName(named[0], id);
  return id;
}

/**
 * Complete-prompt persona for a spawned room member (Grok buildGroupMemberSystemPrompt).
 * @param {object | undefined} bot
 * @param {readonly object[]} [others]
 * @param {{ group?: { name?: string, description?: string } }} [options]
 * @returns {string}
 */
export function childPersonaText(bot, others = [], options = {}) {
  const member = {
    id: String(bot?.id ?? ''),
    name: botDisplayName(bot),
    description: typeof bot?.description === 'string' ? bot.description : '',
  };
  const peers = others.map((entry) => ({
    id: String(entry?.id ?? ''),
    name: botDisplayName(entry),
    description: typeof entry?.description === 'string' ? entry.description : '',
  }));
  const group = {
    name: String(options.group?.name ?? 'Group').trim() || 'Group',
    description: String(options.group?.description ?? ''),
  };
  return buildGroupMemberSystemPrompt(member, group, peers);
}

/**
 * @param {readonly object[]} items
 * @param {readonly string[]} members
 * @param {string} botId
 * @returns {string}
 */
function resolveMemberBotId(items, members, botId) {
  if (members.includes(botId)) return botId;
  const named = items.filter((entry) => (
    entry.kind !== 'room' && entry.name === botId && members.includes(entry.id)
  ));
  return named.length === 1 ? named[0].id : botId;
}

/**
 * @param {readonly object[]} items
 * @param {string} parentSessionId
 * @param {string} botId
 */
export function resolveAskTarget(items, parentSessionId, botId) {
  const room = items.find((entry) => entry.sessionId === parentSessionId);
  if (!room || room.kind !== 'room') {
    throw new Error('ask_participant: calling session is not a room');
  }
  const members = Array.isArray(room.memberBotIds) ? room.memberBotIds : [];
  const resolvedId = resolveMemberBotId(items, members, botId);
  if (!members.includes(resolvedId)) {
    const target = items.find((entry) => entry.id === resolvedId && entry.kind !== 'room');
    throw new Error(`ask_participant: bot ${botDisplayName(target, botId)} is not a member of this room`);
  }
  const bot = items.find((entry) => entry.id === resolvedId);
  if (!bot || bot.kind === 'room') {
    throw new Error(`ask_participant: unknown bot ${botDisplayName(bot, botId)}`);
  }
  return { room, bot };
}

/**
 * @param {readonly { role?: string, content?: readonly { type?: string, text?: string }[] }[]} messages
 * @param {string} role
 * @returns {string}
 */
function lastRoleText(messages, role) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== role) continue;
    const text = (message.content ?? [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (text) return text;
  }
  return '';
}

/**
 * @param {readonly { role?: string, content?: readonly { type?: string, text?: string }[] }[]} messages
 * @returns {string}
 */
export function lastAssistantText(messages) {
  return lastRoleText(messages, 'assistant');
}

/**
 * @param {readonly { role?: string, content?: readonly { type?: string, text?: string }[] }[]} messages
 * @returns {string}
 */
export function lastUserText(messages) {
  return lastRoleText(messages, 'user');
}

/**
 * Per-block text bodies with tool-result nesting flattened. One rendered
 * text block stays one entry, so a two-delivery member turn does not
 * collapse into a single string.
 * @param {unknown} content
 * @returns {string[]}
 */
function contentTexts(content) {
  if (!Array.isArray(content)) return [];
  const texts = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
      continue;
    }
    if (block?.type === 'tool-result' && Array.isArray(block.content)) {
      texts.push(...contentTexts(block.content));
    }
  }
  return texts;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function contentText(content) {
  return contentTexts(content).join('');
}

function hasErrorContent(content) {
  if (!Array.isArray(content)) return false;
  return content.some((block) => (
    block?.isError === true
    || hasErrorContent(block?.content)
  ));
}

function hasAttachmentContent(content) {
  return (Array.isArray(content) ? content : []).some((block) => (
    (block?.type === 'image' || block?.type === 'file')
    && block.attachment !== undefined
  ));
}

function roomEventText(content) {
  const text = parseGroupThreadReply(contentText(content)).text;
  if (text) return text;
  if (hasAttachmentContent(content)) return '[room attachment available]';
  return '';
}

/**
 * Keep the historical `{ speaker, content }` enumerable shape. Protocol
 * consumers can still read durable identity/state metadata directly without
 * forcing old transcript renderers and deep-equality tests to understand it.
 */
function defineGroupMessageMetadata(message, metadata) {
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    Object.defineProperty(message, key, {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    });
  }
  return message;
}

function copyGroupMessage(message, changes = {}) {
  const next = { ...message, ...changes };
  for (const key of Object.getOwnPropertyNames(message)) {
    if (key === 'speaker' || key === 'content' || Object.prototype.hasOwnProperty.call(changes, key)) continue;
    defineGroupMessageMetadata(next, { [key]: message[key] });
  }
  return next;
}

function eventIdentity(event, index) {
  return event?.data?.id ?? event?.id ?? (event?.seq !== undefined ? `seq:${event.seq}` : `index:${index}`);
}

/**
 * Catalog room bound to this session, if any.
 * @param {readonly object[]} items
 * @param {string | undefined} sessionId
 * @returns {object | undefined}
 */
export function catalogRoom(items, sessionId) {
  if (!sessionId) return undefined;
  return items.find((entry) => entry.sessionId === sessionId && entry.kind === 'room');
}

/**
 * Ordinary room conversation requests skip the chat model.
 * @param {{ purpose?: string, sessionId?: string } | undefined} options
 * @param {readonly object[]} items
 * @returns {boolean}
 */
export function isRoomConversationRequest(options, items) {
  if (!options || options.purpose) return false;
  return catalogRoom(items, options.sessionId) !== undefined;
}

// Relay posts are admitted by send_to_agent's membership check. Keep their
// plugin provenance in the log while treating them as new room input.
function isRoomInput(event) {
  if (event?.type !== 'user/message') return false;
  const source = event.data?.source;
  return source?.kind === 'user'
    || (source?.kind === 'plugin' && source.plugin === 'dshbot' && source.form === 'relay');
}

function isRoomHoldInput(event) {
  if (event?.type !== 'user/message') return false;
  const source = event.data?.source;
  return !source || source.kind === 'user';
}

function lateResultPayloadFromSource(source) {
  if (source?.kind !== 'plugin' || source.plugin !== 'dshbot' || source.form !== 'notice') return null;
  const payload = source.dshbotGroupLateResult;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const threadId = String(payload.threadId ?? payload.owningThreadId ?? '').trim();
  const toolCallId = String(payload.toolCallId ?? payload.callId ?? '').trim();
  const botId = String(payload.botId ?? '').trim();
  const texts = (Array.isArray(payload.texts) ? payload.texts : [])
    .map((text) => memberVisibleText(String(text ?? '')))
    .filter(Boolean)
    .slice(0, GROUP_MAX_MESSAGES_PER_TURN);
  if (!isValidGroupThreadId(threadId) || !toolCallId || !botId || texts.length === 0) return null;
  return {
    ...payload,
    threadId,
    toolCallId,
    botId,
    name: String(payload.name ?? '').trim(),
    texts,
  };
}

function groupLateResultPayload(event) {
  if (event?.type === 'user/message') {
    return lateResultPayloadFromSource(event.data?.source ?? event.data?.message?.source);
  }
  if (event?.type !== 'agent/inbox/spliced') return null;
  for (const message of event.data?.inserted ?? []) {
    const payload = lateResultPayloadFromSource(message?.source);
    if (payload) return payload;
  }
  return null;
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {string}
 */
export function lastUserTextFromEvents(events) {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (!isRoomInput(event)) continue;
    const text = roomEventText(event.data.content);
    if (text) return text;
  }
  return '';
}

/**
 * Latest room thread addressed by an admitted user message.
 * @param {readonly object[] | undefined} events
 * @returns {string}
 */
export function activeRoomThreadId(events) {
  const projection = projectRoomEventThreads(events);
  const { list } = projection;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index];
    if (!isRoomInput(event)) continue;
    return projection.threadByIndex.get(index) ?? '';
  }
  return '';
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {string}
 */
export function lastAssistantTextFromEvents(events) {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== 'assistant/message') continue;
    const text = contentText(event.data?.message?.content ?? event.data?.content);
    if (text) return text;
  }
  return '';
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {number}
 */
export function lastAssistantSeqFromEvents(events) {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== 'assistant/message') continue;
    const text = contentText(event.data?.message?.content ?? event.data?.content);
    if (!text) continue;
    return typeof event.seq === 'number' ? event.seq : i;
  }
  return -1;
}

/**
 * @param {object} event
 * @returns {string}
 */
function askParticipantBotId(event) {
  const args = askParticipantArguments(event);
  return typeof args.botId === 'string' ? args.botId : '';
}

function askParticipantArguments(event) {
  const raw = event?.data?.arguments;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function askParticipantThreadId(event, fallback = '') {
  const args = askParticipantArguments(event);
  for (const candidate of [
    args.threadId,
    args.thread,
    args.groupThreadId,
    args.owningThreadId,
    event?.data?.threadId,
    event?.data?.thread,
    event?.data?.groupThreadId,
    event?.data?.owningThreadId,
    event?.threadId,
    event?.thread,
  ]) {
    if (isValidGroupThreadId(candidate)) return String(candidate);
  }
  return fallback;
}

function toolCallIdFromCall(event) {
  return String(event?.data?.callId ?? event?.data?.toolCallId ?? event?.data?.id ?? '');
}

function toolCallIdFromResult(event) {
  return String(
    event?.data?.message?.source?.callId
      ?? event?.data?.message?.source?.toolCallId
      ?? event?.data?.message?.toolCallId
      ?? event?.data?.toolCallId
      ?? '',
  );
}

/**
 * Project raw Harness events onto stable room threads without changing the
 * stored log. Visible legacy entries use Hermes' gap rule; calls and results
 * inherit the projected user thread unless they declare an owning thread.
 */
function projectRoomEventThreads(events) {
  const list = events ?? [];
  const declaredCallThreads = new Map();
  for (const event of list) {
    if (event?.type !== 'tool/call' || event.data?.name !== 'ask_participant') continue;
    const callId = toolCallIdFromCall(event);
    const threadId = askParticipantThreadId(event);
    if (callId && threadId) declaredCallThreads.set(callId, threadId);
  }

  const timeline = [];
  const timelineIndexes = [];
  const projectedLateCarriers = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index];
    const lateResult = groupLateResultPayload(event);
    const carrierId = String(lateResult?.carrierId ?? '').trim();
    if (lateResult && (!carrierId || !projectedLateCarriers.has(carrierId))) {
      if (carrierId) projectedLateCarriers.add(carrierId);
      timeline.push({
        at: Number(event.time ?? 0),
        speaker: { kind: 'member' },
        content: lateResult.texts.join('\n\n'),
        thread: lateResult.threadId,
      });
      timelineIndexes.push(index);
      continue;
    }
    if (lateResult) continue;
    if (isRoomInput(event)) {
      const thread = declaredGroupThreadIdForUserEvent(event);
      timeline.push({
        at: Number(event.time ?? 0),
        speaker: { kind: 'user' },
        content: roomEventText(event.data?.content),
        ...(thread ? { thread } : {}),
      });
      timelineIndexes.push(index);
      continue;
    }
    if (event?.type !== 'tool/result' || classifyGroupTurnOutcome(event) !== GROUP_TURN_STATES.replied) {
      continue;
    }
    const callId = toolCallIdFromResult(event);
    if (!callId) continue;
    const text = memberVisibleText(contentText(event.data?.message?.content ?? event.data?.content));
    if (!text) continue;
    const thread = groupResultThreadId(event) || declaredCallThreads.get(callId) || '';
    timeline.push({
      at: Number(event.time ?? 0),
      speaker: { kind: 'member' },
      content: text,
      ...(thread ? { thread } : {}),
    });
    timelineIndexes.push(index);
  }

  const assigned = assignLegacyThreads(timeline);
  const threadByIndex = new Map();
  for (let index = 0; index < assigned.length; index += 1) {
    threadByIndex.set(timelineIndexes[index], groupThreadOf(assigned[index]));
  }

  const callThreads = new Map();
  let currentThread = '';
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index];
    const lateResult = groupLateResultPayload(event);
    if (lateResult) {
      threadByIndex.set(index, lateResult.threadId);
      continue;
    }
    if (isRoomInput(event)) {
      currentThread = threadByIndex.get(index) ?? '';
      continue;
    }
    if (event?.type === 'tool/call' && event.data?.name === 'ask_participant') {
      const callId = toolCallIdFromCall(event);
      const thread = askParticipantThreadId(event) || currentThread;
      if (callId && thread) callThreads.set(callId, thread);
      if (thread) threadByIndex.set(index, thread);
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = toolCallIdFromResult(event);
    const thread = groupResultThreadId(event) || callThreads.get(callId) || threadByIndex.get(index) || '';
    if (thread) threadByIndex.set(index, thread);
  }

  return { list, threadByIndex, callThreads };
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {number}
 */
function lastUserMessageIndex(events, threadId = activeRoomThreadId(events), projection = projectRoomEventThreads(events)) {
  const { list } = projection;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (!isRoomInput(event)) continue;
    if (projection.threadByIndex.get(i) !== threadId) continue;
    if (roomEventText(event.data.content)) return i;
  }
  return -1;
}

/** Stable identity of the latest admitted room input in one projected thread. */
export function latestRoomInputIdentity(events, threadId = activeRoomThreadId(events)) {
  const projection = projectRoomEventThreads(events);
  const index = lastUserMessageIndex(events, threadId, projection);
  if (index < 0) return '';
  const event = projection.list[index];
  if (event?.seq !== undefined) return `seq:${String(event.seq)}`;
  if (event?.data?.id !== undefined) return `id:${String(event.data.id)}`;
  return `index:${index}`;
}

/**
 * ask_participant attempts after the latest user message. Completed attempts
 * drive the round-robin order; a dangling call (crash-replayed, no result)
 * neither consumes the visible-delivery cap nor advances the queue, so the
 * next dispatch re-asks that member (see nextRoomSpeakerId).
 * @param {readonly object[] | undefined} events
 * @returns {{ botId: string, text: string, completed: boolean, failed: boolean, error?: object }[]}
 */
export function memberTurnAttempts(events, threadId = activeRoomThreadId(events)) {
  const projection = projectRoomEventThreads(events);
  const { list } = projection;
  const start = lastUserMessageIndex(list, threadId, projection);
  if (start < 0) return [];
  const turnByCall = new Map();
  const turns = [];
  for (let i = start + 1; i < list.length; i += 1) {
    const event = list[i];
    if (isRoomInput(event)) continue;
    const lateResult = groupLateResultPayload(event);
    if (lateResult) {
      const turn = turnByCall.get(lateResult.toolCallId);
      if (!turn || lateResult.threadId !== turn.threadId) continue;
      turn.text = lateResult.texts.join('\n\n');
      turn.failed = false;
      turn.completed = true;
      delete turn.error;
      defineGroupMessageMetadata(turn, {
        status: GROUP_TURN_STATES.replied,
        outcome: GROUP_TURN_STATES.replied,
        visibleCount: lateResult.texts.length,
        endIndex: i,
        late: true,
      });
      continue;
    }
    if (event?.type === 'tool/call' && event.data?.name === 'ask_participant') {
      const botId = askParticipantBotId(event);
      const callId = toolCallIdFromCall(event);
      const callThread = projection.threadByIndex.get(i) ?? askParticipantThreadId(event);
      if (callThread !== threadId) continue;
      if (botId && callId && !turnByCall.has(callId)) {
        const turn = { botId, text: '', completed: false, failed: false };
        const args = askParticipantArguments(event);
        const pendingIdentity = {
          threadId: callThread,
          memberSessionId: args.memberSessionId ?? event.data?.memberSessionId,
          requestId: args.requestId ?? event.data?.requestId,
          turn: args.turn ?? event.data?.turn,
          step: args.step ?? event.data?.step,
          toolCallId: callId,
        };
        defineGroupMessageMetadata(turn, {
          callId,
          toolCallId: callId,
          memberSessionId: args.memberSessionId ?? event.data?.memberSessionId,
          requestId: args.requestId ?? event.data?.requestId,
          turn: args.turn ?? event.data?.turn,
          step: args.step ?? event.data?.step,
          threadId: callThread,
          status: GROUP_TURN_STATES.working,
          outcome: GROUP_TURN_STATES.working,
          dispatchPhase: args.groupProtocol?.phase,
          dispatchRound: args.groupProtocol?.round,
          continuationDecision: args.groupProtocol?.continuation,
          continuationTargets: args.groupProtocol?.targets,
          dispatchResponders: args.groupProtocol?.responders,
          pendingId: groupPendingIdentityKey(pendingIdentity),
          startIndex: i,
        });
        turnByCall.set(callId, turn);
        turns.push(turn);
      }
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = toolCallIdFromResult(event);
    const turn = turnByCall.get(callId);
    if (!turn) continue;
    if (turn.completed) continue;
    const resultThread = projection.threadByIndex.get(i) ?? groupResultThreadId(event);
    if (resultThread && resultThread !== turn.threadId) continue;
    const resultContent = event.data?.message?.content ?? event.data?.content;
    turn.text = contentText(resultContent);
    const outcome = classifyGroupTurnOutcome(event);
    const visibleTexts = outcome === GROUP_TURN_STATES.replied
      ? contentTexts(resultContent).map((text) => memberVisibleText(text)).filter(Boolean)
      : [];
    turn.failed = outcome === GROUP_TURN_STATES.failed
      || Boolean(event.data?.error)
      || hasErrorContent(resultContent);
    turn.error = event.data?.error ?? (turn.failed ? { code: 'TOOL_FAILED' } : undefined);
    turn.completed = outcome !== GROUP_TURN_STATES.queued && outcome !== GROUP_TURN_STATES.working;
    defineGroupMessageMetadata(turn, {
      status: outcome,
      outcome,
      visibleCount: visibleTexts.length,
      endIndex: i,
      late: event.data?.late === true || event.data?.message?.late === true,
    });
  }
  return turns;
}

/**
 * Member-visible messages since the latest user message (Grok delivery
 * counting: this is what the maxSpeaks cap consumes).
 * @param {readonly object[] | undefined} events
 * @param {readonly object[]} items
 * @returns {number}
 */
export function visibleMemberMessageCount(events, items, threadId = activeRoomThreadId(events)) {
  const history = eventsToGroupHistory(events, items)
    .filter((message) => groupThreadOf(message) === threadId);
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.speaker.kind === 'user') break;
    if (message.speaker.kind === 'member') count += 1;
  }
  return count;
}

/**
 * Completed ask_participant turns after the latest user message.
 * @param {readonly object[] | undefined} events
 * @returns {{ botId: string, text: string }[]}
 */
export function completedMemberTurns(events, threadId = activeRoomThreadId(events)) {
  return memberTurnAttempts(events, threadId)
    .filter((turn) => turn.completed)
    .map(({ botId, text }) => ({ botId, text }));
}

function attemptStatus(turn) {
  if (typeof turn?.status === 'string') return turn.status;
  if (!turn?.completed) return GROUP_TURN_STATES.working;
  return turn.failed
    ? GROUP_TURN_STATES.failed
    : memberVisibleText(turn.text) ? GROUP_TURN_STATES.replied : GROUP_TURN_STATES.pass;
}

function isTerminalGroupState(status) {
  return ![GROUP_TURN_STATES.queued, GROUP_TURN_STATES.working].includes(status);
}

/** Rich, thread-scoped attempt records. The legacy memberTurnAttempts shape
 * remains unchanged for existing host consumers. */
export function groupThreadAttempts(events, threadId = activeRoomThreadId(events)) {
  return memberTurnAttempts(events, threadId).map((turn) => {
    const pendingIdentity = groupPendingRequestIdentity({
      threadId: turn.threadId ?? threadId,
      memberSessionId: turn.memberSessionId,
      requestId: turn.requestId,
      turn: turn.turn,
      step: turn.step,
      toolCallId: turn.toolCallId ?? turn.callId,
    });
    return {
      botId: turn.botId,
      callId: turn.callId ?? '',
      threadId: turn.threadId ?? threadId,
      text: turn.text,
      completed: Boolean(turn.completed),
      failed: Boolean(turn.failed),
      status: attemptStatus(turn),
      outcome: turn.outcome ?? attemptStatus(turn),
      pendingId: turn.pendingId ?? groupPendingIdentityKey(pendingIdentity),
      pendingIdentity,
      visibleCount: Number.isFinite(turn.visibleCount)
        ? turn.visibleCount
        : (memberVisibleText(turn.text) ? 1 : 0),
      late: Boolean(turn.late),
      dispatchPhase: turn.dispatchPhase === 'continuation' ? 'continuation' : 'normal',
      dispatchRound: Number.isInteger(turn.dispatchRound) ? turn.dispatchRound : undefined,
      continuationDecision: Number.isInteger(turn.continuationDecision)
        ? turn.continuationDecision
        : undefined,
      continuationTargets: Array.isArray(turn.continuationTargets)
        ? turn.continuationTargets.map(String)
        : [],
      dispatchResponders: Array.isArray(turn.dispatchResponders)
        ? turn.dispatchResponders.map(String)
        : [],
      ...(turn.memberSessionId !== undefined ? { memberSessionId: turn.memberSessionId } : {}),
      ...(turn.requestId !== undefined ? { requestId: turn.requestId } : {}),
      ...(turn.turn !== undefined ? { turn: turn.turn } : {}),
      ...(turn.step !== undefined ? { step: turn.step } : {}),
      ...(turn.error ? { error: turn.error } : {}),
      ...(turn.startIndex !== undefined ? { startIndex: turn.startIndex } : {}),
      ...(turn.endIndex !== undefined ? { endIndex: turn.endIndex } : {}),
    };
  });
}

/**
 * Derive event-log cursors for each `(thread, member)` consumer. Terminal
 * pass/failure/result states consume the attempt; a bare timeout/cancellation
 * leaves the cursor in place so a later late result can still be harvested.
 */
export function groupThreadWatermarks(events, threadId = activeRoomThreadId(events)) {
  const watermarks = {};
  for (const turn of groupThreadAttempts(events, threadId)) {
    if (!turn.completed || turn.endIndex === undefined) continue;
    const consumes = [
      GROUP_TURN_STATES.pass,
      GROUP_TURN_STATES.replied,
      GROUP_TURN_STATES.failed,
      GROUP_TURN_STATES.held,
      GROUP_TURN_STATES.stopped,
      GROUP_TURN_STATES.capped,
      GROUP_TURN_STATES.settled,
    ].includes(turn.status);
    if (!consumes) continue;
    const key = groupThreadWatermarkKey(threadId, turn.botId);
    watermarks[key] = Math.max(watermarks[key] ?? 0, turn.endIndex + 1);
  }
  return watermarks;
}

/**
 * Derive the round queue and terminal reason without dispatching anything.
 * A failed attempt consumes its queue slot for the current round (preserving
 * the local adapter contract) but does not count as visible activity for
 * consensus or the delivery cap; pass, timeout, cancellation, and held turns
 * are likewise silent for consensus purposes.
 */
export function groupThreadRoundState(
  events,
  responderIds = [],
  threadId = activeRoomThreadId(events),
  limits = {},
  options = {},
) {
  const ids = [...new Set((Array.isArray(responderIds) ? responderIds : [])
    .map((id) => (id && typeof id === 'object' ? id.id ?? id.name : id))
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))];
  const held = new Set([...(options.heldIds ?? [])].map((id) => String(id)));
  const eligible = ids.filter((id) => !held.has(id));
  const { maxSpeaks, maxRounds } = resolveGroupProtocolLimits(limits);
  const turns = groupThreadAttempts(events, threadId);
  const visibleCount = Number.isFinite(options.visibleCount)
    ? Math.max(0, Math.trunc(options.visibleCount))
    : turns.reduce((count, turn) => count + turn.visibleCount, 0);
  let round = 0;
  let roundsCompleted = 0;
  let queue = orderRoundSpeakers(eligible, round);
  let activeCount = 0;
  let quiet = false;
  let continuationOpen = false;
  let working = false;
  let lastOutcome = turns.length > 0 ? turns.at(-1).status : '';
  const consumedNormal = new Set();

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
    round = roundIndex;
    const recordedResponders = turns.find((turn) => (
      turn.dispatchPhase !== 'continuation'
      && turn.dispatchRound === roundIndex
      && turn.dispatchResponders.length > 0
    ))?.dispatchResponders;
    const roundResponders = Array.isArray(recordedResponders)
      ? recordedResponders.filter((id) => eligible.includes(id))
      : eligible;
    queue = orderRoundSpeakers(roundResponders, roundIndex);
    activeCount = 0;
    working = false;

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      if (consumedNormal.has(turnIndex)) continue;
      const turn = turns[turnIndex];
      if (turn.dispatchPhase === 'continuation') continue;
      if (turn.dispatchRound !== undefined && turn.dispatchRound !== roundIndex) continue;
      const queueIndex = queue.indexOf(turn.botId);
      if (queueIndex < 0) continue;
      consumedNormal.add(turnIndex);
      if (!turn.completed || !isTerminalGroupState(turn.status)) {
        working = true;
        continue;
      }
      queue.splice(queueIndex, 1);
      lastOutcome = turn.status;
      if (turn.status === GROUP_TURN_STATES.replied) activeCount += 1;
    }

    if (queue.length > 0) break;
    roundsCompleted = roundIndex + 1;
    if (activeCount > 0) {
      if (roundsCompleted >= maxRounds) break;
      continue;
    }

    const continuationTurns = turns.filter((turn) => (
      turn.dispatchPhase === 'continuation' && turn.dispatchRound === roundIndex
    ));
    const currentDecision = continuationTurns.at(-1)?.continuationDecision;
    const decisionTurns = currentDecision === undefined
      ? continuationTurns
      : continuationTurns.filter((turn) => turn.continuationDecision === currentDecision);
    if (decisionTurns.some((turn) => !turn.completed)) {
      working = true;
      break;
    }
    const continuationTargets = decisionTurns.find((turn) => turn.continuationTargets.length > 0)
      ?.continuationTargets ?? [];
    if (continuationTargets.some((id) => !decisionTurns.some((turn) => turn.botId === id))) {
      continuationOpen = true;
      quiet = true;
      break;
    }
    const continuationReplies = decisionTurns.filter((turn) => (
      turn.completed && turn.status === GROUP_TURN_STATES.replied
    ));
    if (continuationReplies.length > 0) {
      activeCount = continuationReplies.reduce((count, turn) => count + Math.max(1, turn.visibleCount), 0);
      lastOutcome = continuationReplies.at(-1).status;
      if (roundsCompleted >= maxRounds) break;
      continue;
    }
    if (continuationTurns.length > 0) lastOutcome = continuationTurns.at(-1).status;
    quiet = true;
    break;
  }

  let status = GROUP_TURN_STATES.queued;
  if (visibleCount >= maxSpeaks) {
    status = GROUP_TURN_STATES.capped;
  } else if (eligible.length === 0 && ids.length > 0) {
    status = GROUP_TURN_STATES.held;
  } else if (working) {
    status = GROUP_TURN_STATES.working;
  } else if (quiet) {
    status = [
      GROUP_TURN_STATES.failed,
      GROUP_TURN_STATES['timed-out'],
      GROUP_TURN_STATES.cancelled,
      GROUP_TURN_STATES.held,
      GROUP_TURN_STATES.stopped,
    ].includes(lastOutcome)
      ? lastOutcome
      : GROUP_TURN_STATES.settled;
  } else if (roundsCompleted >= maxRounds && activeCount > 0) {
    status = GROUP_TURN_STATES.capped;
  } else if (lastOutcome && [
    GROUP_TURN_STATES.failed,
    GROUP_TURN_STATES['timed-out'],
    GROUP_TURN_STATES.cancelled,
    GROUP_TURN_STATES.held,
    GROUP_TURN_STATES.stopped,
  ].includes(lastOutcome) && queue.length > 0) {
    status = lastOutcome;
  }

  return {
    threadId,
    round,
    roundsCompleted,
    maxSpeaks,
    maxRounds,
    visibleCount,
    queue,
    nextBotId: queue[0],
    status,
    lastOutcome,
    responders: ids,
    heldIds: [...held],
    quiet,
    continuationOpen,
  };
}

/**
 * Build Grok-shaped GroupMessage[] from room session events.
 * @param {readonly object[] | undefined} events
 * @param {readonly object[]} items
 * @returns {import('./group-chat.js').GroupMessage[]}
 */
export function eventsToGroupHistory(events, items) {
  /** @type {import('./group-chat.js').GroupMessage[]} */
  const messages = [];
  const namesByCall = new Map();
  const projection = projectRoomEventThreads(events);
  const { list } = projection;
  const visibleLateCarriers = new Set();
  for (let eventIndex = 0; eventIndex < list.length; eventIndex += 1) {
    const event = list[eventIndex];
    const lateResult = groupLateResultPayload(event);
    const carrierId = String(lateResult?.carrierId ?? '').trim();
    if (lateResult && (!carrierId || !visibleLateCarriers.has(carrierId))) {
      if (carrierId) visibleLateCarriers.add(carrierId);
      const name = lateResult.name || memberDisplayName(items, lateResult.botId);
      lateResult.texts.forEach((text, deliveryIndex) => {
        const message = {
          speaker: { kind: 'member', id: lateResult.botId, name },
          content: text,
        };
        defineGroupMessageMetadata(message, {
          id: `e${event.seq ?? eventIndex}:late:${deliveryIndex}`,
          eventIndex,
          at: Number(event.time ?? 0),
          thread: lateResult.threadId,
          state: GROUP_TURN_STATES.replied,
          callId: lateResult.toolCallId,
          late: true,
        });
        messages.push(message);
      });
      continue;
    }
    if (lateResult) continue;
    if (event?.type === 'user/message') {
      if (!isRoomInput(event)) continue;
      const currentThread = projection.threadByIndex.get(eventIndex) ?? '';
      const text = roomEventText(event.data.content);
      const attachments = (Array.isArray(event.data.content) ? event.data.content : [])
        .filter((block) => (block?.type === 'image' || block?.type === 'file') && block.attachment !== undefined)
        .map((block) => ({ type: block.type, attachment: block.attachment }));
      if (text) {
        const message = {
          speaker: { kind: 'user' },
          content: text,
        };
        defineGroupMessageMetadata(message, {
          id: `e${event.seq ?? eventIndex}`,
          eventIndex,
          at: Number(event.time ?? 0),
          thread: currentThread,
          ...(attachments.length > 0 ? { attachments } : {}),
          state: GROUP_TURN_STATES.queued,
        });
        messages.push(message);
      }
      continue;
    }
    if (event?.type === 'tool/call' && event.data?.name === 'ask_participant') {
      const botId = askParticipantBotId(event);
      const callId = toolCallIdFromCall(event);
      namesByCall.set(callId, {
        id: botId,
        name: memberDisplayName(items, botId),
        thread: projection.threadByIndex.get(eventIndex) ?? askParticipantThreadId(event),
        callIndex: eventIndex,
      });
      continue;
    }
    if (event?.type === 'tool/result') {
      const callId = toolCallIdFromResult(event);
      const author = namesByCall.get(callId);
      if (!author?.id) continue;
      const resultThread = projection.threadByIndex.get(eventIndex) ?? groupResultThreadId(event);
      if (resultThread && resultThread !== author.thread) continue;
      // Grok parity: each send_room_message delivery is its own visible
      // history entry; a two-message member turn must not collapse into one.
      const resultContent = event.data?.message?.content ?? event.data?.content;
      if (classifyGroupTurnOutcome(event) !== GROUP_TURN_STATES.replied) continue;
      let deliveryIndex = 0;
      for (const raw of contentTexts(resultContent)) {
        const text = memberVisibleText(raw);
        if (text) {
          const message = {
            speaker: { kind: 'member', id: author.id, name: author.name },
            content: text,
          };
          defineGroupMessageMetadata(message, {
            id: `e${event.seq ?? eventIndex}:${deliveryIndex}`,
            eventIndex,
            at: Number(event.time ?? 0),
            thread: author.thread,
            state: GROUP_TURN_STATES.replied,
            callId,
            attemptIndex: author.callIndex,
          });
          messages.push(message);
          deliveryIndex += 1;
        }
      }
    }
  }
  return messages;
}

/**
 * @param {readonly object[]} items
 * @param {object} room
 * @returns {import('./group-chat.js').GroupMember[]}
 */
export function roomMembersFromCatalog(items, room) {
  const members = [];
  for (const id of room.memberBotIds ?? []) {
    const bot = items.find((entry) => entry.id === id && entry.kind !== 'room');
    if (!bot) continue;
    members.push({
      id: bot.id,
      name: botDisplayName(bot, bot.id),
      description: typeof bot.description === 'string' ? bot.description : '',
    });
  }
  return members;
}

/**
 * Catalog adapter over parseGroupMentions (member objects).
 * @param {readonly object[]} items
 * @param {readonly string[]} memberIds
 * @param {string | undefined} userText
 * @returns {{ everyone: boolean, botIds: string[] }}
 */
export function parseGroupMentions(items, memberIds, userText) {
  const members = memberIds
    .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
    .filter(Boolean)
    .map((bot) => ({ id: bot.id, name: stableBotName(bot) }));
  const parsed = parseGroupMentionsCore(String(userText ?? ''), members);
  const botIds = parsed.isEveryone || parsed.memberIds.length === 0
    ? [...memberIds]
    : parsed.memberIds;
  return { everyone: parsed.isEveryone, botIds };
}

/** Direct mention parse for protocol reducers. Unlike parseGroupMentions,
 * this does not turn an unmentioned user message into an all-member target. */
export function directGroupMentionTargets(items, memberIds, userText) {
  const members = memberIds
    .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
    .filter(Boolean)
    .map((bot) => ({ id: bot.id, name: stableBotName(bot) }));
  const parsed = parseGroupMentionsCore(String(userText ?? ''), members);
  return {
    everyone: parsed.isEveryone,
    memberIds: parsed.memberIds,
  };
}

/**
 * Reduce user/relay directives into the room-scoped hold map. A thread id is
 * recorded only as provenance in each stamp; it never keys the hold itself.
 * @param {readonly object[] | undefined} events
 * @param {readonly object[]} items
 * @param {object | readonly string[]} roomOrMemberIds
 * @param {Record<string, object>} [initial]
 * @returns {Record<string, object>}
 */
export function groupHoldsFromEvents(events, items, roomOrMemberIds, initial = {}) {
  const memberIds = Array.isArray(roomOrMemberIds)
    ? roomOrMemberIds
    : Array.isArray(roomOrMemberIds?.memberBotIds) ? roomOrMemberIds.memberBotIds : [];
  const members = roomMembersFromCatalog(items, { memberBotIds: memberIds });
  const projection = projectRoomEventThreads(events);
  let holds = initial && typeof initial === 'object' ? initial : {};
  for (let index = 0; index < projection.list.length; index += 1) {
    const event = projection.list[index];
    if (!isRoomHoldInput(event)) continue;
    const text = roomEventText(event.data?.content);
    if (!text) continue;
    const parsed = parseGroupMentionsCore(text, members);
    holds = applyGroupHoldDirective(
      holds,
      { mentioned: parsed.memberIds, everyone: parsed.isEveryone },
      text,
      {
        at: Number.isFinite(event.time) ? event.time : index,
        byMessageId: String(eventIdentity(event, index)),
        thread: projection.threadByIndex.get(index) ?? '',
      },
      memberIds,
    );
  }
  return holds;
}

/** Catalog/event-log adapter for the pure log-order handoff detector. */
export function unaddressedGroupMentions(
  events,
  items,
  threadId = activeRoomThreadId(events),
  roomOrMemberIds,
) {
  const memberBotIds = Array.isArray(roomOrMemberIds)
    ? roomOrMemberIds
    : Array.isArray(roomOrMemberIds?.memberBotIds)
      ? roomOrMemberIds.memberBotIds
      : items.filter((entry) => entry.kind !== 'room').map((entry) => entry.id);
  const members = roomMembersFromCatalog(items, { memberBotIds });
  return unaddressedGroupMentionsCore(eventsToGroupHistory(events, items), members, threadId || undefined);
}

export const pendingGroupHandoffs = unaddressedGroupMentions;

/**
 * @param {readonly object[]} items
 * @param {readonly string[]} memberIds
 * @param {string | undefined} userText
 * @returns {string[]}
 */
export function mentionedBotIds(items, memberIds, userText) {
  return parseGroupMentions(items, memberIds, userText).botIds;
}

/**
 * @param {readonly object[]} items
 * @param {readonly string[]} memberIds
 * @param {string | undefined} userText
 * @returns {string[]}
 */
export function roomSpeakerIds(items, memberIds, userText) {
  const members = memberIds
    .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
    .filter(Boolean)
    .map((bot) => ({
      id: bot.id,
      name: stableBotName(bot),
      description: typeof bot.description === 'string' ? bot.description : '',
    }));
  const history = userText
    ? [{ speaker: { kind: 'user' }, content: String(userText) }]
    : [];
  return resolveResponders(members, history).map((member) => member.id);
}

/**
 * Legacy NEXT parse for old logs only (not used for scheduling).
 * @param {string | undefined} text
 */
export function parseRoomNext(text) {
  const raw = String(text ?? '').replace(/[ \t]+$/gm, '').replace(/\s+$/u, '');
  const lines = raw.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const match = last.match(/^NEXT:\s*(.*)$/i);
  if (!match) return { kind: 'pass', names: [], visible: raw };
  const visible = lines.slice(0, -1).join('\n').replace(/\s+$/u, '');
  return { kind: 'pass', names: [], visible };
}

/**
 * @param {string | undefined} text
 * @returns {string}
 */
export function stripRoomNext(text) {
  return stripLegacyNextFooter(text);
}

/**
 * Next member id for Harness llm/stream chain (Grok round-robin via history).
 * @param {readonly object[]} items
 * @param {object} room
 * @param {readonly object[] | undefined} events
 * @param {{ maxSpeaks?: number, maxRounds?: number }} [limits]
 * @returns {string | undefined}
 */
function nextRoomDispatch(items, room, events, limits = {}, threadId = activeRoomThreadId(events)) {
  const history = eventsToGroupHistory(events, items)
    .filter((message) => groupThreadOf(message) === threadId);
  if (!history.some((message) => message.speaker.kind === 'user')) return undefined;
  if (room?.status === GROUP_TURN_STATES.stopped || room?.stopped === true) return undefined;
  const { maxSpeaks } = resolveGroupProtocolLimits(limits);
  const members = roomMembersFromCatalog(items, room);
  if (members.length === 0) return undefined;
  // Speaker labels are display-only. Keep responder mention parsing pinned to
  // the stable catalog names even when the visible history uses a title.
  const routingHistory = history.map((message) => {
    if (message.speaker.kind !== 'member') return message;
    const bot = items.find((entry) => entry.id === message.speaker.id && entry.kind !== 'room');
    return bot
      ? copyGroupMessage(message, { speaker: { ...message.speaker, name: stableBotName(bot) } })
      : message;
  });
  const routingMembers = members.map((member) => {
    const bot = items.find((entry) => entry.id === member.id && entry.kind !== 'room');
    return bot ? { ...member, name: stableBotName(bot) } : member;
  });
  const responders = resolveResponders(routingMembers, routingHistory).map((member) => member.id);
  if (responders.length === 0) return undefined;
  const holds = room?.holdCheckpoint && typeof room.holdCheckpoint === 'object'
    ? (room.holdCheckpoint.holds ?? room.holds ?? {})
    : groupHoldsFromEvents(events, items, room, room?.holds ?? {});
  const heldIds = new Set(Object.keys(holds));
  const eligibleResponders = responders.filter((id) => !heldIds.has(id));
  if (eligibleResponders.length === 0) return undefined;
  // Grok parity: maxSpeaks caps visible delivered messages only. Pass turns,
  // member failures, and dangling replayed calls do not consume it; total
  // attempts stay bounded by the all-pass-round stop and maxRounds below.
  const visibleCount = visibleMemberMessageCount(events, items, threadId);
  if (visibleCount >= maxSpeaks) return undefined;
  const turns = groupThreadAttempts(events, threadId);
  const round = groupThreadRoundState(
    events,
    eligibleResponders,
    threadId,
    limits,
    { heldIds, visibleCount },
  );
  if (round.nextBotId) {
    return {
      botId: round.nextBotId,
      protocol: {
        phase: 'normal',
        round: round.round,
        responders: eligibleResponders,
      },
    };
  }

  // Hermes only considers handoff continuation after a completed normal round
  // produced no visible reply. The continuation remains part of that bounded
  // round; a reply at the max round ends capped instead of starting another.
  if ((!round.quiet && !round.continuationOpen) || round.round >= round.maxRounds) return undefined;
  const pendingDetails = unaddressedGroupMentionDetailsCore(
    routingHistory,
    routingMembers,
    threadId,
  );
  const actionable = pendingDetails
    .map((detail) => detail.memberId)
    .filter((id) => !heldIds.has(id));
  if (actionable.length === 0) return undefined;

  const continuationTurns = turns.filter((turn) => turn.dispatchPhase === 'continuation');
  const decisionKey = (turn) => Number.isInteger(turn.continuationDecision)
    ? `decision:${turn.continuationDecision}`
    : `legacy:${turn.startIndex ?? turn.callId}`;
  const decisionKeys = [...new Set(continuationTurns.map(decisionKey))];
  const currentRoundTurns = continuationTurns.filter((turn) => turn.dispatchRound === round.round);
  if (currentRoundTurns.length > 0) {
    const currentKey = decisionKey(currentRoundTurns.at(-1));
    const currentDecisionTurns = currentRoundTurns.filter((turn) => decisionKey(turn) === currentKey);
    const recordedTargets = currentDecisionTurns.find((turn) => turn.continuationTargets.length > 0)
      ?.continuationTargets;
    const targets = Array.isArray(recordedTargets) ? recordedTargets : actionable;
    const pendingTarget = targets.find((id) => (
      !heldIds.has(id)
      && !currentDecisionTurns.some((turn) => turn.botId === id)
    ));
    if (!pendingTarget) return undefined;
    return {
      botId: pendingTarget,
      protocol: {
        phase: 'continuation',
        round: round.round,
        continuation: currentDecisionTurns.at(-1).continuationDecision,
        targets,
        responders: eligibleResponders,
      },
    };
  }

  if (decisionKeys.length >= GROUP_MAX_CONTINUATIONS) return undefined;
  return {
    botId: actionable[0],
    protocol: {
      phase: 'continuation',
      round: round.round,
      continuation: decisionKeys.length + 1,
      targets: actionable,
      responders: eligibleResponders,
    },
  };
}

export function nextRoomSpeakerId(items, room, events, limits = {}, threadId = activeRoomThreadId(events)) {
  return nextRoomDispatch(items, room, events, limits, threadId)?.botId;
}

/**
 * Complete pure projection for one local room thread. Room-level holds and
 * membership are kept separate from the returned thread-owned attempts,
 * watermarks, caps, and pending handoffs.
 */
export function deriveGroupThreadState(items, room, events, options = {}) {
  const threadId = options.threadId ?? activeRoomThreadId(events);
  const members = roomMembersFromCatalog(items, room);
  const history = eventsToGroupHistory(events, items)
    .filter((message) => groupThreadOf(message) === threadId);
  const routingMembers = members.map((member) => {
    const bot = items.find((entry) => entry.id === member.id && entry.kind !== 'room');
    return bot ? { ...member, name: stableBotName(bot) } : member;
  });
  const routingHistory = history.map((message) => {
    if (message.speaker.kind !== 'member') return message;
    const bot = items.find((entry) => entry.id === message.speaker.id && entry.kind !== 'room');
    return bot
      ? copyGroupMessage(message, { speaker: { ...message.speaker, name: stableBotName(bot) } })
      : message;
  });
  const responders = resolveResponders(routingMembers, routingHistory).map((member) => member.id);
  const holds = room?.holdCheckpoint && typeof room.holdCheckpoint === 'object'
    ? (room.holdCheckpoint.holds ?? room.holds ?? {})
    : groupHoldsFromEvents(events, items, room, room?.holds ?? {});
  const heldIds = Object.keys(holds);
  const attempts = groupThreadAttempts(events, threadId);
  const watermarks = groupThreadWatermarks(events, threadId);
  const visibleCount = visibleMemberMessageCount(events, items, threadId);
  const pendingHandoffs = unaddressedGroupMentionsCore(routingHistory, routingMembers, threadId);
  const continuationAttempts = attempts.filter((attempt) => attempt.dispatchPhase === 'continuation');
  const continuationCount = new Set(continuationAttempts.map((attempt) => (
    Number.isInteger(attempt.continuationDecision)
      ? `decision:${attempt.continuationDecision}`
      : `legacy:${attempt.startIndex ?? attempt.callId}`
  ))).size;
  const limits = options.limits ?? room;
  const round = groupThreadRoundState(
    events,
    responders,
    threadId,
    limits,
    { heldIds, visibleCount },
  );
  const stopped = room?.status === GROUP_TURN_STATES.stopped || room?.stopped === true;
  const hasUser = history.some((message) => message.speaker.kind === 'user');
  const nextDispatch = stopped ? undefined : nextRoomDispatch(items, room, events, limits, threadId);
  const nextBotId = nextDispatch?.botId;
  const continuationCapReached = round.quiet
    && pendingHandoffs.length > 0
    && continuationCount >= GROUP_MAX_CONTINUATIONS
    && nextDispatch?.protocol?.phase !== 'continuation';
  let status = round.status;
  if (stopped) status = GROUP_TURN_STATES.stopped;
  else if (!hasUser) status = GROUP_TURN_STATES.queued;
  else if (visibleCount >= round.maxSpeaks) status = GROUP_TURN_STATES.capped;
  else if (round.status === GROUP_TURN_STATES.settled && pendingHandoffs.length > 0) {
    status = nextDispatch?.protocol?.phase === 'continuation'
      ? GROUP_TURN_STATES.queued
      : (continuationCapReached ? GROUP_TURN_STATES.capped : GROUP_TURN_STATES.settled);
  }

  return {
    threadId,
    target: threadId ? replyGroupThreadTarget(threadId) : mainGroupThreadTarget(),
    active: hasUser,
    members: members.map((member) => member.id),
    responders,
    holds,
    heldIds,
    attempts,
    outcomes: attempts,
    watermarks,
    pendingHandoffs,
    visibleCount,
    visibleCap: round.maxSpeaks,
    round: round.round,
    roundsCompleted: round.roundsCompleted,
    maxRounds: round.maxRounds,
    maxContinuations: GROUP_MAX_CONTINUATIONS,
    continuationCount,
    continuationCapReached,
    continuationAvailable: nextDispatch?.protocol?.phase === 'continuation',
    lastOutcome: attempts.at(-1)?.status ?? '',
    status,
    nextBotId,
    canDispatch: Boolean(nextBotId) && !stopped,
  };
}

export const groupThreadState = deriveGroupThreadState;
export const threadStateForRoom = deriveGroupThreadState;

/**
 * Turn prompt for the next speaker (Grok buildGroupTurnPrompt).
 * @param {readonly object[]} items
 * @param {object} room
 * @param {readonly object[] | undefined} events
 * @param {string} speakerId
 * @returns {string}
 */
export function roomTurnPromptForSpeaker(items, room, events, speakerId, threadId = activeRoomThreadId(events)) {
  const members = roomMembersFromCatalog(items, room);
  const member = members.find((entry) => entry.id === speakerId);
  if (!member) return '';
  const peers = members.filter((entry) => entry.id !== speakerId);
  const history = eventsToGroupHistory(events, items)
    .filter((message) => groupThreadOf(message) === threadId);
  const group = {
    name: String(room.name ?? 'Group'),
    description: String(room.description ?? ''),
  };
  // Spawned member turns have no retained model conversation. Supply the shared
  // room history, including the user's instructions and this member's own reply.
  return buildGroupTurnPrompt({ member, group, peers, newMessages: history, fullHistory: true });
}

/**
 * Build the member user message with actual attachment references from the
 * latest room input. Older attachments remain represented by the durable room
 * prompt but are not re-admitted into every later member turn.
 * @param {readonly object[]} items
 * @param {object} room
 * @param {readonly object[] | undefined} events
 * @param {string} speakerId
 * @param {string} [promptText]
 * @returns {object[]}
 */
export function roomTurnPromptContentForSpeaker(items, room, events, speakerId, promptText, includeAttachments = true, threadId = activeRoomThreadId(events)) {
  const list = events ?? [];
  const index = lastUserMessageIndex(list, threadId);
  const content = index >= 0 ? list[index]?.data?.content : undefined;
  const attachments = includeAttachments
    ? (Array.isArray(content) ? content : []).filter((block) => (
      (block?.type === 'image' || block?.type === 'file')
      && block.attachment !== undefined
    ))
    : [];
  return [
    { type: 'text', text: promptText ?? roomTurnPromptForSpeaker(items, room, events, speakerId, threadId) },
    ...attachments,
  ];
}

/**
 * Display transcript helper for tools / tests.
 * @param {readonly object[] | undefined} events
 * @param {readonly object[]} items
 * @returns {string}
 */
export function groupTranscript(events, items) {
  return eventsToGroupHistory(events, items)
    .map((message) => {
      if (message.speaker.kind === 'user') return `[用户]\n${message.content}`;
      return `[${message.speaker.name}]\n${message.content}`;
    })
    .join('\n');
}

/**
 * @param {string} botId
 * @param {string} instruction
 * @param {string} callId
 * @returns {object[]}
 */
export function askParticipantStreamChunks(botId, instruction, callId, threadId = '', groupProtocol) {
  const argumentsJson = JSON.stringify({
    botId,
    instruction,
    ...(threadId ? { threadId } : {}),
    ...(groupProtocol ? { groupProtocol } : {}),
  });
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name: 'ask_participant', argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'ask_participant', arguments: argumentsJson },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

/**
 * @returns {object[]}
 */
export function emptyStopChunks() {
  return [{ type: 'finish', reason: { kind: 'stop' } }];
}

/**
 * One sequential ask_participant call, or stop after the last speaker.
 * Bumps room turn epoch when the last user message has no completed turns yet.
 * @param {{ items: readonly object[], sessionId?: string, events?: readonly object[], callId: string, maxSpeaks?: number, maxRounds?: number, bumpEpoch?: boolean }} opts
 * @returns {object[] | null}
 */
export function roomDispatchChunks(opts) {
  const room = catalogRoom(opts.items, opts.sessionId);
  if (!room) return null;
  const threadId = activeRoomThreadId(opts.events);
  if (!threadId) return emptyStopChunks();
  const dispatch = nextRoomDispatch(opts.items, room, opts.events, {
    maxSpeaks: opts.maxSpeaks,
    maxRounds: opts.maxRounds,
  }, threadId);
  if (!dispatch) return emptyStopChunks();
  const instruction = roomTurnPromptForSpeaker(opts.items, room, opts.events, dispatch.botId, threadId);
  return askParticipantStreamChunks(
    dispatch.botId,
    instruction,
    opts.callId,
    threadId,
    dispatch.protocol,
  );
}

/**
 * @returns {string}
 */
export function newCatalogId() {
  return globalThis.crypto?.randomUUID?.() ?? `dshbot-${Date.now().toString(36)}`;
}

/**
 * Payload for `sessions.create` of a 1:1 bot or room parent.
 * @param {{ workspaceId?: string, agentPreset?: string, scratchCwd?: string }} opts
 */
export function sessionCreatePayload(opts = {}) {
  return {
    ...(opts.agentPreset ? { agentPreset: opts.agentPreset } : {}),
    ...(opts.workspaceId
      ? { workspaceId: opts.workspaceId }
      : (opts.scratchCwd ? { cwd: opts.scratchCwd } : {})),
  };
}
