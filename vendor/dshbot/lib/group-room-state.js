import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { projectCatalog } from './catalog-scope.js';
import { directGroupMentionTargets } from './catalog.js';
import {
  applyGroupHoldDirective,
  declaredGroupThreadIdForUserEvent,
  groupThreadIdForUserEvent,
  parseGroupThreadReply,
} from './group-chat.js';

/**
 * Durable room-level hold state. The event cursor is deliberately part of the
 * same record as the holds so a successful catalog write advances both
 * atomically. `holds` is room-scoped; `thread` on a stamp is provenance only.
 */
export const GROUP_ROOM_HOLD_CHECKPOINT_VERSION = 1;
export const GROUP_ROOM_HOLD_CHECKPOINT_FIELD = 'holdCheckpoint';
export const GROUP_ROOM_HOLD_CHECKPOINT_MAX_EVENTS = 256;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sequenceOf(event) {
  for (const candidate of [event?.seq, event?.data?.seq]) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const sequence = Number(candidate);
    if (Number.isInteger(sequence) && sequence >= 0) return sequence;
  }
  return null;
}

function valueString(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function normalizeHoldStamp(value) {
  const source = isRecord(value) ? value : {};
  const stamp = {
    at: Math.max(0, finiteNumber(source.at, 0)),
    byMessageId: valueString(source.byMessageId),
    thread: valueString(source.thread),
  };
  if (source.noted === true) stamp.noted = true;
  return stamp;
}

function normalizeHolds(value) {
  if (!isRecord(value)) return {};
  const holds = {};
  for (const [key, stamp] of Object.entries(value)) {
    const memberKey = String(key).trim();
    if (memberKey) holds[memberKey] = normalizeHoldStamp(stamp);
  }
  return holds;
}

function normalizeEventIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const candidate of value) {
    const id = valueString(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.slice(-GROUP_ROOM_HOLD_CHECKPOINT_MAX_EVENTS);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Normalize the additive room checkpoint shape. A legacy room's top-level
 * `holds` is used only as the initial hold seed when no checkpoint exists.
 * @param {unknown} value
 * @param {unknown} [legacyHolds]
 * @returns {{ version: number, holds: Record<string, object>, processedEventIds: string[], processedThroughSeq: number }}
 */
export function normalizeGroupRoomHoldCheckpoint(value, legacyHolds = {}) {
  const source = isRecord(value) ? value : {};
  const rawHolds = hasOwn(source, 'holds') ? source.holds : legacyHolds;
  const rawSequence = source.processedThroughSeq
    ?? source.lastProcessedSeq
    ?? source.processedSeq;
  const processedThroughSeq = sequenceOf({ seq: rawSequence });
  return {
    version: GROUP_ROOM_HOLD_CHECKPOINT_VERSION,
    holds: normalizeHolds(rawHolds),
    processedEventIds: normalizeEventIds(source.processedEventIds),
    processedThroughSeq: processedThroughSeq === null ? -1 : processedThroughSeq,
  };
}

function hasCheckpointCursor(value) {
  return isRecord(value) && (
    Number(value.version) === GROUP_ROOM_HOLD_CHECKPOINT_VERSION
    || Array.isArray(value.processedEventIds)
    || hasOwn(value, 'processedThroughSeq')
    || hasOwn(value, 'lastProcessedSeq')
    || hasOwn(value, 'processedSeq')
  );
}

function eventContent(event) {
  const data = isRecord(event?.data) ? event.data : {};
  return data.content ?? data.message?.content ?? data.message?.data?.content ?? '';
}

function textFromContent(content, depth = 0) {
  if (depth > 8 || content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((entry) => textFromContent(entry, depth + 1)).join('');
  if (!isRecord(content)) return '';
  if (content.type === 'text' && typeof content.text === 'string') return content.text;
  if (content.type === 'tool-result') return textFromContent(content.content, depth + 1);
  return '';
}

function userText(event) {
  return parseGroupThreadReply(textFromContent(eventContent(event))).text;
}

function isRoomUserEvent(event) {
  if (event?.type !== 'user/message') return false;
  const data = isRecord(event.data) ? event.data : {};
  const source = isRecord(data.source)
    ? data.source
    : isRecord(data.message?.source) ? data.message.source : undefined;
  // Minimal compatibility fixtures omit source; the event type still makes
  // it a user entry. Bot relay entries remain conversation input, but cannot
  // change the user's durable hold controls.
  if (!source) return true;
  return source.kind === 'user';
}

function stableJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return `${typeof value}:${String(value)}`;
  }
}

/**
 * Stable read-time identity for the bounded cursor. Harness events normally
 * have `data.id` and `seq`; the digest fallback keeps id-less fixtures
 * replayable without storing the complete event body in the catalog.
 * @param {object} event
 * @param {number} [index]
 * @returns {string}
 */
export function groupRoomEventIdentity(event, index = 0) {
  for (const candidate of [
    event?.data?.id,
    event?.id,
    event?.data?.message?.id,
  ]) {
    const id = valueString(candidate);
    if (id) return id;
  }
  const sequence = sequenceOf(event);
  if (sequence !== null) return `seq:${sequence}`;
  const digest = createHash('sha256')
    .update(stableJson({
      type: event?.type ?? '',
      time: event?.time ?? event?.data?.time ?? null,
      data: event?.data ?? event,
    }))
    .digest('hex')
    .slice(0, 32);
  return `event:${digest || index}`;
}

function eventThread(event, index) {
  return declaredGroupThreadIdForUserEvent(event)
    || groupThreadIdForUserEvent(event, index)
    || null;
}

function eventAt(event, now) {
  const raw = event?.time ?? event?.data?.time;
  if (raw !== null && raw !== undefined && raw !== '') {
    const at = Number(raw);
    if (Number.isFinite(at)) return Math.max(0, at);
  }
  return Math.max(0, finiteNumber(now, Date.now()));
}

function memberIdsFor(room, supplied) {
  const source = Array.isArray(supplied) ? supplied : room?.memberBotIds;
  return [...new Set((Array.isArray(source) ? source : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))];
}

function rememberEvent(checkpoint, identity, sequence) {
  const ids = checkpoint.processedEventIds.includes(identity)
    ? checkpoint.processedEventIds
    : [...checkpoint.processedEventIds, identity].slice(-GROUP_ROOM_HOLD_CHECKPOINT_MAX_EVENTS);
  const processedThroughSeq = sequence === null
    ? checkpoint.processedThroughSeq
    : Math.max(checkpoint.processedThroughSeq, sequence);
  if (ids === checkpoint.processedEventIds && processedThroughSeq === checkpoint.processedThroughSeq) {
    return checkpoint;
  }
  return {
    ...checkpoint,
    processedEventIds: ids,
    processedThroughSeq,
  };
}

function eventAlreadyProcessed(checkpoint, identity, sequence) {
  return checkpoint.processedEventIds.includes(identity)
    || sequence !== null && sequence <= checkpoint.processedThroughSeq;
}

function orderedRoomEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event, index) => ({ event, index, sequence: sequenceOf(event) }))
    .filter(({ event }) => isRoomUserEvent(event))
    .sort((left, right) => {
      if (left.sequence !== null && right.sequence !== null && left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
      }
      return left.index - right.index;
    });
}

