import { botDisplayName } from './bot-identity.js';
import { groupMemberSessionId } from './group-member-runtime.js';

export const BOT_CANONICAL_SESSION_TITLE = 'Bot Chat';
export const DSHBOT_PRESENTATION_OWNER_PREFIX = 'dshbot:';
export const DSHBOT_ROOM_PRESENTATION_OWNER_PREFIX = 'dshbot:room:';
export const DSHBOT_MEMBER_PRESENTATION_OWNER_PREFIX = 'dshbot-group:';

const MANAGED_COMPOSER = 'managed';
const SESSION_LOOKUP_ERROR = 'SESSION_LOOKUP_UNAVAILABLE';

function text(value) {
  return String(value ?? '').trim();
}

function samePresentation(left, right) {
  return text(left?.owner) === text(right?.owner)
    && text(left?.title) === text(right?.title)
    && text(left?.composer) === text(right?.composer);
}

function sessionIdFromRow(row) {
  for (const value of [
    row?.sessionId,
    row?.meta?.id,
    row?.header?.id,
    row?.session?.id,
    row?.id,
  ]) {
    const id = text(value);
    if (id) return id;
  }
  return '';
}

export function extractSessionPresentation(row) {
  if (row?.owner) return row;
  const candidates = [
    row?.presentation,
    row?.meta?.presentation,
    row?.header?.presentation,
    row?.session?.presentation,
    row?.metadata?.presentation,
    row?.sessionListMetadata?.presentation,
    row?.projections?.sessionListMetadata?.presentation,
    row?.projections?.values?.sessionListMetadata?.presentation,
  ];
  return candidates.find((value) => value && typeof value === 'object') ?? null;
}

export function isPluginOwnedPresentation(presentation) {
  const owner = text(presentation?.owner);
  return (owner.startsWith(DSHBOT_PRESENTATION_OWNER_PREFIX)
    && owner.length > DSHBOT_PRESENTATION_OWNER_PREFIX.length)
    || (owner.startsWith(DSHBOT_MEMBER_PRESENTATION_OWNER_PREFIX)
      && owner.length > DSHBOT_MEMBER_PRESENTATION_OWNER_PREFIX.length);
}

export function stableSessionId(item) {
  const id = text(item?.sessionId);
  return id || null;
}

export function managedPresentationForItem(item) {
  const id = text(item?.id);
  if (!id) return null;
  const ownerPrefix = item?.kind === 'room'
    ? DSHBOT_ROOM_PRESENTATION_OWNER_PREFIX
    : DSHBOT_PRESENTATION_OWNER_PREFIX;
  return { owner: `${ownerPrefix}${id}`, title: botDisplayName(item), composer: MANAGED_COMPOSER };
}

export function managedMemberPresentation(room, bot, sessionId = groupMemberSessionId(room?.sessionId, bot?.id)) {
  const id = text(sessionId);
  if (!id) return null;
  const roomName = text(room?.name) || 'Group';
  const botName = botDisplayName(bot, text(bot?.id) || 'Bot');
  return {
    owner: `${DSHBOT_MEMBER_PRESENTATION_OWNER_PREFIX}${id}`,
    title: `${roomName} \u00b7 ${botName}`.slice(0, 240),
    composer: MANAGED_COMPOSER,
  };
}

export function canonicalSessionDescriptor(item) {
  const sessionId = stableSessionId(item);
  const presentation = managedPresentationForItem(item);
  if (!sessionId || !presentation) return null;
  return {
    sessionId,
    kind: item.kind === 'room' ? 'room' : 'bot',
    title: BOT_CANONICAL_SESSION_TITLE,
    presentation,
  };
}

function addEntry(entries, entry) {
  if (!entry?.sessionId || !entry.presentation) return;
  if (entries.has(entry.sessionId) && entries.get(entry.sessionId) === null) return;
  const prior = entries.get(entry.sessionId);
  if (!entries.has(entry.sessionId)) {
    entries.set(entry.sessionId, entry);
    return;
  }
  if (!samePresentation(prior.presentation, entry.presentation)) entries.set(entry.sessionId, null);
}

