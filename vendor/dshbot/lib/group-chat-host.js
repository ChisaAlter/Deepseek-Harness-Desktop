/**
 * Host helpers for group turns: epoch cancel, createGroup / setGroupMembers (Grok glue).
 */
import {
  GROUP_MAX_MEMBERS,
  GROUP_MIN_MEMBERS,
  assertMembersAreNotGroups,
  isSameMemberSet,
} from './group-chat.js';

/** @type {Map<string, number>} */
const roomTurnEpoch = new Map();

/**
 * @param {string} roomSessionId
 * @returns {number}
 */
export function currentTurnEpoch(roomSessionId) {
  return roomTurnEpoch.get(roomSessionId) ?? 0;
}

/**
 * Bump epoch for a room session (new user message). Old turns see isCurrent() === false.
 * @param {string} roomSessionId
 * @returns {number}
 */
export function nextTurnEpoch(roomSessionId) {
  const next = currentTurnEpoch(roomSessionId) + 1;
  roomTurnEpoch.set(roomSessionId, next);
  return next;
}

/**
 * @param {string} roomSessionId
 * @param {number} epoch
 * @returns {() => boolean}
 */
export function isCurrentFactory(roomSessionId, epoch) {
  return () => currentTurnEpoch(roomSessionId) === epoch;
}

/**
 * Reset epoch map (tests).
 */
export function resetTurnEpochsForTests() {
  roomTurnEpoch.clear();
}

export class SandGroupCreateError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'SandGroupCreateError';
  }
}

/**
 * Normalize member ids for create/set (Grok createGroup / setGroupMembers).
 * @param {{
 *   memberIds: readonly string[],
 *   existingBotIds: ReadonlySet<string>,
 *   groupIds: ReadonlySet<string>,
 *   excludeGroupId?: string,
 * }} args
 * @returns {string[]}
 */
export function normalizeGroupMemberIds(args) {
  const requested = [...new Set(args.memberIds)];
  assertMembersAreNotGroups(requested, (id) => args.groupIds.has(id));
  return requested
    .filter((id) => id !== args.excludeGroupId && args.existingBotIds.has(id))
    .slice(0, GROUP_MAX_MEMBERS);
}

/**
 * @param {{
 *   name: string,
 *   description?: string,
 *   memberIds: readonly string[],
 *   items: readonly object[],
 * }} args
 * @returns {{ action: 'create', memberIds: string[], name: string, description: string }
 *   | { action: 'open', room: object }
 *   | never}
 */
export function planCreateGroup(args) {
  const existingBotIds = new Set(
    args.items.filter((entry) => entry.kind !== 'room').map((entry) => entry.id),
  );
  const groupIds = new Set(
    args.items.filter((entry) => entry.kind === 'room').map((entry) => entry.id),
  );
  const memberIds = normalizeGroupMemberIds({
    memberIds: args.memberIds,
    existingBotIds,
    groupIds,
  });
  if (memberIds.length < GROUP_MIN_MEMBERS) {
    throw new SandGroupCreateError(`A group needs at least ${GROUP_MIN_MEMBERS} existing member agents.`);
  }
  const duplicate = args.items.find(
    (entry) => entry.kind === 'room' && isSameMemberSet(entry.memberBotIds ?? [], memberIds),
  );
  if (duplicate) {
    return { action: 'open', room: duplicate };
  }
  return {
    action: 'create',
    memberIds,
    name: String(args.name ?? '').trim() || 'Group',
    description: String(args.description ?? ''),
  };
}

/**
 * @param {{
 *   groupId: string,
 *   memberIds: readonly string[],
 *   items: readonly object[],
 * }} args
 * @returns {string[] | null} cleaned ids, or null if no write
 */
export function planSetGroupMembers(args) {
  const room = args.items.find((entry) => entry.id === args.groupId && entry.kind === 'room');
  if (!room) return null;
  const existingBotIds = new Set(
    args.items.filter((entry) => entry.kind !== 'room').map((entry) => entry.id),
  );
  const groupIds = new Set(
    args.items.filter((entry) => entry.kind === 'room').map((entry) => entry.id),
  );
  const cleaned = normalizeGroupMemberIds({
    memberIds: args.memberIds,
    existingBotIds,
    groupIds,
    excludeGroupId: args.groupId,
  });
  if (cleaned.length < GROUP_MIN_MEMBERS) return null;
  return cleaned;
}
