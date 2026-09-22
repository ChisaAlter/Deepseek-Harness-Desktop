/**
 * Pure group-chat protocol (Grok group-chat.ts semantics, self-written).
 * Room-visible delivery tool name in dshbot is send_room_message.
 */

export const GROUP_CONFIG_VERSION = 1;
export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 6;
export const GROUP_MAX_MEMBER_TURNS = 10;
export const GROUP_MAX_ROUNDS = 3;
/** Hermes' independent continuation bound for member-to-member handoffs. */
export const GROUP_MAX_CONTINUATIONS = 2;
/** Total visible room deliveries allowed for one user-driven thread. */
export const GROUP_MAX_MESSAGES = GROUP_MAX_MEMBER_TURNS;
export const GROUP_PROMPT_HISTORY_LIMIT = 24;
export const GROUP_MAX_MESSAGES_PER_TURN = 2;
export const SHARED_ROOM_HISTORY_LIMIT = 24;
export const GROUP_CHAT_TAG_PREFIX = '[Group chat: ';
export const SAND_HIDDEN_PROMPT_MARKER = '[SAND_HIDDEN_PROMPT]';
export const GROUP_THREAD_REPLY_PREFIX = '[DSHBOT_THREAD_REPLY:';
/** A legacy room stays in one read-time thread across ordinary follow-ups
 * until the user has been quiet for this long. */
export const GROUP_THREAD_GAP_MS = 15 * 60 * 1000;
/** dshbot room delivery tool (Grok SendMessage equivalent). */
export const ROOM_DELIVER_TOOL = 'send_room_message';

/**
 * These strings are deliberately shared by the event-log adapter and the
 * room presentation. A failed/held/stopped outcome must not be flattened into
 * a successful pass, even when it produces no visible text.
 */
export const GROUP_TURN_STATES = Object.freeze({
  queued: 'queued',
  working: 'working',
  replied: 'replied',
  pass: 'pass',
  failed: 'failed',
  'timed-out': 'timed-out',
  cancelled: 'cancelled',
  capped: 'capped',
  held: 'held',
  stopped: 'stopped',
  settled: 'settled',
});
export const GROUP_PROTOCOL_STATES = Object.freeze(Object.values(GROUP_TURN_STATES));

/** @typedef {{ id: string, name: string, description?: string }} GroupMember */
/** @typedef {{ name: string, description?: string }} GroupDescription */
/** @typedef {{ id?: string, at?: number, thread?: string, attachments?: readonly object[], speaker: { kind: 'user', name?: string } | { kind: 'member', id: string, name: string }, content: string }} GroupMessage */

/**
 * @param {string} threadId
 * @returns {boolean}
 */
export function isValidGroupThreadId(threadId) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(threadId ?? ''));
}

/**
 * Encode a reply target inside the ordinary Session prompt transaction.
 * The room view and member prompt parser remove this envelope before display.
 * @param {string} threadId
 * @param {string} text
 * @returns {string}
 */
export function encodeGroupThreadReply(threadId, text) {
  if (!isValidGroupThreadId(threadId)) throw new Error('Invalid group thread id.');
  return `${GROUP_THREAD_REPLY_PREFIX}${threadId}]\n${String(text ?? '')}`;
}

/**
 * @param {string | undefined} text
 * @returns {{ threadId: string, text: string }}
 */
export function parseGroupThreadReply(text) {
  const raw = String(text ?? '');
  if (!raw.startsWith(GROUP_THREAD_REPLY_PREFIX)) return { threadId: '', text: raw };
  const end = raw.indexOf(']\n', GROUP_THREAD_REPLY_PREFIX.length);
  if (end < 0) return { threadId: '', text: raw };
  const threadId = raw.slice(GROUP_THREAD_REPLY_PREFIX.length, end);
  if (!isValidGroupThreadId(threadId)) return { threadId: '', text: raw };
  return { threadId, text: raw.slice(end + 2) };
}

/**
 * Target for a main composer send. The main composer is the only path that
 * creates a new thread; it does not carry a reply id.
 * @returns {{ kind: 'main', threadId: null }}
 */
export function mainGroupThreadTarget() {
  return { kind: 'main', threadId: null };
}

/**
 * Target for a reply composer. A reply must name an existing thread so a
 * missing/invalid id cannot silently turn into a new conversation.
 * @param {string} threadId
 * @returns {{ kind: 'reply', threadId: string }}
 */
export function replyGroupThreadTarget(threadId) {
  if (!isValidGroupThreadId(threadId)) throw new Error('Invalid group thread id.');
  return { kind: 'reply', threadId: String(threadId) };
}

