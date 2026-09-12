/**
 * Binds delegated task mail to the exact recipient turn that admitted it.
 * The binding is process-local on purpose: the durable task and inbox remain
 * the source of truth, while this avoids adding execution fields to the
 * catalog schema.
 */
import { enqueueAgentInbound } from './agent-messaging.js';
import { wakeAgent } from './agent-resolution.js';
import { botDisplayName } from './bot-identity.js';
import { projectCatalog } from './catalog-scope.js';
import { inboxMessagesOwned } from './inbox-drain.js';
import {
  TASK_STATUS,
  appendA2AAudit,
  finishTask,
  findTask,
  isTerminalTaskStatus,
} from './tasks.js';

const states = new WeakMap();
const RELAY_SOURCE = { kind: 'plugin', plugin: 'dshbot', form: 'relay' };
const COMPLETED_WITHOUT_UPDATE = Object.freeze({ kind: 'completed_without_update' });

function stateFor(scope) {
  let state = states.get(scope);
  if (!state) {
    state = {
      bindings: new Map(),
      settling: new Set(),
      tail: Promise.resolve(),
    };
    states.set(scope, state);
  }
  return state;
}

function serial(state, work) {
  const result = state.tail.then(work, work);
  state.tail = result.catch(() => {});
  return result;
}

function bindingKey(sessionId, turn) {
  return `${String(sessionId ?? '')}\0${String(turn ?? '')}`;
}

function isRelayMessage(message) {
  return message?.source?.kind === RELAY_SOURCE.kind
    && message.source.plugin === RELAY_SOURCE.plugin
    && message.source.form === RELAY_SOURCE.form;
}

function botForSession(catalog, sessionId) {
  return (catalog.items ?? []).find((item) => (
    item.kind !== 'room' && item.sessionId === sessionId
  ));
}

function relayOwnedTaskIds(scope, catalog, bot) {
  const inbox = bot?.inbox ?? [];
  const owned = inbox.filter((message) => inboxMessagesOwned(scope, bot.id, [message]));
  const ownedTaskIds = [...new Set(owned
    .filter((message) => message.kind === 'task')
    .map((message) => message.taskId)
    .filter(Boolean))];
  if (owned.length > 0) return ownedTaskIds;

  // The in-memory ownership ledger is lost on restart. A delivered task is
  // the durable relay-acceptance marker, but it still needs its actual mail.
  const delivered = new Set((catalog.tasks ?? [])
    .filter((task) => task.toId === bot.id && task.status === TASK_STATUS.DELIVERED)
    .map((task) => task.id));
  return [...new Set(inbox
    .filter((message) => message.kind === 'task' && delivered.has(message.taskId))
    .map((message) => message.taskId)
    .filter(Boolean))];
}

function failureDetail(reason, fallback = 'Recipient task turn failed.') {
  if (reason?.kind === COMPLETED_WITHOUT_UPDATE.kind) {
    return 'Automatic failure: recipient turn ended normally without submitting update_task.';
  }
  const kind = String(reason?.kind ?? 'error');
  const message = String(reason?.error?.message ?? reason?.error?.detail ?? '').trim();
  return `Automatic failure: recipient turn ${kind}${message ? `: ${message}` : ''}.`;
}

export function taskUpdateMessage(task, actorId, actorName, at) {
  const completed = task.status === TASK_STATUS.COMPLETED;
  const detail = completed
    ? task.resultSummary || 'completed without a summary'
    : task.error || 'failed without a reason';
  return {
    kind: 'task-update',
    taskId: task.id,
    fromId: actorId,
    fromName: actorName,
    text: `[Task update] ${task.id} is ${task.status}: ${detail}`,
    timestampMs: at,
  };
}

function reasonForError(error) {
  const message = String(error?.message ?? error?.failure?.message ?? error ?? '').trim();
  return { kind: 'error', error: message ? { message } : undefined };
}

