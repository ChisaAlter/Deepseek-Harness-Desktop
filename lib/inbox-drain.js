/**
 * A2A inbox drain state machine, dependency-free so it is directly testable.
 *
 * Delivery contract is at-least-once: the systemPrompt assemble PEEKS the
 * inbox into a wake prompt and snapshots the batch in the process-local
 * `pendingDrain` map; the catalog is only mutated by an explicit ack after
 * the turn that consumed the peek. A crash or restart between peek and ack
 * loses only the in-memory snapshot — the durable inbox is untouched, so the
 * next assemble redelivers the same messages instead of dropping them.
 */
import {
  buildAgentInboundWakePrompt,
  prioritizeAgentInbound,
} from './agent-messaging.js';

/**
 * Pending drain snapshot keyed by bot id (acked after successful wake or explicit drain).
 * @type {Map<string, object[]>}
 */
const pendingDrain = new Map();

/**
 * Reset drain snapshots (tests).
 */
export function resetPendingDrainForTests() {
  pendingDrain.clear();
}

/**
 * Remove exactly the given messages from a bot's durable inbox. Messages
 * that arrived after the snapshot keep their place.
 * @param {{ get: () => any, set: (v: any) => void }} scope
 * @param {string} botId
 * @param {readonly object[]} messages
 */
export function ackInboxMessages(scope, botId, messages) {
  const catalog = scope.get() ?? { items: [] };
  const keys = new Set(
    messages.map((msg) => `${msg.timestampMs}\0${msg.fromId}\0${msg.text}`),
  );
  const nextItems = (catalog.items ?? []).map((entry) => {
    if (entry.id !== botId) return entry;
    const remaining = (entry.inbox ?? []).filter(
      (msg) => !keys.has(`${msg.timestampMs}\0${msg.fromId}\0${msg.text}`),
    );
    return { ...entry, inbox: remaining };
  });
  scope.set({ ...catalog, items: nextItems });
}

/**
 * Peek inbox into a wake prompt without clearing (assemble-safe).
 * Cleared only via ackPendingInboxDrain after a successful open/wake.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ getScope: () => { get: () => any, set: (v: any) => void } }} deps
 */
export function registerInboxDrain(ctx, deps) {
  ctx.systemPrompt.section({
    name: 'dshbot:inbox',
    order: 21,
    text: (assembleCtx) => {
      const sessionId = assembleCtx.agent?.session?.id ?? assembleCtx.agent?.id;
      if (!sessionId) return '';
      const scope = deps.getScope();
      const catalog = scope.get() ?? { items: [] };
      const items = catalog.items ?? [];
      const bot = items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
      if (!bot || !Array.isArray(bot.inbox) || bot.inbox.length === 0) return '';
      const batch = prioritizeAgentInbound(bot.inbox);
      pendingDrain.set(bot.id, batch);
      return batch.map((msg) => buildAgentInboundWakePrompt(msg)).join('\n\n');
    },
  });
}

/**
 * Ack peeked inbox after the turn that consumed it (call from host after
 * followup or client open). Idempotent: a second call for the same bot is a
 * no-op, so a duplicate injection of the drain listener cannot double-delete.
 * @param {{ get: () => any, set: (v: any) => void }} scope
 * @param {string} botId
 */
export function ackPendingInboxDrain(scope, botId) {
  const batch = pendingDrain.get(botId);
  if (!batch?.length) return;
  pendingDrain.delete(botId);
  ackInboxMessages(scope, botId, batch);
}