function clockValue(now) {
  if (typeof now === 'function') return now();
  return now === undefined ? Date.now() : now;
}

/**
 * Apply the newly observed room user events to one checkpoint. This reducer
 * never uses a thread as a map key: thread ids are copied to hold stamps only
 * so the UI can explain where a hold came from.
 *
 * @param {{
 *   checkpoint?: unknown,
 *   events?: readonly object[],
 *   items?: readonly object[],
 *   room?: object,
 *   memberIds?: readonly string[],
 *   now?: number | (() => number),
 * }} input
 * @returns {{ checkpoint: object, changed: boolean, backfilled: boolean, processedEventIds: string[], processedEventCount: number }}
 */
export function reduceGroupRoomHoldCheckpoint(input = {}) {
  const room = isRecord(input.room) ? input.room : {};
  const rawCheckpoint = input.checkpoint;
  const backfilled = !hasCheckpointCursor(rawCheckpoint);
  let checkpoint = normalizeGroupRoomHoldCheckpoint(rawCheckpoint, room.holds);
  const baseline = backfilled ? null : normalizeGroupRoomHoldCheckpoint(rawCheckpoint, room.holds);
  const items = Array.isArray(input.items) ? input.items : [];
  const memberIds = memberIdsFor(room, input.memberIds);
  const now = clockValue(input.now);
  const processedEventIds = [];

  for (const { event, index, sequence } of orderedRoomEvents(input.events)) {
    const identity = groupRoomEventIdentity(event, index);
    if (eventAlreadyProcessed(checkpoint, identity, sequence)) {
      checkpoint = rememberEvent(checkpoint, identity, sequence);
      continue;
    }

    const text = userText(event);
    if (text) {
      const mentions = directGroupMentionTargets(items, memberIds, text);
      checkpoint = {
        ...checkpoint,
        holds: applyGroupHoldDirective(
          checkpoint.holds,
          { mentioned: mentions.memberIds, everyone: mentions.everyone },
          text,
          {
            at: eventAt(event, now),
            byMessageId: identity,
            thread: eventThread(event, index),
          },
          memberIds,
        ),
      };
    }

    checkpoint = rememberEvent(checkpoint, identity, sequence);
    processedEventIds.push(identity);
  }

  return {
    checkpoint,
    changed: backfilled || !isDeepStrictEqual(checkpoint, baseline),
    backfilled,
    processedEventIds,
    processedEventCount: processedEventIds.length,
  };
}