/**
 * Normalize the several host/client spellings of a composer target while
 * keeping the main-versus-reply distinction explicit.
 * @param {unknown} target
 * @returns {{ kind: 'main', threadId: null } | { kind: 'reply', threadId: string }}
 */
export function resolveGroupThreadTarget(target) {
  if (target === null || target === undefined || target === '') return mainGroupThreadTarget();
  if (typeof target === 'string') return replyGroupThreadTarget(target);
  if (typeof target !== 'object') throw new Error('Invalid group thread target.');
  const value = /** @type {Record<string, unknown>} */ (target);
  if (value.kind === 'main' || value.mode === 'main') return mainGroupThreadTarget();
  if (value.kind === 'reply' || value.mode === 'reply') {
    const threadId = value.threadId ?? value.thread ?? value.replyTo ?? value.targetThreadId
      ?? value.groupThreadId ?? value.owningThreadId;
    return replyGroupThreadTarget(String(threadId ?? ''));
  }
  const threadId = value.threadId ?? value.thread ?? value.replyTo ?? value.targetThreadId
    ?? value.groupThreadId ?? value.owningThreadId;
  if (threadId === null || threadId === undefined || threadId === '') return mainGroupThreadTarget();
  return replyGroupThreadTarget(String(threadId));
}

/** Short aliases for callers that describe the target by composer role. */
export const mainThreadTarget = mainGroupThreadTarget;
export const replyThreadTarget = replyGroupThreadTarget;

/**
 * Stable read-time identity for a user message that starts or continues a thread.
 * @param {object} event
 * @param {number} [index]
 * @returns {string}
 */
export function declaredGroupThreadIdForUserEvent(event) {
  const content = Array.isArray(event?.data?.content) ? event.data.content : [];
  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  const reply = parseGroupThreadReply(text);
  if (reply.threadId) return reply.threadId;
  for (const candidate of [
    event?.threadId,
    event?.thread,
    event?.groupThreadId,
    event?.owningThreadId,
    event?.data?.threadId,
    event?.data?.thread,
    event?.data?.groupThreadId,
    event?.data?.owningThreadId,
  ]) {
    if (isValidGroupThreadId(candidate)) return String(candidate);
  }
  return '';
}

/**
 * Stable identity for callers that already know one event is a standalone
 * main-thread send. Raw room-log readers must project the whole ordered log
 * with assignLegacyThreads so adjacent unmarked follow-ups stay together.
 * @param {object} event
 * @param {number} [index]
 * @returns {string}
 */
export function groupThreadIdForUserEvent(event, index = 0) {
  const declared = declaredGroupThreadIdForUserEvent(event);
  if (declared) return declared;
  const seq = Number(event?.seq);
  return Number.isInteger(seq) && seq >= 0 ? `t${seq}` : `legacy-${Math.max(0, index)}`;
}

/**
 * @param {GroupMessage} message
 * @returns {string}
 */
export function groupThreadOf(message) {
  return isValidGroupThreadId(message?.thread) ? String(message.thread) : 'legacy-0';
}

function isMessageInThread(message, threadId) {
  const target = String(threadId ?? '');
  return groupThreadOf(message) === target
    || (!message?.thread && (target === 'legacy' || target === 'legacy-0'));
}

/**
 * Assign deterministic read-only identities to pre-thread room messages.
 * Explicit thread ids are preserved. An unmarked user message starts a new
 * legacy thread only after a real lull; member replies and quick follow-ups
 * stay with the current legacy thread. The input log is never mutated.
 * @param {readonly GroupMessage[]} log
 * @param {{ gapMs?: number }} [options]
 * @returns {GroupMessage[]}
 */
export function assignLegacyThreads(log, options = {}) {
  const gapMs = Number.isFinite(options.gapMs) ? Math.max(0, Number(options.gapMs)) : GROUP_THREAD_GAP_MS;
  let current = null;
  let sequence = 0;
  const source = Array.isArray(log) ? log : [];

  return source.map((entry, index) => {
    if (entry?.thread) {
      current = null;
      return entry;
    }

    const previous = source[index - 1];
    const previousAt = Number(previous?.at);
    const currentAt = Number(entry?.at);
    const lull = !previous
      || (Number.isFinite(currentAt) && Number.isFinite(previousAt) && currentAt - previousAt > gapMs);

    if (!current || (messageSpeakerKind(entry) === 'user' && lull)) {
      current = `legacy-${sequence++}`;
    }

    return { ...entry, thread: current };
  });
}

/** Stable key used by all thread-scoped watermarks. Holds intentionally do
 * not use this key: they are room-scoped and survive a new thread. */
export function groupThreadWatermarkKey(threadId, memberId) {
  return `${String(threadId ?? '')}::${String(memberId ?? '')}`;
}

