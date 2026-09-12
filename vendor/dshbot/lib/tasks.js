/**
 * Durable task and A2A control-plane helpers.
 * The host stores the returned values in the dshbot settings catalog.
 */

export const TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
});

const TERMINAL_STATUSES = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]);
// Kept out of TASK_STATUS so current callers cannot offer this historical
// status as a filter or retry option, but persisted records remain immutable.
const LEGACY_TERMINAL_STATUSES = new Set(['expired']);
const RETRYABLE_STATUSES = new Set([
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]);
const MAX_TASK_TEXT = 8_000;
const MAX_CONSTRAINTS = 12;
const MAX_A2A_AUDIT = 200;
const TASK_FIELDS = new Set([
  'id', 'fromId', 'fromName', 'toId', 'toName', 'task', 'constraints',
  'successCriteria', 'idempotencyKey', 'status', 'attempts', 'resultSummary',
  'error', 'createdAt', 'updatedAt', 'events',
]);
const RETRY_LINEAGE_FIELDS = new Set([
  'parentTaskId', 'retryOf', 'lineageRootTaskId', 'retryRequestId',
]);

function cleanText(value, max = MAX_TASK_TEXT) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

export function normalizeTaskConstraints(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry, 500))
    .filter(Boolean)
    .slice(0, MAX_CONSTRAINTS);
}

