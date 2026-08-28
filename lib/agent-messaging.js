/**
 * Pure A2A inbox helpers (Grok SendToAgent / agent-messaging semantics).
 */

export const AGENT_MESSAGE_MAX_TEXT = 8_000;
export const AGENT_INBOUND_WAKE_CUE = '[agent]';
export const SAND_SEND_TO_AGENT_TOOL_NAME = 'send_to_agent';
export const AGENT_DIRECTORY_PROMPT_LIMIT = 12;
const DIRECTORY_DESCRIPTION_MAX = 200;

/**
 * @param {string | undefined} text
 * @param {number} max
 * @returns {string}
 */
function clampLine(text, max) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

/**
 * @param {string | undefined} text
 * @returns {string}
 */
export function clampAgentMessage(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  return trimmed.length <= AGENT_MESSAGE_MAX_TEXT
    ? trimmed
    : trimmed.slice(0, AGENT_MESSAGE_MAX_TEXT);
}

/**
 * @typedef {{ fromId: string, fromName: string, text: string, timestampMs: number, priority?: boolean, delivered?: boolean }} AgentInbound
 */

/**
 * @template {{ priority?: boolean }} T
 * @param {readonly T[]} messages
 * @returns {{ priority: T[], rest: T[] }}
 */
export function partitionAgentInbound(messages) {
  const priority = [];
  const rest = [];
  for (const message of messages) {
    (message.priority === true ? priority : rest).push(message);
  }
  return { priority, rest };
}

/**
 * @template {{ priority?: boolean }} T
 * @param {readonly T[]} messages
 * @returns {T[]}
 */
export function prioritizeAgentInbound(messages) {
  const parts = partitionAgentInbound(messages);
  return [...parts.priority, ...parts.rest];
}

/**
 * @template {{ priority?: boolean }} T
 * @param {readonly T[]} queued
 * @param {readonly T[]} deferred
 * @returns {T[]}
 */
export function mergeAgentInboundQueue(queued, deferred) {
  const newer = partitionAgentInbound(queued);
  const older = partitionAgentInbound(deferred);
  return [...newer.priority, ...older.priority, ...older.rest, ...newer.rest];
}

/**
 * Grok buildAgentInboundWakePrompt skeleton.
 * @param {AgentInbound & { from?: { id?: string, name?: string } }} message
 * @returns {string}
 */
export function buildAgentInboundWakePrompt(message) {
  const fromName = String(
    message.fromName || message.from?.name || message.fromId || 'An agent',
  ).trim();
  const fromId = String(message.fromId || message.from?.id || '').trim();
  const body = clampAgentMessage(message.text);
  const priority = message.priority === true;
  const lines = [
    `${AGENT_INBOUND_WAKE_CUE} A message just arrived from another of your user's agents: ${fromName}${fromId ? ` (id: ${fromId})` : ''}.`,
    priority
      ? 'This is a PRIORITY instruction from another assistant — not the user typing here. It interrupted your previous non-user work. Drop conflicting in-flight work and follow it now. Your user can already see it in this chat.'
      : 'This is another assistant reaching out — not the user typing here. It arrived asynchronously, and your user can already see it in this chat.',
    '',
    `${fromName}: ${body}`,
    '',
    `If it needs a reply or an action, handle it: reply to ${fromName} with ${SAND_SEND_TO_AGENT_TOOL_NAME}${fromId ? ` (their id: ${fromId})` : ''}, which reaches them on a later turn — not a live back-and-forth — and use SendMessage / your user chat only when you have a real result to share. If it is just an FYI with nothing for you to do, it is fine to stay silent — no need to reply just to acknowledge it.`,
  ];
  return lines.join('\n');
}

/**
 * Grok buildAgentDirectoryPrompt adapted to the dshbot catalog: list the
 * other 1:1 bots and the rooms this bot belongs to, so send_to_agent is a
 * surfaced capability. Empty when the bot has no teammates and no rooms.
 * @param {readonly object[]} items
 * @param {string} selfId
 * @returns {string}
 */