/**
 * Stable pending-carrier identity. The field order mirrors the shared
 * contract: owning thread plus member session, request, turn, step, and tool
 * call. Missing legacy fields remain empty rather than being omitted, so the
 * same old event always gets the same read-time key.
 */
export function groupPendingIdentityKey(identity = {}) {
  const value = identity && typeof identity === 'object' ? identity : {};
  return JSON.stringify([
    String(value.threadId ?? value.thread ?? value.groupThreadId ?? value.owningThreadId ?? ''),
    String(value.memberSessionId ?? ''),
    String(value.requestId ?? ''),
    String(value.turn ?? ''),
    String(value.step ?? ''),
    String(value.toolCallId ?? value.callId ?? ''),
  ]);
}

export function groupPendingRequestIdentity(identity = {}) {
  const value = identity && typeof identity === 'object' ? identity : {};
  return {
    threadId: String(value.threadId ?? value.thread ?? value.groupThreadId ?? value.owningThreadId ?? ''),
    memberSessionId: String(value.memberSessionId ?? ''),
    requestId: String(value.requestId ?? ''),
    turn: String(value.turn ?? ''),
    step: String(value.step ?? ''),
    toolCallId: String(value.toolCallId ?? value.callId ?? ''),
  };
}

/** Read a flat or nested watermark map without making callers know which
 * persistence shape an older host used. */
export function readGroupThreadWatermark(watermarks, threadId, memberId) {
  const map = watermarks && typeof watermarks === 'object' ? watermarks : {};
  const key = groupThreadWatermarkKey(threadId, memberId);
  if (Number.isFinite(map[key])) return Math.max(0, Math.trunc(map[key]));
  if (map[threadId] && typeof map[threadId] === 'object' && Number.isFinite(map[threadId][memberId])) {
    return Math.max(0, Math.trunc(map[threadId][memberId]));
  }
  return 0;
}

/** Advance one flat thread/member watermark monotonically. */
export function advanceGroupThreadWatermark(watermarks, threadId, memberId, position) {
  const prior = watermarks && typeof watermarks === 'object' ? watermarks : {};
  const key = groupThreadWatermarkKey(threadId, memberId);
  const nextPosition = Math.max(0, Math.trunc(Number(position) || 0));
  if (nextPosition <= readGroupThreadWatermark(prior, threadId, memberId)) return prior;
  return { ...prior, [key]: nextPosition };
}

/** Return only the messages a member has not consumed in one thread. */
export function groupThreadDelta(log, watermarks, threadId, memberId, limit = Infinity) {
  const source = Array.isArray(log) ? log : [];
  const seen = readGroupThreadWatermark(watermarks, threadId, memberId);
  const messages = source.slice(seen).filter((message) => isMessageInThread(message, threadId));
  return Number.isFinite(limit) ? messages.slice(-Math.max(0, Math.trunc(limit))) : messages;
}

/** Trim a room log and shift every flat thread watermark with it. */
export function trimGroupChatLog(log, watermarks, limit = GROUP_PROMPT_HISTORY_LIMIT * 4) {
  const source = Array.isArray(log) ? log : [];
  const bounded = Math.max(1, Math.trunc(Number(limit) || 1));
  if (source.length <= bounded) return { log: source, watermarks: watermarks || {} };
  const drop = source.length - bounded;
  const shifted = {};
  for (const [key, value] of Object.entries(watermarks || {})) {
    if (value && typeof value === 'object') {
      shifted[key] = Object.fromEntries(
        Object.entries(value).map(([memberId, position]) => [
          memberId,
          Math.max(0, Math.trunc(Number(position) || 0) - drop),
        ]),
      );
      continue;
    }
    shifted[key] = Math.max(0, Math.trunc(Number(value) || 0) - drop);
  }
  return { log: source.slice(drop), watermarks: shifted };
}

/**
 * Normalize a message from either the local event-log adapter or a
 * Hermes-shaped room log. These helpers intentionally stay private: the
 * public GroupMessage shape remains the dshbot speaker/content contract.
 */
function messageSpeakerKind(message) {
  return message?.speaker?.kind ?? message?.from?.kind;
}

function messageSpeakerId(message) {
  return message?.speaker?.id ?? message?.from?.id;
}