export function newTaskId(prefix = 'dshbot-task') {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}`;
}

export function isTerminalTaskStatus(status) {
  const value = String(status ?? '');
  return TERMINAL_STATUSES.has(value) || LEGACY_TERMINAL_STATUSES.has(value);
}

export function isRetryableTaskStatus(status) {
  return RETRYABLE_STATUSES.has(String(status ?? ''));
}

export function findTask(tasks, taskId) {
  const id = String(taskId ?? '').trim();
  if (!id) return undefined;
  return (Array.isArray(tasks) ? tasks : []).find((task) => task.id === id);
}

function event(type, actorId, detail, at) {
  return {
    type: String(type),
    actorId: String(actorId ?? ''),
    detail: cleanText(detail, 500),
    at,
  };
}

function withEvent(task, type, actorId, detail, at) {
  return {
    ...task,
    events: [...(Array.isArray(task.events) ? task.events : []), event(type, actorId, detail, at)],
    updatedAt: at,
  };
}

export function createTask(tasks, input, at = Date.now()) {
  const list = Array.isArray(tasks) ? tasks : [];
  const fromId = String(input?.fromId ?? '').trim();
  const toId = String(input?.toId ?? '').trim();
  const idempotencyKey = cleanText(input?.idempotencyKey, 200);
  if (idempotencyKey) {
    const existing = list.find((task) => (
      task.fromId === fromId
      && task.toId === toId
      && task.idempotencyKey === idempotencyKey
    ));
    if (existing) return { task: existing, tasks: list, created: false };
  }
  const task = withEvent({
    id: cleanText(input?.id, 200) || newTaskId(),
    fromId,
    fromName: cleanText(input?.fromName, 200),
    toId,
    toName: cleanText(input?.toName, 200),
    task: cleanText(input?.task),
    constraints: normalizeTaskConstraints(input?.constraints),
    successCriteria: cleanText(input?.successCriteria, 2_000),
    idempotencyKey,
    status: TASK_STATUS.QUEUED,
    attempts: 0,
    resultSummary: '',
    error: '',
    createdAt: at,
    updatedAt: at,
    events: [],
  }, 'created', fromId, 'Task created', at);
  return { task, tasks: [...list, task], created: true };
}

function retryRequestId(input) {
  for (const key of ['requestId', 'operationId', 'idempotencyKey']) {
    if (input?.[key] !== undefined) return cleanText(input[key], 200);
  }
  return '';
}

function uniqueTaskId(tasks) {
  let id = newTaskId();
  let suffix = 0;
  while (findTask(tasks, id)) {
    suffix += 1;
    id = `${newTaskId()}-${suffix}`;
  }
  return id;
}

function lineageRootTaskId(task) {
  return cleanText(
    task?.lineageRootTaskId
      || task?.parentTaskId
      || task?.retryOf
      || task?.id,
    200,
  );
}

/**
 * Creates a new queued attempt for an eligible terminal task without changing
 * the source record. Retry request IDs are durable on the replacement so a
 * repeated command after restart cannot enqueue another attempt.
 */
export function retryTask(tasks, taskId, options = {}, at = Date.now()) {
  if (typeof options === 'number') {
    at = options;
    options = {};
  }
  const list = Array.isArray(tasks) ? tasks : [];
  const current = findTask(list, taskId);
  if (!current) return { ok: false, tasks: list, error: 'Task not found.' };
  if (!isRetryableTaskStatus(current.status)) {
    return {
      ok: false,
      task: current,
      tasks: list,
      error: `Cannot retry a ${current.status} task. Only failed or cancelled tasks can be retried.`,
    };
  }

  const requestId = retryRequestId(options);
  if (requestId) {
    const existing = list.find((task) => task?.retryRequestId === requestId);
    if (existing) {
      if (existing.parentTaskId !== current.id && existing.retryOf !== current.id) {
        return {
          ok: false,
          task: current,
          tasks: list,
          error: `Retry request id ${requestId} is already used for a different source task.`,
        };
      }
      return {
        ok: true,
        task: existing,
        originalTask: current,
        tasks: list,
        created: false,
        idempotent: true,
        requestId,
      };
    }
  }

  let replacementId = cleanText(options?.id, 200);
  if (!replacementId || findTask(list, replacementId)) replacementId = uniqueTaskId(list);
  const created = createTask(list, {
    ...current,
    id: replacementId,
    idempotencyKey: '',
  }, at);
  const preserved = Object.fromEntries(
    Object.entries(current).filter(([key]) => !TASK_FIELDS.has(key) && !RETRY_LINEAGE_FIELDS.has(key)),
  );
  const replacement = {
    ...created.task,
    ...preserved,
    events: created.task.events.map((entry, index) => index === 0
      ? { ...entry, detail: `Retry of task ${current.id} queued.` }
      : entry),
    parentTaskId: current.id,
    retryOf: current.id,
    lineageRootTaskId: lineageRootTaskId(current),
    ...(requestId ? { retryRequestId: requestId } : {}),
    ...(current.idempotencyKey ? { originalIdempotencyKey: current.idempotencyKey } : {}),
  };
  return {
    ok: true,
    task: replacement,
    originalTask: current,
    tasks: created.tasks.map((entry) => entry.id === replacement.id ? replacement : entry),
    created: true,
    idempotent: false,
    requestId,
  };
}

export function markTaskDelivered(tasks, taskId, actorId, at = Date.now()) {
  const current = findTask(tasks, taskId);
  if (!current) return { ok: false, tasks: Array.isArray(tasks) ? tasks : [], error: 'Task not found.' };
  if (isTerminalTaskStatus(current.status) || current.status === TASK_STATUS.DELIVERED) {
    return { ok: true, task: current, tasks: Array.isArray(tasks) ? tasks : [] };
  }
  if (current.status === TASK_STATUS.PAUSED) return { ok: false, task: current, tasks, error: 'Task is paused.' };
  const next = withEvent({
    ...current,
    status: TASK_STATUS.DELIVERED,
    attempts: Number(current.attempts) + 1,
  }, 'delivered', actorId, 'Task reached the recipient.', at);
  return {
    ok: true,
    task: next,
    tasks: tasks.map((entry) => entry.id === next.id ? next : entry),
  };
}

export function finishTask(tasks, taskId, status, actorId, patch = {}, at = Date.now()) {
  const current = findTask(tasks, taskId);
  if (!current) return { ok: false, tasks: Array.isArray(tasks) ? tasks : [], error: 'Task not found.' };
  const nextStatus = String(status ?? '');
  if (![TASK_STATUS.COMPLETED, TASK_STATUS.FAILED].includes(nextStatus)) {
    return { ok: false, tasks, error: 'Task status must be completed or failed.' };
  }
  if (isTerminalTaskStatus(current.status)) {
    return { ok: true, task: current, tasks };
  }
  if (current.status === TASK_STATUS.PAUSED) return { ok: false, tasks, error: 'Task is paused.' };
  let working = current;
  if (working.status === TASK_STATUS.QUEUED) {
    working = withEvent({
      ...working,
      status: TASK_STATUS.DELIVERED,
      attempts: Number(working.attempts) + 1,
    }, 'delivered', actorId, 'Task was completed after queued delivery.', at);
  }
  const resultSummary = cleanText(patch.resultSummary, 4_000);
  const error = cleanText(patch.error, 2_000);
  const next = withEvent({
    ...working,
    status: nextStatus,
    resultSummary: nextStatus === TASK_STATUS.COMPLETED ? resultSummary : '',
    error: nextStatus === TASK_STATUS.FAILED ? error : '',
  }, nextStatus, actorId, nextStatus === TASK_STATUS.COMPLETED ? resultSummary : error, at);
  return {
    ok: true,
    task: next,
    tasks: tasks.map((entry) => entry.id === next.id ? next : entry),
  };
}

/**
 * A direct delegation is allowed when the target explicitly grants the sender,
 * or when both bots share a group room. Empty allowlists preserve ordinary
 * message compatibility but do not grant arbitrary task delegation.
 */
export function canDelegateToAgent(items, fromBotId, toBotId) {
  const list = Array.isArray(items) ? items : [];
  const target = list.find((entry) => entry.id === toBotId && entry.kind !== 'room');
  if (!target) return false;
  const allowed = Array.isArray(target.allowedSenderIds) ? target.allowedSenderIds : [];
  if (allowed.length > 0) return allowed.includes(fromBotId);
  return list.some((entry) => (
    entry.kind === 'room'
    && Array.isArray(entry.memberBotIds)
    && entry.memberBotIds.includes(fromBotId)
    && entry.memberBotIds.includes(toBotId)
  ));
}

export function appendA2AAudit(audit, input, at = Date.now()) {
  const row = {
    id: newTaskId('dshbot-a2a'),
    type: cleanText(input?.type, 100),
    taskId: cleanText(input?.taskId, 200),
    fromId: cleanText(input?.fromId, 200),
    toId: cleanText(input?.toId, 200),
    detail: cleanText(input?.detail, 1_000),
    at,
  };
  return [...(Array.isArray(audit) ? audit : []), row].slice(-MAX_A2A_AUDIT);
}

/** Add the delivery audit once for a task, including after a projection retry. */
export function appendTaskDeliveredAudit(audit, input, at = Date.now()) {
  const taskId = cleanText(input?.taskId, 200);
  if (taskId && (Array.isArray(audit) ? audit : []).some((row) => (
    row?.type === 'task.delivered' && row.taskId === taskId
  ))) return Array.isArray(audit) ? audit : [];
  return appendA2AAudit(audit, { ...input, type: 'task.delivered', taskId }, at);
}

export function tasksForBot(tasks, botId, options = {}) {
  const id = String(botId ?? '');
  let rows = (Array.isArray(tasks) ? tasks : []).filter((task) => (
    task.fromId === id || task.toId === id
  ));
  if (options.taskId) rows = rows.filter((task) => task.id === options.taskId);
  if (options.status) {
    const status = String(options.status);
    if (!Object.values(TASK_STATUS).includes(status)) return [];
    rows = rows.filter((task) => task.status === status);
  }
  return rows.slice(-Math.max(1, Math.min(50, Number(options.limit) || 20)));
}

export function taskStatusDetail(task) {
  if (!task) return 'Task not found.';
  const result = task.status === TASK_STATUS.COMPLETED
    ? task.resultSummary
    : task.status === TASK_STATUS.FAILED ? task.error : '';
  return `[${task.status}] ${task.id}${result ? ` — ${result}` : ''}`;
}