export function buildAgentDirectoryPrompt(items, selfId) {
  const others = items.filter(
    (entry) => entry.kind !== 'room' && entry.id !== selfId && entry.hidden !== true,
  );
  const groups = items.filter(
    (entry) => entry.kind === 'room' && (entry.memberBotIds ?? []).includes(selfId),
  );
  if (others.length === 0 && groups.length === 0) return '';
  const lines = [
    'Your teammates: the other bots this user runs. Each is its own assistant with its own chat, persona, and memory.',
    `Messaging is ASYNCHRONOUS: call ${SAND_SEND_TO_AGENT_TOOL_NAME} with a target id and your message; it is delivered and returns right away. Do not wait or poll for a reply — one arrives later as its own message that wakes you (the cue ${AGENT_INBOUND_WAKE_CUE}). The target can be a single bot or a group room you belong to; posting to a room reaches every member.`,
    'Use it with judgment: it is a real side effect that wakes another bot. Message a teammate only when it genuinely helps the user\'s goal, and never relay the user\'s unfiltered words verbatim.',
  ];
  if (others.length > 0) {
    lines.push('Teammates you can message right now:');
    for (const bot of others.slice(0, AGENT_DIRECTORY_PROMPT_LIMIT)) {
      const name = String(bot.name ?? '').trim() || bot.id;
      const description = clampLine(bot.description, DIRECTORY_DESCRIPTION_MAX);
      lines.push(`- ${name} (id: ${bot.id})${description ? ` — ${description}` : ''}`);
    }
    if (others.length > AGENT_DIRECTORY_PROMPT_LIMIT) {
      lines.push('…and more on the Bots tab.');
    }
  }
  if (groups.length > 0) {
    lines.push(`Group rooms you are in (${SAND_SEND_TO_AGENT_TOOL_NAME} with the room id posts to all members):`);
    for (const room of groups.slice(0, AGENT_DIRECTORY_PROMPT_LIMIT)) {
      const name = String(room.name ?? '').trim() || room.id;
      const memberNames = (room.memberBotIds ?? [])
        .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
        .filter(Boolean)
        .map((bot) => String(bot.name ?? '').trim() || bot.id)
        .join(', ');
      lines.push(`- ${name} (id: ${room.id})${memberNames ? ` — with ${memberNames}` : ''}`);
    }
    lines.push('This conversation is your private 1:1 with the user; room members cannot see it. Don\'t @-mention anyone else here.');
  }
  return lines.join('\n');
}

/**
 * @param {readonly AgentInbound[] | undefined} inbox
 * @param {AgentInbound} message
 * @returns {AgentInbound[]}
 */
export function enqueueAgentInbound(inbox, message) {
  const queued = Array.isArray(inbox) ? [...inbox] : [];
  if (message.priority === true) return [message, ...queued];
  queued.push(message);
  return queued;
}

/**
 * Validate send_to_agent targets. Group posts are member-only (Grok
 * agent-messaging: an agent can only post into rooms it belongs to).
 * @param {readonly object[]} items
 * @param {string} fromBotId
 * @param {string} toBotId
 * @returns {{ ok: true, from: object, to: object, toGroup: boolean }
 *   | { ok: false, error: string }}
 */
export function resolveSendToAgentTarget(items, fromBotId, toBotId) {
  if (!toBotId || toBotId === fromBotId) {
    return { ok: false, error: "An agent can't message itself." };
  }
  const from = items.find((entry) => entry.id === fromBotId && entry.kind !== 'room');
  const to = items.find((entry) => entry.id === toBotId);
  if (!from) return { ok: false, error: 'Sender is not a catalog bot.' };
  if (!to) return { ok: false, error: `No agent found with id ${toBotId}.` };
  if (to.kind === 'room') {
    const members = Array.isArray(to.memberBotIds) ? to.memberBotIds : [];
    if (!members.includes(fromBotId)) {
      return {
        ok: false,
        error: `You are not a member of group ${String(to.name ?? '') || toBotId}; only members can post into a room.`,
      };
    }
    return { ok: true, from, to, toGroup: true };
  }
  return { ok: true, from, to, toGroup: false };
}