function messageSpeakerName(message) {
  return message?.speaker?.name ?? message?.from?.name;
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

/**
 * Hermes-compatible member hold directive classifier. Holds are changed by
 * admitted user text only; a stop word wins over a resume word so an
 * ambiguous instruction errs toward silence.
 * @param {string} text
 * @param {Iterable<string> | null | undefined} mentionedKeys
 * @param {boolean} everyone
 * @returns {{ hold: string[], holdAll: boolean, release: string[], releaseAll: boolean }}
 */
export function classifyGroupHoldDirective(text, mentionedKeys, everyone) {
  const values = typeof mentionedKeys === 'string' ? [mentionedKeys] : [...(mentionedKeys ?? [])];
  const mentioned = [...new Set(values.map((key) => String(key)).filter(Boolean))];
  const value = String(text ?? '');
  const stop = /\b(stop|halt|pause)\b/i.test(value);
  const resume = /\b(resume|continue|go|proceed)\b/i.test(value);

  if (stop) {
    return { hold: mentioned, holdAll: Boolean(everyone), release: [], releaseAll: false };
  }
  if (resume) {
    return { hold: [], holdAll: false, release: mentioned, releaseAll: Boolean(everyone) };
  }
  return { hold: [], holdAll: false, release: mentioned, releaseAll: false };
}

/**
 * Apply one user directive to a room-scoped hold map. A direct non-stop
 * mention releases that member, while @all resume releases every member.
 * The returned map is referentially stable when the directive changes
 * nothing, which makes it safe for reducer-style callers.
 * @param {Record<string, object> | null | undefined} holds
 * @param {{ mentioned?: Iterable<string>, memberIds?: Iterable<string>, everyone?: boolean, isEveryone?: boolean } | null | undefined} mentions
 * @param {string} text
 * @param {{ at?: number, byMessageId?: string | null, thread?: string | null } | null | undefined} stamp
 * @param {readonly string[]} allMemberKeys
 * @returns {Record<string, object>}
 */
export function applyGroupHoldDirective(holds, mentions, text, stamp, allMemberKeys = []) {
  const prior = holds && typeof holds === 'object' ? holds : {};
  const mentioned = mentions?.mentioned ?? mentions?.memberIds ?? [];
  const everyone = Boolean(mentions?.everyone ?? mentions?.isEveryone);
  const action = classifyGroupHoldDirective(text, mentioned, everyone);

  if (action.releaseAll) return Object.keys(prior).length > 0 ? {} : prior;

  const toHold = action.holdAll
    ? [...new Set(allMemberKeys.map((key) => String(key)).filter(Boolean))]
    : action.hold;
  let next = prior;
  for (const key of toHold) {
    if (next === prior) next = { ...prior };
    next[key] = {
      at: stamp?.at ?? Date.now(),
      byMessageId: stamp?.byMessageId ?? null,
      thread: stamp?.thread ?? null,
    };
  }

  for (const key of action.release) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    if (next === prior) next = { ...prior };
    delete next[key];
  }
  return next;
}

/** Consume all newly appended room entries when a member is held. */
export function heldMemberWatermarkAdvance(seen, logLength) {
  const prior = Number(seen) || 0;
  const length = Math.max(0, Number(logLength) || 0);
  return length > prior ? length : null;
}

/**
 * Find member-to-member @mentions that have not been answered in log order.
 * User mentions are deliberately ignored: a user entry already starts a
 * normal responder pass. The output preserves first-citation order.
 * @param {readonly object[]} history
 * @param {readonly Pick<GroupMember, 'id' | 'name'>[]} members
 * @param {string} [threadId]
 * @returns {string[]}
 */
export function unaddressedGroupMentions(history, members, threadId) {
  return unaddressedGroupMentionDetails(history, members, threadId).map((entry) => entry.memberId);
}

/** Same detector with citation positions for reducers that must avoid
 * re-dispatching a handoff after the cited member already attempted it. */
export function unaddressedGroupMentionDetails(history, members, threadId) {
  const source = Array.isArray(history) ? history : [];
  const log = threadId === undefined || threadId === null
    ? source
    : source.filter((entry) => isMessageInThread(entry, threadId));
  const citedAt = new Map();
  const latestPostAt = new Map();

  const memberForIdentity = (message) => {
    const id = String(messageSpeakerId(message) ?? '');
    const name = String(messageSpeakerName(message) ?? '');
    return members.find((member) => String(member.id ?? member.name) === id)
      ?? members.find((member) => member.name === name)
      ?? null;
  };

  for (let index = 0; index < log.length; index += 1) {
    const message = log[index];
    if (messageSpeakerKind(message) !== 'member') continue;
    const targets = parseGroupMentions(messageText(message), members);
    const sourceMember = memberForIdentity(message);
    for (const id of targets.memberIds) {
      if (sourceMember && String(sourceMember.id ?? sourceMember.name) === id) continue;
      citedAt.set(id, index);
    }
    if (sourceMember) latestPostAt.set(String(sourceMember.id ?? sourceMember.name), index);
  }

  return [...citedAt.entries()]
    .filter(([id, citedIndex]) => (latestPostAt.get(id) ?? -1) <= citedIndex)
    .map(([memberId, citedIndex]) => ({ memberId, citedIndex }));
}

