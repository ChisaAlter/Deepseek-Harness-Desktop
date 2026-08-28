/**
 * Pure catalog helpers for dshbot contacts and rooms.
 * Host apply, the room tool, and node:test share this module.
 * Group protocol symbols live in group-chat.js (Grok-aligned).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_MIN_MEMBERS,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  isPassContent,
  memberVisibleText,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  parseGroupMentions as parseGroupMentionsCore,
  resolveResponders,
  stripLegacyNextFooter,
} from './group-chat.js';

export {
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_MIN_MEMBERS,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  isPassContent,
  isPotentialPassPrefix,
  isSameMemberSet,
  memberVisibleText,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  resolveResponders,
  stripLegacyNextFooter,
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

/** Spawn-time overlay so the child complete prompt can see the member persona. */
export const memberPersona = new AsyncLocalStorage();

/**
 * Convert a failed member operation to the protocol's silent pass result.
 * @param {{ id?: string, name?: string }} bot
 * @param {() => Promise<{ botId: string, name: string, text: string, texts: string[] }>} operation
 * @returns {Promise<{ botId: string, name: string, text: string, texts: string[] }>}
 */
export async function memberTurnOrPass(bot, operation) {
  try {
    return await operation();
  } catch {
    return {
      botId: String(bot?.id ?? ''),
      name: String(bot?.name ?? '') || 'Bot',
      text: '',
      texts: [],
    };
  }
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
  if (typeof byId?.name === 'string' && byId.name) return byId.name;
  const named = items.filter((entry) => entry.kind !== 'room' && entry.name === id);
  if (named.length === 1 && typeof named[0].name === 'string') return named[0].name;
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
    name: String(bot?.name ?? '').trim() || 'Bot',
    description: typeof bot?.description === 'string' ? bot.description : '',
  };
  const peers = others.map((entry) => ({
    id: String(entry?.id ?? ''),
    name: String(entry?.name ?? '').trim() || 'Bot',
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
    throw new Error(`ask_participant: bot ${botId} is not a member of this room`);
  }
  const bot = items.find((entry) => entry.id === resolvedId);
  if (!bot || bot.kind === 'room') {
    throw new Error(`ask_participant: unknown bot ${botId}`);
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

/**
 * @param {readonly object[] | undefined} events
 * @returns {string}
 */
export function lastUserTextFromEvents(events) {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    const text = contentText(event.data.content);
    if (text) return text;
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
    const text = contentText(event.data?.content);
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
    const text = contentText(event.data?.content);
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
  const raw = event.data?.arguments;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.botId === 'string') {
    return raw.botId;
  }
  try {
    const args = JSON.parse(typeof raw === 'string' ? raw : '{}');
    return typeof args.botId === 'string' ? args.botId : '';
  } catch {
    return '';
  }
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {number}
 */
function lastUserMessageIndex(events) {
  const list = events ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    if (contentText(event.data.content)) return i;
  }
  return -1;
}

/**
 * ask_participant attempts after the latest user message. Completed attempts
 * drive the round-robin order; a dangling call (crash-replayed, no result)
 * neither consumes the visible-delivery cap nor advances the queue, so the
 * next dispatch re-asks that member (see nextRoomSpeakerId).
 * @param {readonly object[] | undefined} events
 * @returns {{ botId: string, text: string, completed: boolean }[]}
 */
export function memberTurnAttempts(events) {
  const list = events ?? [];
  const start = lastUserMessageIndex(list);
  if (start < 0) return [];
  const turnByCall = new Map();
  const turns = [];
  for (let i = start + 1; i < list.length; i += 1) {
    const event = list[i];
    if (event?.type === 'tool/call' && event.data?.name === 'ask_participant') {
      const botId = askParticipantBotId(event);
      const callId = event.data.callId;
      if (botId && callId && !turnByCall.has(callId)) {
        const turn = { botId, text: '', completed: false };
        turnByCall.set(callId, turn);
        turns.push(turn);
      }
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = event.data?.message?.source?.callId;
    const turn = turnByCall.get(callId);
    if (!turn) continue;
    turn.text = contentText(event.data.message?.content);
    turn.completed = true;
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
export function visibleMemberMessageCount(events, items) {
  const history = eventsToGroupHistory(events, items);
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
export function completedMemberTurns(events) {
  return memberTurnAttempts(events)
    .filter((turn) => turn.completed)
    .map(({ botId, text }) => ({ botId, text }));
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
  for (const event of events ?? []) {
    if (event?.type === 'user/message') {
      if (event.data?.source?.kind !== 'user') continue;
      const text = contentText(event.data.content);
      if (text) messages.push({ speaker: { kind: 'user' }, content: text });
      continue;
    }
    if (event?.type === 'tool/call' && event.data?.name === 'ask_participant') {
      const botId = askParticipantBotId(event);
      namesByCall.set(event.data.callId, {
        id: botId,
        name: memberDisplayName(items, botId),
      });
      continue;
    }
    if (event?.type === 'tool/result') {
      const callId = event.data?.message?.source?.callId;
      const author = namesByCall.get(callId);
      if (!author?.id) continue;
      // Grok parity: each send_room_message delivery is its own visible
      // history entry; a two-message member turn must not collapse into one.
      for (const raw of contentTexts(event.data.message?.content)) {
        const text = memberVisibleText(raw);
        if (text) {
          messages.push({
            speaker: { kind: 'member', id: author.id, name: author.name },
            content: text,
          });
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
      name: String(bot.name ?? '').trim() || bot.id,
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
    .map((bot) => ({ id: bot.id, name: String(bot.name ?? '') }));
  const parsed = parseGroupMentionsCore(String(userText ?? ''), members);
  const botIds = parsed.isEveryone || parsed.memberIds.length === 0
    ? [...memberIds]
    : parsed.memberIds;
  return { everyone: parsed.isEveryone, botIds };
}

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
  const members = roomMembersFromCatalog(items, { memberBotIds: memberIds });
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
export function nextRoomSpeakerId(items, room, events, limits = {}) {
  const history = eventsToGroupHistory(events, items);
  if (!history.some((message) => message.speaker.kind === 'user')) return undefined;
  const { maxSpeaks, maxRounds } = resolveGroupProtocolLimits(limits);
  const members = roomMembersFromCatalog(items, room);
  if (members.length === 0) return undefined;
  const responders = resolveResponders(members, history).map((member) => member.id);
  if (responders.length === 0) return undefined;
  // Grok parity: maxSpeaks caps visible delivered messages only. Pass turns,
  // member failures, and dangling replayed calls do not consume it; total
  // attempts stay bounded by the all-pass-round stop and maxRounds below.
  if (visibleMemberMessageCount(events, items) >= maxSpeaks) return undefined;
  const turns = memberTurnAttempts(events);

  let round = 0;
  let queue = orderRoundSpeakers(responders, round);
  let nonPassThisRound = 0;
  let roundsCompleted = 0;

  for (const turn of turns) {
    if (!turn.completed) continue;
    const at = queue.indexOf(turn.botId);
    if (at >= 0) queue.splice(at, 1);
    if (memberVisibleText(turn.text)) nonPassThisRound += 1;
    if (queue.length > 0) continue;
    roundsCompleted += 1;
    if (nonPassThisRound === 0) return undefined;
    if (roundsCompleted >= maxRounds) return undefined;
    round += 1;
    queue = orderRoundSpeakers(responders, round);
    nonPassThisRound = 0;
  }

  return queue[0];
}

/**
 * Turn prompt for the next speaker (Grok buildGroupTurnPrompt).
 * @param {readonly object[]} items
 * @param {object} room
 * @param {readonly object[] | undefined} events
 * @param {string} speakerId
 * @returns {string}
 */
export function roomTurnPromptForSpeaker(items, room, events, speakerId) {
  const members = roomMembersFromCatalog(items, room);
  const member = members.find((entry) => entry.id === speakerId);
  if (!member) return '';
  const peers = members.filter((entry) => entry.id !== speakerId);
  const history = eventsToGroupHistory(events, items);
  const newMessages = messagesSinceMemberLastSpoke(history, speakerId);
  const group = {
    name: String(room.name ?? 'Group'),
    description: String(room.description ?? ''),
  };
  return buildGroupTurnPrompt({ member, group, peers, newMessages });
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
export function askParticipantStreamChunks(botId, instruction, callId) {
  const argumentsJson = JSON.stringify({ botId, instruction });
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
  const speaker = nextRoomSpeakerId(opts.items, room, opts.events, {
    maxSpeaks: opts.maxSpeaks,
    maxRounds: opts.maxRounds,
  });
  if (!speaker) return emptyStopChunks();
  const instruction = roomTurnPromptForSpeaker(opts.items, room, opts.events, speaker);
  return askParticipantStreamChunks(speaker, instruction, opts.callId);
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
    origin: 'dshbot',
    ...(opts.agentPreset ? { agentPreset: opts.agentPreset } : {}),
    ...(opts.workspaceId
      ? { workspaceId: opts.workspaceId }
      : (opts.scratchCwd ? { cwd: opts.scratchCwd } : {})),
  };
}
