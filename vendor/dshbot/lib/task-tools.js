/**
 * Host tools for structured A2A tasks.
 * Tasks remain native dshbot catalog data so the standalone plugin has no
 * database or worker dependency.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { botDisplayName } from './bot-identity.js';
import {
  clampAgentMessage,
  enqueueAgentInbound,
  resolveSendToAgentTarget,
} from './agent-messaging.js';
import { wakeAgent, wakeFailureDetail } from './agent-resolution.js';
import { upsertItem } from './catalog.js';
import { projectCatalog } from './catalog-scope.js';
import {
  claimInboxMessages,
  commitInboxMessages,
  inboxMessagesOwned,
  inboxMessagesPresent,
  releaseInboxMessages,
  reserveInboxMessages,
} from './inbox-drain.js';
import {
  TASK_STATUS,
  appendA2AAudit,
  appendTaskDeliveredAudit,
  canDelegateToAgent,
  createTask,
  finishTask,
  findTask,
  isTerminalTaskStatus,
  markTaskDelivered,
  tasksForBot,
  taskStatusDetail,
} from './tasks.js';
import { registerWorkSettlement, taskUpdateMessage } from './work-settlement.js';

function readCatalog(scope) {
  return scope.get() ?? { items: [], tasks: [], audit: [] };
}

function senderFor(items, sessionId) {
  return items.find((entry) => (
    entry.sessionId === sessionId && entry.kind !== 'room'
  ));
}

function currentOpenTurn(session) {
  if (typeof session?.snapshotEvents !== 'function') return undefined;
  let events;
  try {
    events = session.snapshotEvents();
  } catch {
    return undefined;
  }
  if (!Array.isArray(events)) return undefined;
  const turnStartIndex = events.findLastIndex((event) => event?.type === 'turn/start');
  if (turnStartIndex < 0) return undefined;
  const turnEndIndex = events.findLastIndex((event) => event?.type === 'turn/end');
  if (turnEndIndex > turnStartIndex) return undefined;
  const turn = events[turnStartIndex]?.data?.turn;
  if (!Number.isSafeInteger(turn) || turn <= 0) return undefined;
  const step = events.findLast((event) => (
    event?.type === 'step/start' && event.data?.turn === turn
  ));
  return step ? turn : undefined;
}

function taskOwnedByCurrentRelay(scope, sender, task, exec) {
  if (exec?.purpose !== undefined || exec?.agent?.purpose !== undefined) return false;
  const session = exec?.agent?.session;
  const sessionId = String(session?.id ?? '').trim();
  if (!sessionId || sessionId !== String(sender.sessionId ?? '').trim()) return false;
  const turn = currentOpenTurn(session);
  if (turn === undefined) return false;

  // An empty claim is read-only: an existing exact-turn claim is returned;
  // an unbound turn has no selectable messages and creates no ownership.
  const claimed = claimInboxMessages(scope, sender.id, [], { sessionId, turn });
  return claimed.some((message) => (
    message?.kind === 'task' && String(message.taskId ?? '') === String(task.id)
  ));
}

async function refusal(scope, catalog, fromId, toId, detail, type = 'task.refused') {
  await scope.set({
    ...catalog,
    audit: appendA2AAudit(catalog.audit, {
      type,
      fromId,
      toId,
      detail,
    }),
  }, catalog);
  return { ok: false, taskId: '', status: 'refused', detail };
}

function taskLine(task, items) {
  const from = items.find((item) => item.id === task.fromId && item.kind !== 'room');
  const to = items.find((item) => item.id === task.toId && item.kind !== 'room');
  const fromName = from ? botDisplayName(from) : (task.fromName || task.fromId);
  const toName = to ? botDisplayName(to) : (task.toName || task.toId);
  const route = `${fromName} -> ${toName}`;
  const constraints = Array.isArray(task.constraints) && task.constraints.length > 0
    ? task.constraints.map((entry) => `- ${String(entry ?? '')}`).join('\n')
    : '(none)';
  return [
    `${taskStatusDetail(task)} (${route})${task.attempts ? ` attempts=${task.attempts}` : ''}`,
    `Task: ${String(task.task ?? '') || '(none)'}`,
    `Constraints:\n${constraints}`,
    `Success criteria: ${String(task.successCriteria ?? '') || '(none)'}`,
    `Result: ${String(task.resultSummary ?? '') || '(none)'}`,
    `Error: ${String(task.error ?? '') || '(none)'}`,
  ].join('\n');
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ getScope: () => { get: () => any, set: (next: any, previous: any) => Promise<void> } }} deps
 */