/**
 * @param {readonly string[]} memberIds
 * @param {number} round
 * @returns {string[]}
 */
export function orderRoundSpeakers(memberIds, round) {
  const ids = [...memberIds];
  const n = ids.length;
  if (n === 0) return [];
  const start = ((round % n) + n) % n;
  return [...ids.slice(start), ...ids.slice(0, start)];
}

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
export function isSameMemberSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export class SandGroupNestingError extends Error {
  /**
   * @param {readonly string[]} ids
   */
  constructor(ids) {
    const list = [...ids];
    super(
      `A group chat can only contain individual agents, not other group chats. Remove the group chat${list.length === 1 ? '' : 's'} from the member list.`,
    );
    this.name = 'SandGroupNestingError';
    this.nestedGroupIds = list;
  }
}

/**
 * @param {readonly string[]} ids
 * @param {(id: string) => boolean} isGroupId
 */
export function assertMembersAreNotGroups(ids, isGroupId) {
  const nested = [...new Set(ids)].filter((id) => isGroupId(id));
  if (nested.length > 0) throw new SandGroupNestingError(nested);
}

/**
 * @param {string} name
 * @returns {string[]}
 */
export function memberMentionHandles(name) {
  const lower = String(name ?? '').trim().toLowerCase();
  if (!lower) return [];
  const handles = new Set([lower, lower.replace(/\s+/g, '')]);
  const first = lower.split(/\s+/)[0];
  if (first) handles.add(first);
  return [...handles];
}

/**
 * @param {string | undefined} char
 * @returns {boolean}
 */
function isWordChar(char) {
  return char !== undefined && /[a-z0-9]/i.test(char);
}

/**
 * @param {string} lower
 * @param {string} handle
 * @returns {boolean}
 */
function hasMentionAt(lower, handle) {
  const needle = `@${handle}`;
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + 1)) {
    if (!isWordChar(lower[index - 1]) && !isWordChar(lower[index + needle.length])) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} text
 * @param {readonly Pick<GroupMember, 'id' | 'name'>[]} members
 * @returns {{ isEveryone: boolean, memberIds: string[] }}
 */
export function parseGroupMentions(text, members) {
  const lower = String(text ?? '').toLowerCase();
  const memberIds = [];
  const seen = new Set();
  for (const member of members) {
    const memberId = String(member.id ?? member.name ?? '').trim();
    if (!memberId || seen.has(memberId)) continue;
    if (memberMentionHandles(member.name).some((handle) => hasMentionAt(lower, handle))) {
      memberIds.push(memberId);
      seen.add(memberId);
    }
  }
  return {
    isEveryone: /(?:^|[^a-z0-9])@(?:everyone|all)\b/i.test(String(text ?? '')),
    memberIds,
  };
}

/**
 * @param {readonly GroupMember[]} members
 * @param {readonly GroupMessage[]} history
 * @returns {GroupMember[]}
 */
export function resolveResponders(members, history) {
  let start = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.speaker?.kind === 'user') {
      start = index;
      break;
    }
  }
  let everyone = false;
  const mentioned = new Set();
  for (const message of history.slice(start)) {
    const targets = parseGroupMentions(message.content, members);
    everyone ||= targets.isEveryone;
    for (const id of targets.memberIds) mentioned.add(id);
  }
  return everyone || mentioned.size === 0
    ? [...members]
    : members.filter((member) => mentioned.has(String(member.id ?? member.name ?? '')));
}

/**
 * @param {string | undefined} content
 * @returns {boolean}
 */
export function isPassContent(content) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed) return true;
  return /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

/**
 * @param {string | undefined} text
 * @returns {boolean}
 */
export function isPotentialPassPrefix(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return true;
  if (isPassContent(trimmed)) return true;
  return /^\(?\s*(?:p(?:a(?:s(?:s\s*\)?\.?)?)?)?)?$/i.test(trimmed);
}

/**
 * @param {GroupMessage} message
 * @param {string} viewerId
 * @returns {string}
 */
export function formatGroupLine(message, viewerId) {
  if (message.speaker.kind === 'user') {
    return message.speaker.name
      ? `${message.speaker.name} (user): ${message.content}`
      : `User: ${message.content}`;
  }
  const you = message.speaker.id === viewerId ? ' (you)' : '';
  return `${message.speaker.name}${you}: ${message.content}`;
}

/**
 * @param {readonly GroupMessage[]} history
 * @param {string} viewerId
 * @param {number} [limit]
 * @returns {string}
 */