function entriesForItems(items, botItems = items) {
  const entries = new Map();
  const bots = new Map((Array.isArray(botItems) ? botItems : [])
    .filter((item) => item?.kind !== 'room' && text(item?.id))
    .map((item) => [text(item.id), item]));
  for (const item of Array.isArray(items) ? items : []) {
    const canonical = canonicalSessionDescriptor(item);
    if (canonical) addEntry(entries, {
      sessionId: canonical.sessionId,
      presentation: canonical.presentation,
      role: item.kind === 'room' ? 'room' : 'bot',
      itemId: text(item.id),
    });
    if (item?.kind !== 'room') continue;
    for (const botId of Array.isArray(item.memberBotIds) ? item.memberBotIds : []) {
      const id = text(botId);
      if (!id || !stableSessionId(item)) continue;
      const sessionId = groupMemberSessionId(item.sessionId, id);
      addEntry(entries, {
        sessionId,
        presentation: managedMemberPresentation(item, bots.get(id) ?? { id, name: id }, sessionId),
        role: 'member',
        itemId: id,
        roomId: text(item.id),
      });
    }
  }
  return [...entries.values()].filter(Boolean);
}

export function ownedSessionEntries(items) {
  return entriesForItems(items);
}

/**
 * Return only identities owned by a confirmed deletion. A room disband
 * releases the room presentation but deliberately keeps every per-group
 * member Session hidden and intact.
 */
export function deletionSessionEntries({ deletedItem, catalogItems = [], removedItems = [] } = {}) {
  const removed = [...(Array.isArray(removedItems) ? removedItems : [])];
  if (deletedItem && !removed.some((item) => item?.id === deletedItem.id)) removed.unshift(deletedItem);
  const entries = new Map();
  const removedCanonical = removed.map((item) => canonicalSessionDescriptor(item)).filter(Boolean);
  for (const entry of removedCanonical) {
    addEntry(entries, {
      sessionId: entry.sessionId,
      presentation: entry.presentation,
      role: entry.kind,
      itemId: text(removed.find((item) => item.sessionId === entry.sessionId)?.id),
    });
  }

  if (deletedItem?.kind !== 'room') {
    for (const room of Array.isArray(catalogItems) ? catalogItems : []) {
      if (room?.kind !== 'room' || !room.memberBotIds?.includes(deletedItem?.id)) continue;
      // Removing the room is a Hermes soft-disband. Its member Sessions stay
      // hidden so their logs remain recoverable if the room is recreated.
      if (removed.some((item) => item?.id === room.id)) continue;
      const sessionId = stableSessionId(room);
      if (!sessionId) continue;
      addEntry(entries, {
        sessionId: groupMemberSessionId(sessionId, deletedItem.id),
        presentation: managedMemberPresentation(room, deletedItem),
        role: 'member',
        itemId: text(deletedItem.id),
        roomId: text(room.id),
      });
    }
  }
  return [...entries.values()].filter(Boolean);
}

export function classifyOwnedSessionRow(row, expected = []) {
  const sessionId = sessionIdFromRow(row);
  const presentation = extractSessionPresentation(row);
  if (!sessionId) return { kind: 'unknown', sessionId: '', row, presentation };
  if (!isPluginOwnedPresentation(presentation)) {
    return { kind: 'unrelated', sessionId, row, presentation };
  }
  const expectedEntries = expected instanceof Map
    ? expected
    : new Map((Array.isArray(expected) ? expected : []).map((entry) => [entry.sessionId, entry]));
  const owned = expectedEntries.get(sessionId);
  if (owned) {
    return { kind: 'owned', sessionId, row, presentation, entry: owned };
  }
  if (text(presentation?.owner).startsWith(DSHBOT_MEMBER_PRESENTATION_OWNER_PREFIX)) {
    return { kind: 'retained-member', sessionId, row, presentation, reason: 'disband-retention' };
  }
  return { kind: 'orphan', sessionId, row, presentation };
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'sessions', 'entries']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return null;
}

