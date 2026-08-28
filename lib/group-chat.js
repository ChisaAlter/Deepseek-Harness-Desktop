/**
 * Pure group-chat protocol (Grok group-chat.ts semantics, self-written).
 * Room-visible delivery tool name in dshbot is send_room_message.
 */

export const GROUP_CONFIG_VERSION = 1;
export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 6;
export const GROUP_MAX_MEMBER_TURNS = 10;
export const GROUP_MAX_ROUNDS = 3;
export const GROUP_PROMPT_HISTORY_LIMIT = 24;
export const GROUP_MAX_MESSAGES_PER_TURN = 2;
export const SHARED_ROOM_HISTORY_LIMIT = 24;
export const GROUP_CHAT_TAG_PREFIX = '[Group chat: ';
export const SAND_HIDDEN_PROMPT_MARKER = '[SAND_HIDDEN_PROMPT]';
/** dshbot room delivery tool (Grok SendMessage equivalent). */
export const ROOM_DELIVER_TOOL = 'send_room_message';

/** @typedef {{ id: string, name: string, description?: string }} GroupMember */
/** @typedef {{ name: string, description?: string }} GroupDescription */
/** @typedef {{ speaker: { kind: 'user', name?: string } | { kind: 'member', id: string, name: string }, content: string }} GroupMessage */

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
  const lower = name.trim().toLowerCase();
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
    if (seen.has(member.id)) continue;
    if (memberMentionHandles(member.name).some((handle) => hasMentionAt(lower, handle))) {
      memberIds.push(member.id);
      seen.add(member.id);
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
    : members.filter((member) => mentioned.has(member.id));
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
      ? 'This is a cross-user room turn. Tool calls and plain text are private scratch space; only send_room_message plain text is delivered to the room.'
      : 'This is a talking-circle turn: send_room_message is the only tool available to you here. Speak from your persona and the conversation so far; do not promise work you cannot do inside this turn.',
    '',
    `Stay fully in character as ${member.name}. The ONLY way to say something the room can see is the send_room_message tool. Keep each message short and conversational. If you have nothing new worth adding, send exactly "(pass)". Never reveal private one-on-one context.`,
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
 * @param {{ member: GroupMember, group: GroupDescription, peers: readonly GroupMember[], newMessages: readonly GroupMessage[] }} args
 * @returns {string}
 */
export function buildGroupTurnPrompt(args) {
  const lines = [
    formatGroupChatTag(args.group, args.peers),
    args.newMessages.length === 0
      ? 'No new messages in the room since your last turn.'
      : `New messages in the room (oldest first):\n${formatGroupHistory(args.newMessages, args.member.id)}`,
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