export function formatGroupHistory(history, viewerId, limit = GROUP_PROMPT_HISTORY_LIMIT) {
  const recent = history.slice(-limit);
  return recent.length === 0
    ? '(no messages yet)'
    : recent.map((message) => formatGroupLine(message, viewerId)).join('\n');
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isGroupTurnPromptText(text) {
  const body = String(text ?? '').startsWith(SAND_HIDDEN_PROMPT_MARKER)
    ? String(text).slice(SAND_HIDDEN_PROMPT_MARKER.length)
    : String(text ?? '');
  return body.startsWith(GROUP_CHAT_TAG_PREFIX);
}

/**
 * @param {GroupDescription} group
 * @returns {string}
 */
export function groupDisplayName(group) {
  const name = String(group?.name ?? '').trim();
  return name || 'the group';
}

/**
 * @param {GroupDescription} group
 * @returns {string}
 */
export function describeGroup(group) {
  const name = groupDisplayName(group);
  const description = String(group?.description ?? '').trim();
  return description ? `"${name}" — ${description}` : `"${name}"`;
}

/**
 * @param {GroupDescription} group
 * @param {readonly Pick<GroupMember, 'name'>[]} peers
 * @returns {string}
 */
export function formatGroupChatTag(group, peers) {
  const withPeers = peers.length > 0
    ? ` - with ${peers.map((peer) => peer.name).join(', ')}`
    : '';
  return `${GROUP_CHAT_TAG_PREFIX}"${groupDisplayName(group)}"${withPeers}]`;
}

/**
 * @param {GroupMember} member
 * @param {GroupDescription} group
 * @param {readonly GroupMember[]} peers
 * @param {{ isSharedRoom?: boolean }} [options]
 * @returns {string}
 */
export function buildGroupMemberSystemPrompt(member, group, peers, options = {}) {
  const lines = [
    `You are ${member.name}, one participant in a group chat (${describeGroup(group)}).`,
  ];
  const description = String(member.description ?? '').trim();
  if (description) lines.push(`Your persona: ${description}`);
  if (peers.length > 0) {
    lines.push('', 'Other participants in the room:');
    for (const peer of peers) {
      const peerDesc = String(peer.description ?? '').trim();
      lines.push(`- ${peer.name}${peerDesc ? ` (${peerDesc})` : ''}`);
    }
  }
  lines.push(
    '',
    peers.length > 0
      ? `Right now you are speaking in this group chat, with ${peers.map((peer) => peer.name).join(', ')}.`
      : 'Right now you are speaking in this group chat.',
    options.isSharedRoom === true
      ? 'This is a cross-user room turn. Ordinary Bot tools, skills, and MCP are available subject to your configured capability guard; only send_room_message plain text is delivered to the room.'
      : 'This is a talking-circle turn: ordinary Bot tools, skills, and MCP remain available subject to your configured capability guard. Use send_room_message for room-visible delivery. Speak from your persona and the conversation so far; do not promise work you cannot do inside this turn.',
    '',
    `Stay fully in character as ${member.name}. The ONLY way to say something the room can see is the send_room_message tool. Keep each message short and conversational. If you have nothing new worth adding, send exactly "(pass)". Do not use direct Bot-DM or task-delegation tools in a group member turn. Never reveal private one-on-one context.`,
  );
  return lines.join('\n');
}

/**
 * @param {readonly GroupMessage[]} history
 * @param {string} memberId
 * @returns {readonly GroupMessage[]}
 */
export function messagesSinceMemberLastSpoke(history, memberId) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const speaker = history[index]?.speaker;
    if (speaker?.kind === 'member' && speaker.id === memberId) {
      return history.slice(index + 1);
    }
  }
  return history;
}

/**
 * @param {{ member: GroupMember, group: GroupDescription, peers: readonly GroupMember[], newMessages: readonly GroupMessage[], fullHistory?: boolean }} args
 * @returns {string}
 */
export function buildGroupTurnPrompt(args) {
  const lines = [
    formatGroupChatTag(args.group, args.peers),
    args.newMessages.length === 0
      ? 'No new messages in the room since your last turn.'
      : `${args.fullHistory ? 'Shared room history' : 'New messages in the room'} (oldest first):\n${formatGroupHistory(args.newMessages, args.member.id)}`,
    '',
    `It's your turn, ${args.member.name}. Reply in character with a single send_room_message if you have something worth adding, or send "(pass)" if you don't.`,
  ];
  return lines.join('\n');
}

/**
 * Visible body after stripping legacy NEXT footers (display only; not used for scheduling).
 * @param {string | undefined} text
 * @returns {string}
 */