function lookupRows(value) {
  return rowsFrom(value);
}

function lookupError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

export function planStableSession({ sessionId, rows, lookupError: error } = {}) {
  const stableId = text(sessionId);
  if (!stableId) return { action: 'fail', reason: 'missing-binding', sessionId: '' };
  if (error) return { action: 'fail', reason: 'lookup-unavailable', sessionId: stableId, error };
  if (!Array.isArray(rows)) return { action: 'fail', reason: 'lookup-invalid', sessionId: stableId };
  const existing = rows.find((row) => sessionIdFromRow(row) === stableId);
  if (existing) return { action: 'open', sessionId: stableId, row: existing };
  return { action: 'create-exact', sessionId: stableId };
}

export async function resolveStableSession({ sessionId, presentation, lookup, create } = {}) {
  let value;
  try {
    if (typeof lookup !== 'function') throw lookupError(SESSION_LOOKUP_ERROR, 'Session lookup is unavailable.');
    value = await lookup();
  } catch (cause) {
    const error = cause?.code === SESSION_LOOKUP_ERROR
      ? cause
      : lookupError(SESSION_LOOKUP_ERROR,
        'Could not check the managed Session registry; not starting a replacement Session.', cause);
    const decision = planStableSession({ sessionId, lookupError: error });
    error.decision = decision;
    throw error;
  }
  const rows = lookupRows(value);
  const decision = planStableSession({ sessionId, rows });
  if (decision.action === 'fail') {
    const error = lookupError(SESSION_LOOKUP_ERROR,
      'Could not confirm the managed Session registry; not starting a replacement Session.');
    error.decision = decision;
    throw error;
  }
  if (decision.action === 'open' || typeof create !== 'function') return decision;
  const created = await create({ sessionId: decision.sessionId, presentation });
  const createdId = sessionIdFromRow(created) || text(created?.sessionId);
  if (createdId && createdId !== decision.sessionId) {
    throw new Error(`Managed Session creation changed identity from ${decision.sessionId} to ${createdId}.`);
  }
  return { ...decision, action: 'created', result: created };
}

export const decideStableSession = planStableSession;
export const resolveCanonicalSession = resolveStableSession;

export function decideManagedSessionCommand(command, sessionOrRow) {
  const normalized = text(command).split(/\s+/u)[0].toLocaleLowerCase();
  const presentation = extractSessionPresentation(sessionOrRow);
  if (['/new', '/reset'].includes(normalized) && isPluginOwnedPresentation(presentation)) {
    return { action: 'compact', command: normalized, preserveSession: true };
  }
  return { action: 'delegate', command: normalized, preserveSession: false };
}

export const decideBotSessionCommand = decideManagedSessionCommand;

function serviceFromContext(ctx, name) {
  try {
    return ctx?.get?.(name) ?? ctx?.[name];
  } catch {
    return undefined;
  }
}