function requestedRoom(input) {
  const room = isRecord(input?.room) ? input.room : {};
  const roomId = valueString(input?.roomId) || valueString(input?.groupId) || valueString(room.id);
  const sessionId = valueString(input?.sessionId)
    || valueString(input?.roomSessionId)
    || valueString(room.sessionId);
  return { roomId, sessionId };
}

function locateRoom(catalog, input) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const requested = requestedRoom(input);
  const byId = requested.roomId
    ? items.find((item) => item?.kind === 'room' && String(item.id) === requested.roomId)
    : undefined;
  const bySession = requested.sessionId
    ? items.find((item) => item?.kind === 'room' && String(item.sessionId) === requested.sessionId)
    : undefined;
  if (byId && bySession && byId.id !== bySession.id) {
    throw new Error('Room id and Session id refer to different rooms.');
  }
  const room = byId || bySession;
  if (!room) throw new Error('Group room is unavailable.');
  return room;
}

async function snapshotEvents(input) {
  const source = input?.events ?? input?.sessionEvents ?? input?.session;
  if (Array.isArray(source)) return source;
  if (typeof source === 'function') return source();
  if (typeof source?.snapshotEvents === 'function') return source.snapshotEvents();
  if (Array.isArray(source?.events)) return source.events;
  return [];
}

/**
 * Reconcile a room Session snapshot into the durable catalog checkpoint.
 * `projectCatalog` re-reads and re-projects after revision conflicts, so a
 * concurrent profile/room edit is retained. Only the selected room's
 * checkpoint and `holds` compatibility mirror are changed.
 *
 * @param {{ get: () => object, set: (next: object, previous: object) => Promise<void> }} scope
 * @param {{
 *   roomId?: string,
 *   groupId?: string,
 *   sessionId?: string,
 *   roomSessionId?: string,
 *   room?: object,
 *   events?: readonly object[] | object | (() => readonly object[] | Promise<readonly object[]>),
 *   sessionEvents?: readonly object[] | object | (() => readonly object[] | Promise<readonly object[]>),
 *   session?: object,
 *   memberIds?: readonly string[],
 *   now?: number | (() => number),
 * }} input
 * @returns {Promise<{ catalog: object, room: object, checkpoint: object, changed: boolean, backfilled: boolean, processedEventIds: string[], processedEventCount: number }>}
 */
export async function reconcileGroupRoomHolds(scope, input = {}) {
  if (!scope || typeof scope.get !== 'function' || typeof scope.set !== 'function') {
    throw new TypeError('A revision-aware catalog scope is required.');
  }
  const events = await snapshotEvents(input);
  let result;
  const catalog = await projectCatalog(scope, (current) => {
    const room = locateRoom(current, input);
    const rawCheckpoint = room[GROUP_ROOM_HOLD_CHECKPOINT_FIELD];
    const reduced = reduceGroupRoomHoldCheckpoint({
      checkpoint: rawCheckpoint,
      events,
      items: current.items,
      room,
      memberIds: input.memberIds,
      now: input.now,
    });
    const nextCheckpoint = reduced.checkpoint;
    const roomChanged = !isDeepStrictEqual(rawCheckpoint, nextCheckpoint)
      || !isDeepStrictEqual(room.holds, nextCheckpoint.holds);
    result = reduced;
    if (!roomChanged) return current;

    const nextRoom = {
      ...room,
      [GROUP_ROOM_HOLD_CHECKPOINT_FIELD]: nextCheckpoint,
      // Existing dshbot scheduling reads room.holds. Keep this mirror in the
      // same catalog write until the caller migrates all readers to the
      // explicit checkpoint field.
      holds: nextCheckpoint.holds,
    };
    return {
      ...current,
      items: current.items.map((item) => item === room ? nextRoom : item),
    };
  });
  const room = locateRoom(catalog, input);
  const checkpoint = normalizeGroupRoomHoldCheckpoint(
    room[GROUP_ROOM_HOLD_CHECKPOINT_FIELD],
    room.holds,
  );
  return {
    catalog,
    room,
    checkpoint,
    changed: Boolean(result?.changed),
    backfilled: Boolean(result?.backfilled),
    processedEventIds: result?.processedEventIds ?? [],
    processedEventCount: result?.processedEventCount ?? 0,
  };
}

/** Alias using the room-state terminology used by integration callers. */
export const reconcileGroupRoomState = reconcileGroupRoomHolds;