export function stripLegacyNextFooter(text) {
  const raw = String(text ?? '').replace(/[ \t]+$/gm, '').replace(/\s+$/u, '');
  const lines = raw.split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (!/^NEXT:\s*(.*)$/i.test(last)) return raw;
  return lines.slice(0, -1).join('\n').replace(/\s+$/u, '');
}

/**
 * @param {string | undefined} text
 * @returns {string}
 */
export function memberVisibleText(text) {
  const visible = stripLegacyNextFooter(text);
  if (isPassContent(visible)) return '';
  return visible.trim();
}

const GROUP_STATE_ALIASES = Object.freeze({
  pass: GROUP_TURN_STATES.pass,
  passed: GROUP_TURN_STATES.pass,
  reply: GROUP_TURN_STATES.replied,
  replied: GROUP_TURN_STATES.replied,
  timeout: GROUP_TURN_STATES['timed-out'],
  timedout: GROUP_TURN_STATES['timed-out'],
  'timed-out': GROUP_TURN_STATES['timed-out'],
  cancel: GROUP_TURN_STATES.cancelled,
  canceled: GROUP_TURN_STATES.cancelled,
  cancelled: GROUP_TURN_STATES.cancelled,
  'in-progress': GROUP_TURN_STATES.working,
  error: GROUP_TURN_STATES.failed,
  failure: GROUP_TURN_STATES.failed,
});

function normalizeGroupTurnState(value) {
  const key = String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
  return GROUP_STATE_ALIASES[key] ?? (GROUP_PROTOCOL_STATES.includes(key) ? key : '');
}

function resultText(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => resultText(entry, depth + 1)).join('');
  if (typeof value !== 'object') return '';
  const object = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['text', 'content', 'message', 'data', 'value', 'result']) {
    const nested = object[key];
    if (typeof nested === 'string') return nested;
    if (Array.isArray(nested) || (nested && typeof nested === 'object')) {
      const text = resultText(nested, depth + 1);
      if (text) return text;
    }
  }
  return '';
}

function resultStatusValue(value) {
  if (!value || typeof value !== 'object') return '';
  const object = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['status', 'state', 'outcome', 'kind']) {
    const state = normalizeGroupTurnState(object[key]);
    if (state) return state;
  }
  return '';
}

function resultErrorCode(value) {
  if (!value || typeof value !== 'object') return '';
  const object = /** @type {Record<string, unknown>} */ (value);
  const error = object.error && typeof object.error === 'object'
    ? /** @type {Record<string, unknown>} */ (object.error)
    : object;
  return [error.code, error.reason, error.message, object.reason]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase();
}

function resultHasErrorMarker(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => resultHasErrorMarker(entry, depth + 1));
  if (typeof value !== 'object') return false;
  const object = /** @type {Record<string, unknown>} */ (value);
  if (object.isError === true || (object.error !== undefined && object.error !== null)) return true;
  return ['data', 'message', 'content', 'value', 'result'].some((key) => (
    resultHasErrorMarker(object[key], depth + 1)
  ));
}

/**
 * Classify a member call/result without collapsing failures, timeouts, holds,
 * stops, caps, or cancellations into pass. The adapter accepts both a raw
 * result and a Harness tool-result event.
 * @param {unknown} result
 * @returns {string}
 */
export function classifyGroupTurnOutcome(result) {
  const object = result && typeof result === 'object'
    ? /** @type {Record<string, unknown>} */ (result)
    : {};
  const explicit = resultStatusValue(object) || resultStatusValue(object.data);
  if (explicit) return explicit;

  const code = resultErrorCode(object) || resultErrorCode(object.data);
  if (/timed?-?out|timeout|deadline|time limit/.test(code)) return GROUP_TURN_STATES['timed-out'];
  if (/cancel|abort|supersed|stale/.test(code)) return GROUP_TURN_STATES.cancelled;
  if (/hold|paused/.test(code)) return GROUP_TURN_STATES.held;
  if (/stop|halt/.test(code)) return GROUP_TURN_STATES.stopped;
  if (/cap|limit|maximum/.test(code)) return GROUP_TURN_STATES.capped;
  if (object.cancelled === true || object.canceled === true || object.aborted === true) {
    return GROUP_TURN_STATES.cancelled;
  }
  if (object.timedOut === true || object.timeout === true) return GROUP_TURN_STATES['timed-out'];
  if (object.held === true || object.paused === true) return GROUP_TURN_STATES.held;
  if (object.stopped === true) return GROUP_TURN_STATES.stopped;
  if (object.capped === true) return GROUP_TURN_STATES.capped;
  if (resultHasErrorMarker(result)) return GROUP_TURN_STATES.failed;
  if (object.completed === false || object.pending === true || object.working === true) {
    return GROUP_TURN_STATES.working;
  }

  const text = resultText(result);
  return memberVisibleText(text) ? GROUP_TURN_STATES.replied : GROUP_TURN_STATES.pass;
}