export function createSessionHygiene(ctx, {
  controller,
  listSessions,
  logger = () => {},
} = {}) {
  const getController = () => controller ?? serviceFromContext(ctx, 'sessionController');

  const applyPresentation = async (entry, presentation) => {
    const service = getController();
    if (typeof service?.setPresentation !== 'function') {
      return { status: 'unsupported', entry, error: new Error('Session presentation is unavailable.') };
    }
    try {
      await service.setPresentation({ sessionId: entry.sessionId, presentation });
      return { status: 'applied', entry };
    } catch (error) {
      return { status: 'failed', entry, error };
    }
  };

  const list = async () => {
    try {
      if (typeof listSessions === 'function') {
        const value = await listSessions();
        const rows = rowsFrom(value);
        return rows ? { available: true, rows } : { available: false, rows: [], error: new Error('Invalid Session list.') };
      }
      const service = getController();
      if (typeof service?.list !== 'function') return { available: false, rows: [] };
      const value = await service.list({ includeHidden: true, include_hidden: true });
      const rows = rowsFrom(value);
      return rows ? { available: true, rows } : { available: false, rows: [], error: new Error('Invalid Session list.') };
    } catch (error) {
      return { available: false, rows: [], error };
    }
  };

  const reconcile = async ({ items = [], sessionRows } = {}) => {
    const expected = ownedSessionEntries(items);
    const expectedById = new Map(expected.map((entry) => [entry.sessionId, entry]));
    const listed = sessionRows === undefined
      ? await list()
      : { available: true, rows: Array.isArray(sessionRows) ? sessionRows : [] };
    const currentById = new Map(listed.rows.map((row) => [sessionIdFromRow(row), row]));
    const results = [];
    for (const entry of expected) {
      const current = currentById.get(entry.sessionId);
      if (current && samePresentation(extractSessionPresentation(current), entry.presentation)) {
        results.push({ status: 'unchanged', entry });
      } else {
        results.push(await applyPresentation(entry, entry.presentation));
      }
    }
    const orphaned = [];
    const retained = [];
    if (listed.available) {
      for (const row of listed.rows) {
        const classification = classifyOwnedSessionRow(row, expectedById);
        if (classification.kind === 'orphan') orphaned.push(classification);
        else if (classification.kind === 'retained-member') retained.push(classification);
        else continue;
        results.push({
          status: 'retained',
          classification,
          entry: {
          sessionId: classification.sessionId,
          presentation: classification.presentation,
            role: classification.kind,
          },
        });
      }
    }
    if (listed.error) logger('dshbot Session hygiene list was unavailable; orphan cleanup was skipped.', listed.error);
    return { expected, results, orphaned, retained, listed: listed.available, listError: listed.error };
  };

  const releasePresentations = async (entries) => {
    const released = [];
    const failures = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const result = await applyPresentation(entry, null);
      if (result.status === 'applied') released.push(entry);
      else failures.push(result);
    }
    return { released, failures };
  };

  const restorePresentations = async (entries) => {
    const restored = [];
    const failures = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const result = await applyPresentation(entry, entry.presentation);
      if (result.status === 'applied') restored.push(entry);
      else failures.push(result);
    }
    return { restored, failures };
  };

  return {
    reconcile,
    sweep: reconcile,
    releasePresentations,
    restorePresentations,
    deletionEntries: deletionSessionEntries,
    ownedSessionEntries,
  };
}

/** Register the local scheduler from an allowed host bootstrap point. */
export function bootstrapSessionHygiene(ctx, scope, options = {}) {
  const hygiene = options.hygiene ?? createSessionHygiene(ctx, options);
  const initialDelayMs = Math.max(0, Number(options.initialDelayMs) || 0);
  const reconnectDelayMs = Math.max(0, Number(options.reconnectDelayMs) || 0);
  let timer;
  let inFlight;
  let pending = false;
  let disposed = false;

  const run = async () => {
    if (disposed) return { disposed: true };
    if (inFlight) {
      pending = true;
      return inFlight;
    }
    inFlight = Promise.resolve().then(() => hygiene.reconcile({ items: scope?.get?.()?.items ?? [] }))
      .catch((error) => {
        (options.logger ?? (() => {}))('dshbot Session hygiene sweep failed.', error);
        return { error };
      });
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
      if (pending && !disposed) {
        pending = false;
        schedule(0);
      }
    }
  };

  const schedule = (delay = reconnectDelayMs) => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void run(); }, Math.max(0, Number(delay) || 0));
  };

  const gateway = options.gateway ?? ctx?.state?.gateway ?? serviceFromContext(ctx, 'gateway');
  let unlisten;
  if (typeof gateway?.listen === 'function') {
    unlisten = gateway.listen((state) => {
      const value = typeof state === 'string' ? state : state?.state;
      if (value === 'open') schedule(reconnectDelayMs);
    });
  }
  if (options.autoStart !== false) schedule(initialDelayMs);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    try { unlisten?.(); } catch { /* best effort */ }
  };
  if (typeof options.registerDispose === 'function') options.registerDispose(dispose);
  return { hygiene, run, schedule, dispose };
}

export const startSessionHygiene = bootstrapSessionHygiene;