export function registerTaskTools(ctx, deps) {
  const getScope = deps.getScope;
  registerWorkSettlement(ctx, deps);

  ctx.tools.register(defineTool({
    name: 'delegate_to_agent',
    description: 'Create an asynchronous task for a permitted peer bot with explicit constraints and success criteria.',
    timeoutMs: 30_000,
    parameters: {
      botId: {
        type: 'string',
        required: true,
        description: 'Catalog id of the peer bot. Direct task delegation is limited to shared-room peers or explicit allowlists.',
      },
      task: {
        type: 'string',
        required: true,
        description: 'The concrete task to perform.',
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rules or boundaries the recipient must follow.',
      },
      successCriteria: {
        type: 'string',
        description: 'What a satisfactory result must contain.',
      },
      idempotencyKey: {
        type: 'string',
        description: 'Stable caller-chosen key. Reusing it returns the existing task instead of creating a duplicate.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Delegate task',
      kind: 'other',
      content: [{ type: 'text', text: String(args.task ?? '') }],
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.ok ? 'Task delegated' : 'Task refused',
      content: [{ type: 'text', text: String(result.value?.detail ?? '') }],
    }),
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent?.session?.id) throw new Error('delegate_to_agent requires a calling agent session');
      const scope = getScope();
      const catalog = readCatalog(scope);
      const sender = senderFor(catalog.items ?? [], parent.session.id);
      if (!sender) throw new Error('delegate_to_agent is only available from a 1:1 bot session');

      const taskText = clampAgentMessage(args.task);
      if (!taskText) return refusal(scope, catalog, sender.id, String(args.botId ?? ''), 'Task was empty; nothing was delegated.');
      const resolved = resolveSendToAgentTarget(catalog.items ?? [], sender.id, String(args.botId ?? ''));
      if (!resolved.ok) return refusal(scope, catalog, sender.id, String(args.botId ?? ''), resolved.error);
      if (resolved.toGroup) {
        return refusal(scope, catalog, sender.id, resolved.to.id, 'Tasks target individual bots only; use send_to_agent to post into a group room.');
      }
      if (!canDelegateToAgent(catalog.items ?? [], sender.id, resolved.to.id)) {
        return refusal(
          scope,
          catalog,
          sender.id,
          resolved.to.id,
          `Task delegation to ${botDisplayName(resolved.to, resolved.to.id)} is not permitted. Share a group room or add the sender to the target allowlist.`,
        );
      }

      const at = Date.now();
      const created = createTask(catalog.tasks, {
        fromId: sender.id,
        fromName: botDisplayName(sender),
        toId: resolved.to.id,
        toName: botDisplayName(resolved.to, resolved.to.id),
        task: taskText,
        constraints: args.constraints,
        successCriteria: args.successCriteria,
        idempotencyKey: args.idempotencyKey,
      }, at);
      if (!created.created) {
        return {
          ok: true,
          taskId: created.task.id,
          status: created.task.status,
          detail: `Task already exists: ${taskStatusDetail(created.task)}.`,
        };
      }

      const inbound = {
        kind: 'task',
        taskId: created.task.id,
        task: created.task.task,
        constraints: created.task.constraints,
        successCriteria: created.task.successCriteria,
        fromId: sender.id,
        fromName: botDisplayName(sender),
        text: created.task.task,
        timestampMs: at,
      };
      const target = {
        ...resolved.to,
        inbox: enqueueAgentInbound(resolved.to.inbox, inbound),
        updatedAt: at,
      };
      await scope.set({
        ...catalog,
        items: upsertItem(catalog.items ?? [], target),
        tasks: created.tasks,
        audit: appendA2AAudit(catalog.audit, {
          type: 'task.created',
          taskId: created.task.id,
          fromId: sender.id,
          toId: resolved.to.id,
          detail: 'Task queued.',
        }, at),
      }, catalog);

      const wake = await wakeTaskAgent(ctx, scope, target, inbound);
      if (wake.ok && wake.owned) {
        await projectCatalog(scope, (latest) => {
          if (!inboxMessagesPresent(scope, resolved.to.id, [inbound])
            || !inboxMessagesOwned(scope, resolved.to.id, [inbound])) return latest;
          const delivered = markTaskDelivered(latest.tasks, created.task.id, resolved.to.id);
          if (!delivered.ok || delivered.task.status !== TASK_STATUS.DELIVERED) return latest;
          return {
            ...latest,
            tasks: delivered.tasks,
            audit: appendTaskDeliveredAudit(latest.audit, {
              taskId: created.task.id,
              fromId: sender.id,
              toId: resolved.to.id,
              detail: 'Recipient wake accepted.',
            }),
          };
        });
      }
      const latestTask = findTask(readCatalog(scope).tasks, created.task.id) ?? created.task;
      return {
        ok: true,
        taskId: latestTask.id,
        status: latestTask.status,
        detail: wake.ok
          ? wake.owned
            ? `Delegated ${latestTask.id} to ${botDisplayName(resolved.to, resolved.to.id)}; the recipient was woken asynchronously.`
            : `Queued ${latestTask.id} for ${botDisplayName(resolved.to, resolved.to.id)}; the recipient wake was accepted but its exact inbox snapshot is still owned by the active turn.`
          : `Queued ${latestTask.id} for ${botDisplayName(resolved.to, resolved.to.id)}; the recipient wake failed (${wakeFailureDetail(wake)}). The task remains queued for a later explicit wake.`,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'update_task',
    description: 'Report the completed or failed result of a delegated task addressed to this bot.',
    timeoutMs: 30_000,
    parameters: {
      taskId: { type: 'string', required: true, description: 'The delegated task id from the task prompt.' },
      status: { type: 'string', required: true, description: 'Use completed or failed.' },
      summary: { type: 'string', description: 'Concise result summary when completed.' },
      error: { type: 'string', description: 'Concise failure reason when failed.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent?.session?.id) throw new Error('update_task requires a calling agent session');
      const scope = getScope();
      const catalog = readCatalog(scope);
      const sender = senderFor(catalog.items ?? [], parent.session.id);
      if (!sender) throw new Error('update_task is only available from a 1:1 bot session');
      const task = findTask(catalog.tasks, args.taskId);
      if (!task) return refusal(scope, catalog, sender.id, '', 'Task not found.', 'task.update_refused');
      if (task.toId !== sender.id) {
        return refusal(scope, catalog, sender.id, task.fromId, 'Only the assigned recipient can update this task.', 'task.update_refused');
      }
      if (!taskOwnedByCurrentRelay(scope, sender, task, exec)) {
        return refusal(
          scope,
          catalog,
          sender.id,
          task.fromId,
          'Only the consuming relay turn that owns this task may update it.',
          'task.update_refused',
        );
      }
      if (![TASK_STATUS.COMPLETED, TASK_STATUS.FAILED].includes(String(args.status ?? ''))) {
        return refusal(scope, catalog, sender.id, task.fromId, 'Task status must be completed or failed.', 'task.update_refused');
      }
      if (isTerminalTaskStatus(task.status)) {
        return { ok: true, taskId: task.id, status: task.status, detail: `Task already ended: ${taskStatusDetail(task)}.` };
      }

      const status = String(args.status);
      const at = Date.now();
      const finished = finishTask(catalog.tasks, task.id, status, sender.id, {
        resultSummary: args.summary,
        error: args.error,
      }, at);
      if (!finished.ok) return refusal(scope, catalog, sender.id, task.fromId, finished.error, 'task.update_refused');
      const update = taskUpdateMessage(finished.task, sender.id, botDisplayName(sender), at);
      const source = (catalog.items ?? []).find((entry) => entry.id === task.fromId && entry.kind !== 'room');
      const nextItems = source
        ? upsertItem(catalog.items ?? [], {
          ...source,
          inbox: enqueueAgentInbound(source.inbox, update),
          updatedAt: at,
        })
        : catalog.items ?? [];
      await scope.set({
        ...catalog,
        items: nextItems,
        tasks: finished.tasks,
        audit: appendA2AAudit(catalog.audit, {
          type: `task.${status}`,
          taskId: task.id,
          fromId: task.fromId,
          toId: sender.id,
          detail: taskStatusDetail(finished.task),
        }, at),
      }, catalog);

      const wake = source
        ? await wakeAgent(ctx, source, `Check your current dshbot inbox for pending task updates.`)
        : { ok: false, error: new Error('Requester bot is unavailable.') };
      return {
        ok: true,
        taskId: finished.task.id,
        status: finished.task.status,
        detail: wake.ok
          ? `${taskStatusDetail(finished.task)}. The requester was notified asynchronously.`
          : `${taskStatusDetail(finished.task)}. The result update is durable, but the requester wake failed (${wakeFailureDetail(wake)}).`,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'list_tasks',
    description: 'List delegated tasks sent by or assigned to this bot, optionally filtered by id or status.',
    timeoutMs: 10_000,
    parameters: {
      taskId: { type: 'string', description: 'Return one task when provided.' },
      status: { type: 'string', description: 'Filter by queued, delivered, paused, completed, failed, or cancelled.' },
      limit: { type: 'number', description: 'Maximum number of rows, capped at 50.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          tasks: { type: 'array', items: { type: 'string' }, required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent?.session?.id) throw new Error('list_tasks requires a calling agent session');
      const scope = getScope();
      const catalog = readCatalog(scope);
      const sender = senderFor(catalog.items ?? [], parent.session.id);
      if (!sender) throw new Error('list_tasks is only available from a 1:1 bot session');
      const rows = tasksForBot(catalog.tasks, sender.id, {
        taskId: args.taskId,
        status: args.status,
        limit: args.limit,
      });
      const tasks = rows.map((task) => taskLine(task, catalog.items ?? []));
      return {
        ok: true,
        tasks,
        detail: tasks.length > 0 ? tasks.join('\n') : 'No matching delegated tasks.',
      };
    },
  }));
}

async function wakeTaskAgent(ctx, scope, target, inbound) {
  const current = findTask(readCatalog(scope).tasks, inbound.taskId);
  if (!current || !['queued', 'delivered'].includes(current.status)) {
    return { ok: false, error: new Error('Task is no longer pending.') };
  }
  reserveInboxMessages(scope, target.id, [inbound]);
  const wake = await wakeAgent(ctx, target, 'Check your current dshbot inbox for pending tasks. Ignore paused or cancelled tasks.');
  if (!wake.ok) {
    releaseInboxMessages(scope, target.id, [inbound]);
    return wake;
  }
  const owned = commitInboxMessages(scope, target.id, [inbound]);
  return {
    ...wake,
    owned: owned.length > 0
      && inboxMessagesOwned(scope, target.id, [inbound])
      && inboxMessagesPresent(scope, target.id, [inbound]),
  };
}