async function settleTurn(scope, ctx, binding, reason, now) {
  const settled = new Set();
  const detail = failureDetail(reason);
  const at = now();
  const final = await projectCatalog(scope, (catalog) => {
    let tasks = catalog.tasks ?? [];
    let items = catalog.items ?? [];
    let audit = catalog.audit ?? [];
    let changed = false;
    for (const taskId of binding.taskIds) {
      const current = findTask(tasks, taskId);
      if (!current || current.toId !== binding.botId || isTerminalTaskStatus(current.status)) continue;
      const finished = finishTask(tasks, taskId, TASK_STATUS.FAILED, binding.botId, { error: detail }, at);
      if (!finished.ok || isTerminalTaskStatus(current.status)) continue;
      tasks = finished.tasks;
      settled.add(taskId);
      changed = true;
      const target = items.find((item) => item.id === current.fromId && item.kind !== 'room');
      if (target) {
        const recipient = items.find((item) => item.id === binding.botId && item.kind !== 'room');
        const actorName = recipient
          ? botDisplayName(recipient)
          : (binding.botName || current.toName || binding.botId);
        const update = taskUpdateMessage(finished.task, binding.botId, actorName, at);
        items = items.map((item) => item.id === target.id
          ? { ...item, inbox: enqueueAgentInbound(item.inbox, update), updatedAt: at }
          : item);
      }
      audit = appendA2AAudit(audit, {
        type: 'task.failed',
        taskId: current.id,
        fromId: current.fromId,
        toId: binding.botId,
        detail,
      }, at);
    }
    return changed ? { ...catalog, items, tasks, audit } : catalog;
  });

  for (const taskId of settled) {
    const task = findTask(final.tasks, taskId);
    const lastEvent = task?.events?.at(-1);
    if (task?.status !== TASK_STATUS.FAILED
      || task.error !== detail
      || lastEvent?.type !== TASK_STATUS.FAILED
      || lastEvent.actorId !== binding.botId) continue;
    const source = (final.items ?? []).find((item) => item.id === task.fromId && item.kind !== 'room');
    if (!source) continue;
    const wake = await wakeAgent(ctx, source, 'Check your current dshbot inbox for pending task updates.');
    if (!wake.ok) {
      // The result update is already durable. A failed origin wake must not
      // turn a truthful task failure into a retry loop or a lost notification.
      ctx.logger?.warn?.('dshbot task result wake failed: %s', String(wake.error?.message ?? wake.error));
    }
  }
}

function settleKey(scope, ctx, key, reason, now) {
  const state = stateFor(scope);
  if (state.settling.has(key)) return;
  const binding = state.bindings.get(key);
  if (!binding) return;
  state.settling.add(key);
  void serial(state, async () => {
    try {
      await settleTurn(scope, ctx, binding, reason, now);
    } catch (error) {
      ctx.logger?.warn?.('dshbot delegated task settlement failed: %s', String(error?.message ?? error));
    } finally {
      state.bindings.delete(key);
      state.settling.delete(key);
    }
  });
}

function settleEndedTurn(scope, ctx, sessionId, turn, reason, now) {
  const key = bindingKey(sessionId, turn);
  if (reason?.kind === 'completed') {
    // A normal turn end is not a business result. settleTurn re-reads the
    // catalog so an already committed update_task remains authoritative.
    settleKey(scope, ctx, key, COMPLETED_WITHOUT_UPDATE, now);
    return;
  }
  settleKey(scope, ctx, key, reason, now);
}

/**
 * Register task-turn binding and automatic failure settlement.
 * @param {import('@deepseek-ai/cordis').Context | object} ctx
 * @param {{ getScope: () => object, now?: () => number }} deps
 */
export function registerWorkSettlement(ctx, deps) {
  const scope = deps.getScope();
  const now = deps.now ?? Date.now;
  const state = stateFor(scope);

  ctx.effect?.(() => () => {
    state.bindings.clear();
    state.settling.clear();
  });

  ctx.on?.('agent/pre-step', async ({ agent, messages, turn }, next) => {
    const decision = await next();
    // A user-created turn may see ordinary inbox context, but it is not a
    // delegated wake and must not become the task's execution identity.
    const relay = messages === undefined || messages.some(isRelayMessage);
    if (decision.kind !== 'enter' || !relay) return decision;
    const catalog = scope.get() ?? { items: [], tasks: [] };
    const bot = botForSession(catalog, agent?.session?.id);
    const taskIds = bot ? relayOwnedTaskIds(scope, catalog, bot) : [];
    if (taskIds.length > 0) {
      state.bindings.set(bindingKey(agent.session.id, turn), {
        botId: bot.id,
        botName: botDisplayName(bot),
        taskIds,
      });
    }
    return decision;
  });

  ctx.on?.('agent/error', ({ agent, turn, error }) => {
    settleKey(scope, ctx, bindingKey(agent?.session?.id, turn), reasonForError(error), now);
  });

  ctx.on?.('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    settleEndedTurn(scope, ctx, session?.id, event.data?.turn, event.data?.reason, now);
  });

  // Some lightweight hosts expose status but not the session event firehose.
  // Use the exact bound turn if a durable end event is already available.
  ctx.on?.('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || typeof agent?.session?.snapshotEvents !== 'function') return;
    const sessionId = agent.session.id;
    const events = agent.session.snapshotEvents();
    const stateForScope = stateFor(scope);
    let catalog;
    try {
      catalog = scope.get();
    } catch {
      return;
    }
    const bot = botForSession(catalog, sessionId);
    for (const [key, binding] of stateForScope.bindings) {
      if (binding.botId !== bot?.id) continue;
      const turn = Number(key.split('\0')[1]);
      const end = events.findLast((event) => event.type === 'turn/end' && event.data?.turn === turn);
      if (end) settleEndedTurn(scope, ctx, sessionId, turn, end.data.reason, now);
    }
  });

  return {
    reset() {
      state.bindings.clear();
      state.settling.clear();
    },
  };
}