/**
 * A member result remains committable across an epoch bump only when no newer
 * user entry landed in the same thread. A different thread cannot regenerate
 * the old thread's delta, so it must not discard a completed old reply.
 */
export function shouldCommitMemberTurn(epochAtDispatch, currentEpoch, newerUserEntryInThread = true) {
  if (epochAtDispatch === currentEpoch) return true;
  return !newerUserEntryInThread;
}

/** Return a result's declared thread without assuming a transport shape. */
export function groupResultThreadId(result) {
  if (!result || typeof result !== 'object') return '';
  const object = /** @type {Record<string, unknown>} */ (result);
  const data = object.data && typeof object.data === 'object'
    ? /** @type {Record<string, unknown>} */ (object.data)
    : {};
  const message = data.message && typeof data.message === 'object'
    ? /** @type {Record<string, unknown>} */ (data.message)
    : {};
  const source = message.source && typeof message.source === 'object'
    ? /** @type {Record<string, unknown>} */ (message.source)
    : {};
  for (const candidate of [
    object.threadId,
    object.thread,
    object.groupThreadId,
    object.owningThreadId,
    data.threadId,
    data.thread,
    data.groupThreadId,
    data.owningThreadId,
    message.threadId,
    message.thread,
    message.groupThreadId,
    message.owningThreadId,
    source.threadId,
    source.thread,
    source.groupThreadId,
    source.owningThreadId,
  ]) {
    if (isValidGroupThreadId(candidate)) return String(candidate);
  }
  return '';
}

/**
 * Admit a completed member result to its owning thread. A changed epoch only
 * rejects work when a newer user entry exists in that same thread; a different
 * thread cannot regenerate the old delta and therefore cannot discard it.
 * Late timed-out work with visible text is admitted as a reply while keeping
 * its original timed-out outcome for activity consumers.
 * @param {{ result?: unknown, threadId?: string, targetThreadId?: string, epochAtDispatch?: number, currentEpoch?: number, newerUserEntryInThread?: boolean, newerUserThreadId?: string, newerThreadId?: string, currentThreadId?: string, late?: boolean }} input
 * @returns {{ admitted: boolean, accepted: boolean, status: string, threadId: string, late: boolean, outcome: string, reason?: string, text: string }}
 */
export function admitGroupMemberResult(input = {}) {
  const result = input && Object.prototype.hasOwnProperty.call(input, 'result')
    ? input.result
    : input;
  const targetThread = String(input.threadId ?? input.targetThreadId ?? '');
  const resultThread = groupResultThreadId(result);
  const status = classifyGroupTurnOutcome(result);
  const text = resultText(result);
  const visible = Boolean(memberVisibleText(text));
  const late = Boolean(input.late || status === GROUP_TURN_STATES['timed-out']);

  if (targetThread && resultThread && targetThread !== resultThread) {
    return {
      admitted: false,
      accepted: false,
      status: GROUP_TURN_STATES.cancelled,
      threadId: targetThread,
      late,
      outcome: status,
      reason: 'wrong-thread',
      text,
    };
  }

  const epochAtDispatch = Number.isFinite(input.epochAtDispatch)
    ? input.epochAtDispatch
    : input.currentEpoch;
  const currentEpoch = Number.isFinite(input.currentEpoch)
    ? input.currentEpoch
    : epochAtDispatch;
  const newerThread = input.newerUserThreadId ?? input.newerThreadId ?? input.currentThreadId;
  const sameThreadNewer = input.newerUserEntryInThread !== undefined
    ? input.newerUserEntryInThread
    : newerThread !== undefined && targetThread
      ? String(newerThread) === targetThread
      : true;
  const shouldCommit = shouldCommitMemberTurn(
    epochAtDispatch,
    currentEpoch,
    sameThreadNewer,
  );
  if (!shouldCommit) {
    return {
      admitted: false,
      accepted: false,
      status: GROUP_TURN_STATES.cancelled,
      threadId: targetThread || resultThread,
      late,
      outcome: status,
      reason: 'superseded-by-newer-user-entry',
      text,
    };
  }

  const admittedStatus = late && visible ? GROUP_TURN_STATES.replied : status;
  return {
    admitted: true,
    accepted: true,
    status: admittedStatus,
    threadId: targetThread || resultThread,
    late,
    outcome: status,
    text,
  };
}

/** Alias matching the terminology used by the round reducer. */
export const admitGroupTurnResult = admitGroupMemberResult;

/** Expose the canonical state normalizer for catalog/state reducers. */
export { normalizeGroupTurnState };
