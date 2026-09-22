import fs from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { enqueueAgentInbound } from './agent-messaging.js';
import { botDisplayName } from './bot-identity.js';
import { upsertItem } from './catalog.js';
import { projectCatalog } from './catalog-scope.js';
import { wakeAgent } from './agent-resolution.js';
import {
  commitInboxMessages,
  inboxMessagesOwned,
  inboxMessagesPresent,
  releaseInboxMessages,
  reserveInboxMessages,
} from './inbox-drain.js';
import {
  TASK_STATUS,
  appendTaskDeliveredAudit,
  appendA2AAudit,
  canDelegateToAgent,
  findTask,
  isRetryableTaskStatus,
  markTaskDelivered,
  retryTask,
} from './tasks.js';
import { abortRoomMemberTurns } from './ask-participant.js';
import { nextTurnEpoch } from './group-chat-host.js';
import { createProfileOperations } from './profile-ops.js';
import {
  appendRoutineRun,
  createRoutineRun,
  isSilentResponse,
  ROUTINE_RUN_STATUS,
  updateRoutineRun,
} from './routine-runs.js';
import {
  deleteRoutineNotepad,
  readRoutineNotepad,
} from './routine-notepad.js';
import { runWatch } from './routine-watch.js';
import { sanitizeMemoryForPrompt } from './memory.js';
import {
  missedRoutine,
  nextRoutineRun,
  normalizeRoutineSchedule,
  routineReachedLimit,
  scheduleFromRoutine,
} from './schedule.js';
import { groupMemberRuntimeSnapshot } from './group-member-runtime.js';
import {
  goalRefOf,
  goalViewFor,
  goalsService,
  resumeObjective,
  syncObjective,
} from './objective.js';
import { pushWorkNote } from './memory-review.js';

const MAX_ROUTINES = 100;
const MAX_ROUTINE_OUTPUT = 8_000;
const MAX_WATCH_VALUE = 2_000;
const fail = (message) => { throw new Error(message); };
const dshHomeDir = () => process.env.DSH_HOME || process.env.DSHD_HOME || '';
const text = (value, limit, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`Invalid ${label}.`);
  return value.trim();
};
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(`Invalid ${label}.`);
  return value;
};
const retryRequestId = (input) => {
  for (const key of ['requestId', 'operationId', 'idempotencyKey']) {
    if (input?.[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > 200) fail('Invalid retry request id.');
    const value = input[key].trim();
    if (!value) fail('Retry request id is required.');
    return value;
  }
  fail('Retry request id is required.');
};

const routineOccupied = (routine, catalog) => ['queued', 'running'].includes(routine.lastOutcome) ||
  !['completed', 'failed'].includes(routine.lastOutcome) && routine.pendingRunId &&
  catalog.items.some((item) => item.inbox.some((mail) => mail.routineId === routine.id && mail.runId === routine.pendingRunId));

const normalizeRoutineWatch = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const kind = value?.kind;
  if (kind !== 'url' && kind !== 'command') fail('Invalid routine watch kind.');
  const watchValue = String(value?.value ?? '').trim();
  if (!watchValue || watchValue.length > MAX_WATCH_VALUE) fail('Invalid routine watch target.');
  const timeoutMs = integer(Number(value?.timeoutMs ?? 15_000), 1, 300_000, 'watch timeout');
  return { kind, value: watchValue, timeoutMs };
};

/** contextFrom keeps 'self' plus ids of other routines owned by the same bot. */
const normalizeContextFrom = (input, current, routines, botId) => {
  const source = Object.hasOwn(input, 'contextFrom') ? input.contextFrom : current?.contextFrom;
  const candidates = new Set((routines ?? [])
    .filter((row) => row.id !== current?.id && row.botId === botId)
    .map((row) => row.id));
  return [...new Set((Array.isArray(source) ? source : []).map((entry) => String(entry ?? '').trim()))]
    .filter((entry) => entry === 'self' || candidates.has(entry))
    .slice(0, 3);
};

const watchCwd = (target) => {
  const candidate = String(target?.workspaceId ?? '');
  try {
    if (candidate && fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    // Unresolvable workspace ids fall back to the dsh home below.
  }
  return dshHomeDir() || undefined;
};

/** Assistant text emitted during one routine turn, newest run capped at 8k. */
const routineTurnOutput = (events, turn) => {
  const parts = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message' || Number(event.data?.turn) !== turn) continue;
    const message = event.data?.message ?? event.data;
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('\n').trim().slice(0, MAX_ROUTINE_OUTPUT);
};

/** Serializes this controller's commands; settings revisions also fence other writers. */
export function createControlPlane(ctx, scope, { now = Date.now, capabilities = () => ({ tools: [], skills: [], mcp: [] }), memoryLimits, objective = null } = {}) {
  let tail = Promise.resolve();
  let disposed = false;
  const serial = (work) => {
    const result = tail.then(() => { if (disposed) fail('Bot runtime is stopped.'); return work(); });
    tail = result.catch(() => {});
    return result;
  };
  const view = () => {
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === 'dshbot');
    if (!descriptor) fail('Bot catalog is unavailable.');
    return { ns: 'dshbot', revision: descriptor.revision, value: descriptor.value,
      schema: descriptor.schema ?? {}, applies: descriptor.applies ?? 'live', secrets: [],
      ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
      ...(descriptor.user === undefined ? {} : { user: descriptor.user }) };
  };
  const checkRevision = (revision) => {
    if (ctx.settings.writable === false) fail('Bot catalog is read-only.');
    if (!Number.isInteger(revision) || revision !== view().revision) fail('Bot catalog changed. Refresh and try again.');
  };
  const bot = (catalog, id) => catalog.items.find((item) => item.id === id && item.kind !== 'room') ?? fail('Bot is unavailable.');
  const audit = (catalog, type, detail, taskId = '', toId = '') => appendA2AAudit(catalog.audit, { type, fromId: 'user', toId, taskId, detail }, now());
  const failedRoutine = (routine, runId, lastError, { disable = false, nextRunAt, status = ROUTINE_RUN_STATUS.FAILED, output } = {}) => {
    const failureCount = Number(routine.failureCount ?? 0) + 1;
    const withRun = updateRoutineRun(routine, runId, {
      status,
      error: lastError,
      endedAt: now(),
      ...(output === undefined ? {} : { output }),
    });
    return { ...withRun,
      ...(nextRunAt === undefined ? {} : { nextRunAt }),
      pendingRunId: '', lastOutcome: 'failed', runSessionId: '', runTurn: 0,
      failureCount, enabled: disable || failureCount >= 3 ? false : routine.enabled,
      lastError, updatedAt: now() };
  };
  const resolveAgent = async (target) => {
    const live = ctx.agents.get(target.sessionId);
    if (live) return live;
    const controller = ctx.get?.('sessionController');
    if (!controller?.resolveAgent) return undefined;
    // The Session Controller owns preset/model composition and cold-session resume.
    // Never reconstruct a blank replacement for a missing historical session.
    const result = await controller.resolveAgent(target.sessionId);
    if (disposed) fail('Bot runtime stopped during session resume.');
    if (result.error) throw result.error;
    return result.agent;
  };
  const wake = async (
    target,
    instruction = 'Check your current dshbot inbox for pending work. Ignore paused or cancelled tasks.',
    messages = [],
  ) => {
    const batch = Array.isArray(messages) ? messages : [];
    if (batch.length > 0) reserveInboxMessages(scope, target.id, batch);
    const result = await wakeAgent(ctx, target, instruction);
    if (!result.ok) {
      if (batch.length > 0) releaseInboxMessages(scope, target.id, batch);
      return { accepted: false, owned: false, error: result.error };
    }
    const owned = batch.length > 0 ? commitInboxMessages(scope, target.id, batch) : [];
    return {
      accepted: true,
      owned: batch.length === 0
        || owned.length === batch.length
          && inboxMessagesOwned(scope, target.id, batch)
          && inboxMessagesPresent(scope, target.id, batch),
      error: undefined,
    };
  };
  const stopProfile = async (target) => {
    if (target.kind === 'room') {
      abortRoomMemberTurns(target.sessionId, { kind: 'user' });
      nextTurnEpoch(target.sessionId);
    }
    const agent = await resolveAgent(target);
    if (!agent?.cancel) fail('Bot conversation cannot be cancelled.');
    agent.cancel({ kind: 'user' }, { keepInbox: true });
  };
  const profiles = createProfileOperations(ctx, scope, { now, capabilities, stop: stopProfile, memoryLimits, objective });

  async function taskCommand(action, input) {
    checkRevision(input.revision);
    const catalog = scope.get();
    const task = findTask(catalog.tasks, input.taskId) ?? fail('Task not found.');
    const at = now();
    let tasks = catalog.tasks;
    let items = catalog.items;
    let target;
    const allowed = action === 'pause' ? ['queued'] : action === 'resume' ? ['paused'] : ['queued', 'paused', 'delivered'];
    if (!allowed.includes(task.status)) fail(`Cannot ${action} a ${task.status} task.`);
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : 'cancelled';
    const nextTask = { ...task, status, updatedAt: at, events: [...task.events, { type: status, actorId: 'user', detail: 'User task control', at }] };
    tasks = tasks.map((entry) => entry.id === task.id ? nextTask : entry);
    if (status === 'cancelled') items = items.map((item) => ({ ...item, inbox: item.inbox.filter((mail) => mail.kind !== 'task' || mail.taskId !== task.id) }));
    if (status === 'queued') target = bot(catalog, task.toId);
    await scope.set({ ...catalog, items, tasks, audit: audit(catalog, `task.${action}`, 'User task control', task.id, task.toId) }, catalog);
    let wakeAccepted = false;
    let wakeError = '';
    if (target) {
      try {
        const wakeResult = await wake(target, undefined, target.inbox.filter((mail) => (
          mail.kind === 'task' && mail.taskId === task.id
        )));
        wakeAccepted = wakeResult.accepted;
        if (wakeResult.error) wakeError = String(wakeResult.error.message ?? wakeResult.error);
      } catch (error) { wakeError = String(error.message ?? error); }
    }
    return { view: view(), taskId: task.id, wakeAccepted, wakeError };
  }

  async function retryTaskCommand(input) {
    const catalog = scope.get();
    const task = findTask(catalog.tasks, input.taskId) ?? fail('Task not found.');
    const requestId = retryRequestId(input);
    if (!isRetryableTaskStatus(task.status)) {
      fail(`Cannot retry a ${task.status} task. Only failed or cancelled tasks can be retried.`);
    }
    const requester = catalog.items.find((item) => item.id === task.fromId && item.kind !== 'room');
    if (!requester) fail(`Cannot retry task ${task.id}: requester bot is unavailable.`);
    const target = bot(catalog, task.toId);
    if (!canDelegateToAgent(catalog.items, task.fromId, task.toId)) {
      fail(`Cannot retry task ${task.id}: delegation permission is not granted.`);
    }

    const result = retryTask(catalog.tasks, task.id, { requestId }, now());
    if (!result.ok) fail(result.error);
    if (!result.created) {
      return {
        view: view(),
        taskId: result.task.id,
        originalTaskId: task.id,
        status: result.task.status,
        created: false,
        idempotent: true,
        wakeAccepted: result.task.status === TASK_STATUS.DELIVERED,
        wakeError: '',
      };
    }
    checkRevision(input.revision);

    const replacement = result.task;
    const at = now();
    const inbound = {
      kind: 'task',
      taskId: replacement.id,
      task: replacement.task,
      constraints: replacement.constraints,
      successCriteria: replacement.successCriteria,
      fromId: replacement.fromId,
      fromName: replacement.fromName || botDisplayName(requester, replacement.fromId),
      text: replacement.task,
      timestampMs: at,
    };
    const queuedTarget = {
      ...target,
      inbox: enqueueAgentInbound(target.inbox, inbound),
      updatedAt: at,
    };
    await scope.set({
      ...catalog,
      items: upsertItem(catalog.items, queuedTarget),
      tasks: result.tasks,
      audit: appendA2AAudit(catalog.audit, {
        type: 'task.retried',
        taskId: replacement.id,
        fromId: replacement.fromId,
        toId: replacement.toId,
        detail: `Retry of ${task.id} queued.`,
      }, at),
    }, catalog);

    let wakeAccepted = false;
    let wakeError = '';
    let wakeOwned = false;
    try {
      const wakeResult = await wake(queuedTarget, undefined, [inbound]);
      wakeAccepted = wakeResult.accepted;
      wakeOwned = wakeResult.owned;
      if (wakeResult.error) wakeError = String(wakeResult.error.message ?? wakeResult.error);
    } catch (error) {
      wakeError = String(error.message ?? error);
    }
    if (wakeAccepted && wakeOwned) {
      await projectCatalog(scope, (latest) => {
        if (!inboxMessagesPresent(scope, target.id, [inbound])
          || !inboxMessagesOwned(scope, target.id, [inbound])) return latest;
        const delivered = markTaskDelivered(latest.tasks, replacement.id, target.id, now());
        if (!delivered.ok || delivered.task.status !== TASK_STATUS.DELIVERED) return latest;
        return {
          ...latest,
          tasks: delivered.tasks,
          audit: appendTaskDeliveredAudit(latest.audit, {
            taskId: replacement.id,
            fromId: replacement.fromId,
            toId: replacement.toId,
            detail: 'Recipient wake accepted.',
          }, now()),
        };
      });
    }
    const latest = findTask(scope.get().tasks, replacement.id) ?? replacement;
    return {
      view: view(),
      taskId: latest.id,
      originalTaskId: task.id,
      status: latest.status,
      created: true,
      idempotent: false,
      wakeAccepted,
      wakeError,
    };
  }

  async function routineCommand(action, input) {
    checkRevision(input.revision);
    const catalog = scope.get();
    const routines = catalog.routines ?? [];
    const current = routines.find((row) => row.id === input.id);
    const at = now();
    if (action === 'run') {
      if (!current) fail('Routine not found.');
      if (routineOccupied(current, catalog)) fail('Previous scheduled run is still pending or running.');
      await runRoutine(current.id, true);
      return { view: view() };
    }
    let next;
    if (action === 'save') {
      if (input.id && !current) fail('Routine not found.');
      if (!current && routines.length >= MAX_ROUTINES) fail('Routine limit reached.');
      bot(catalog, input.botId);
      const hasSchedule = Object.hasOwn(input, 'schedule');
      const hasLegacyInterval = Object.hasOwn(input, 'intervalMinutes');
      const schedule = normalizeRoutineSchedule(hasSchedule ? input.schedule : (hasLegacyInterval ? '' : current?.schedule), {
        intervalMinutes: hasLegacyInterval ? input.intervalMinutes : current?.intervalMinutes,
        timezone: input.timezone || current?.timezone,
      });
      const maxRuns = Object.hasOwn(input, 'maxRuns')
        ? integer(Number(input.maxRuns), 0, 100000, 'run limit')
        : Number(current?.maxRuns) || 0;
      if (input.enabled === true && maxRuns > 0 && maxRuns <= Number(current?.runCount ?? 0)) {
        fail('Run limit must exceed the current run count before enabling.');
      }
      const contextFrom = normalizeContextFrom(input, current, routines, input.botId);
      const silentAllowed = Object.hasOwn(input, 'silentAllowed')
        ? input.silentAllowed !== false
        : current?.silentAllowed !== false;
      const watch = Object.hasOwn(input, 'watch')
        ? normalizeRoutineWatch(input.watch)
        : (current?.watch ?? null);
      const watchChanged = JSON.stringify(watch) !== JSON.stringify(current?.watch ?? null);
      next = { ...current, id: current?.id ?? crypto.randomUUID(), name: text(input.name, 120, 'name'),
        botId: input.botId, prompt: text(input.prompt, 8000, 'prompt'),
        schedule: schedule.schedule, timezone: schedule.timezone, maxRuns,
        intervalMinutes: schedule.intervalMinutes,
        enabled: input.enabled === true, nextRunAt: nextRoutineRun(schedule, at),
        createdAt: current?.createdAt ?? at, updatedAt: at, lastRunAt: current?.lastRunAt ?? 0,
        failureCount: 0, lastError: '', pendingRunId: current?.pendingRunId ?? '', runCount: current?.runCount ?? 0,
        contextFrom, silentAllowed,
        lastOutput: current?.lastOutput ?? '',
        watch,
        watchHash: watchChanged ? '' : (current?.watchHash ?? ''),
        lastWatchCheckAt: watchChanged ? '' : (current?.lastWatchCheckAt ?? ''),
        runHistory: current?.runHistory ?? [] };
    } else {
      if (!current) fail('Routine not found.');
      next = { ...current, updatedAt: at };
      if (action === 'toggle') {
        next.enabled = !current.enabled;
        next.failureCount = 0;
        next.lastError = '';
        next.nextRunAt = nextRoutineRun(scheduleFromRoutine(next), at);
      } else if (action !== 'delete') fail('Unknown routine operation.');
    }
    if (next?.enabled === false && next.lastOutcome === 'queued') {
      next = updateRoutineRun(next, next.pendingRunId, {
        status: ROUTINE_RUN_STATUS.INTERRUPTED,
        error: 'Routine was paused before execution.',
        endedAt: at,
      });
      next = { ...next, pendingRunId: '', lastOutcome: '', runSessionId: '', runTurn: 0 };
    }
    const updated = action === 'delete' ? routines.filter((row) => row.id !== current.id)
      : current ? routines.map((row) => row.id === current.id ? next : row) : [...routines, next];
    // Disabling/deleting cancels only undelivered durable mail, not an active model turn.
    const removedRoutineId = next?.id ?? current?.id;
    const items = action === 'delete' || next?.enabled === false || current?.lastOutcome === 'failed'
      ? catalog.items.map((item) => ({ ...item, inbox: item.inbox.filter((mail) => mail.routineId !== removedRoutineId) }))
      : catalog.items;
    await scope.set({ ...catalog, items, routines: updated, audit: audit(catalog, `routine.${action}`, next?.name ?? current.name) }, catalog);
    if (action === 'delete') {
      try {
        deleteRoutineNotepad(dshHomeDir(), current.id);
      } catch (error) {
        ctx.logger?.warn?.('dshbot routine notepad removal failed: %s', String(error.message ?? error));
      }
    }
    return { view: view() };
  }

  async function objectiveCommand(action, input) {
    const catalog = scope.get();
    const target = bot(catalog, text(input.id, 200, 'bot id'));
    if (action === 'start') {
      if (!String(target.objective ?? '').trim()) fail('Set a Bot objective before starting it.');
      // Explicit user intent: resolving a cold Session is allowed here.
      const agent = await resolveAgent(target);
      if (!agent) fail('Bot conversation is unavailable.');
      syncObjective(ctx, target, agent);
      return { view: view(), goal: resumeObjective(ctx, agent) };
    }
    if (action === 'pause') {
      const agent = ctx.agents?.get?.(target.sessionId);
      const goal = agent ? goalViewFor(ctx, agent) : null;
      if (agent && goal?.phase === 'active') {
        return { view: view(), goal: goalsService(ctx)?.pause?.(agent, goalRefOf(goal)) ?? goal };
      }
      return { view: view(), goal };
    }
    checkRevision(input.revision);
    const warnings = [];
    await scope.set({ ...catalog,
      items: catalog.items.map((item) => item.id === target.id
        ? { ...item, objective: '', updatedAt: now() } : item),
      audit: audit(catalog, 'bot.objective.cleared', `Cleared ${botDisplayName(target)} objective.`, '', target.id) }, catalog);
    const agent = ctx.agents?.get?.(target.sessionId);
    const goal = agent ? goalViewFor(ctx, agent) : null;
    if (agent && goal) {
      try {
        goalsService(ctx)?.clear?.(agent, goalRefOf(goal));
      } catch (error) {
        warnings.push(`Objective was cleared from the profile, but the live goal could not be cleared: ${String(error.message ?? error)}`);
      }
    }
    return { view: view(), warnings };
  }

  async function runRoutine(id, force = false) {
    const catalog = scope.get();
    const routine = (catalog.routines ?? []).find((row) => row.id === id);
    const at = now();
    if (!routine || !force && (!routine.enabled || routine.nextRunAt > at)) return;
    if (routineReachedLimit(routine)) {
      if (force) fail('Routine run limit reached.');
      return;
    }
    if (routineOccupied(routine, catalog)) return;
    const target = catalog.items.find((item) => item.id === routine.botId && item.kind !== 'room');
    let watchContent = '';
    let watchPatch = {};
    let watchError = '';
    if (!force && routine.watch) {
      const checkedAt = new Date(at).toISOString();
      let result;
      try {
        result = await runWatch(routine.watch, { cwd: watchCwd(target) });
      } catch (error) {
        watchError = String(error.message ?? error);
      }
      if (watchError) {
        // A failed check is not 'unchanged': record it and still queue the run.
        watchPatch = { lastWatchCheckAt: checkedAt };
      } else if (result.hash === String(routine.watchHash ?? '')) {
        await scope.set({ ...catalog,
          routines: catalog.routines.map((row) => row.id === id ? {
            ...row,
            nextRunAt: nextRoutineRun(scheduleFromRoutine(row), at),
            lastWatchCheckAt: checkedAt,
          } : row),
          audit: audit(catalog, 'routine.watch_unchanged', routine.name, '', routine.botId),
        }, catalog);
        return;
      } else {
        watchPatch = { watchHash: result.hash, lastWatchCheckAt: checkedAt };
        watchContent = String(result.content ?? '').slice(0, MAX_ROUTINE_OUTPUT);
      }
    }
    let agent;
    let failure = !target ? 'Routine bot is unavailable.' : '';
    if (target) {
      try { agent = await resolveAgent(target); } catch (error) { failure = String(error.message ?? error); }
      if (!agent && !failure) failure = 'Bot conversation is not active. Open it before running this routine.';
    }
    if (agent?.status === 'running') {
      if (force) fail('Bot is busy. Wait until the current turn finishes.');
      return;
    }
    const runId = crypto.randomUUID();
    const schedule = scheduleFromRoutine(routine);
    const trigger = force ? 'manual' : 'schedule';
    const nextRunCount = Number(routine.runCount ?? 0) + 1;
    const queuedRoutine = {
      ...appendRoutineRun(routine, createRoutineRun(routine, { runId, trigger, at })),
      pendingRunId: runId,
      lastOutcome: ROUTINE_RUN_STATUS.QUEUED,
      runSessionId: '',
      runTurn: 0,
      runCount: nextRunCount,
      lastRunAt: at,
      enabled: routine.enabled && schedule.kind !== 'once' && !routineReachedLimit(routine, nextRunCount),
      nextRunAt: force ? routine.nextRunAt : nextRoutineRun(schedule, at),
      failureCount: routine.failureCount,
      lastError: watchError,
      ...watchPatch,
      updatedAt: at,
    };
    if (failure) {
      await scope.set({ ...catalog, routines: catalog.routines.map((row) => row.id === id
        ? failedRoutine(queuedRoutine, runId, failure, { nextRunAt: queuedRoutine.nextRunAt }) : row),
      audit: audit(catalog, 'routine.failed', failure, '', routine.botId) }, catalog);
      return;
    }
    const contextFrom = Array.isArray(routine.contextFrom) ? routine.contextFrom : [];
    const previousOutput = contextFrom.includes('self')
      ? String(routine.lastOutput ?? '').slice(0, MAX_ROUTINE_OUTPUT) : '';
    const contextOutputs = contextFrom
      .filter((entry) => entry !== 'self')
      .map((entry) => (catalog.routines ?? []).find((row) => row.id === entry && row.botId === routine.botId))
      .filter((row) => row && String(row.lastOutput ?? '').trim())
      .slice(0, 3)
      .map((row) => ({ name: String(row.name ?? ''), output: String(row.lastOutput).slice(0, MAX_ROUTINE_OUTPUT) }));
    let notepad = '';
    try {
      notepad = sanitizeMemoryForPrompt(readRoutineNotepad(dshHomeDir(), routine.id).text).trim();
    } catch {
      // A missing DSH_HOME or unreadable notepad never blocks a queued run.
    }
    const mail = { kind: 'routine', routineId: id, runId, fromId: 'user', fromName: routine.name,
      text: routine.prompt, timestampMs: at,
      previousOutput, contextOutputs, notepad, watchContent,
      silentAllowed: routine.silentAllowed !== false };
    await scope.set({ ...catalog,
      items: catalog.items.map((item) => {
        const inbox = item.inbox.filter((entry) => entry.routineId !== id);
        return { ...item, inbox: item.id === target.id ? [...inbox, mail] : inbox };
      }),
      routines: catalog.routines.map((row) => row.id === id ? queuedRoutine : row),
      audit: audit(catalog, 'routine.queued', routine.name, '', routine.botId),
    }, catalog);
    try {
      const wakeResult = await wake(target,
        'Execute the pending scheduled user instruction in your current dshbot inbox and report its result here. It is not an A2A task: list_tasks does not contain scheduled instructions. If the instruction was withdrawn, do nothing.',
        [mail]);
      if (!wakeResult.accepted) throw wakeResult.error ?? new Error('Routine bot could not be woken.');
    } catch (error) {
      const latest = scope.get();
      const failure = `Routine wake failed: ${String(error.message ?? error)}`;
      await scope.set({ ...latest,
        routines: latest.routines.map((row) => row.id === id && row.pendingRunId === runId
          ? failedRoutine(row, runId, failure) : row),
        audit: audit(latest, 'routine.failed', failure, '', routine.botId),
      }, latest);
    }
  }

  async function settleRuns(agent, { interruptMissing = false } = {}) {
    if (!agent?.session?.snapshotEvents) return;
    const catalog = scope.get();
    const events = agent.session.snapshotEvents();
    let changed = false;
    const settledNotes = [];
    const routines = (catalog.routines ?? []).map((routine) => {
      if (routine.lastOutcome !== 'running' || routine.runSessionId !== agent.session.id) return routine;
      const end = events.findLast((event) => event.type === 'turn/end' && event.data.turn === routine.runTurn);
      const runId = routine.pendingRunId;
      if (!end) {
        if (!interruptMissing || agent.status === 'running') return routine;
        changed = true;
        const error = `Scheduled turn interrupted by Host restart: no matching turn/end for turn ${routine.runTurn}.`;
        settledNotes.push({ botId: routine.botId, status: ROUTINE_RUN_STATUS.INTERRUPTED, name: routine.name, error });
        return failedRoutine(routine, runId, error,
          { disable: true, status: ROUTINE_RUN_STATUS.INTERRUPTED, output: routineTurnOutput(events, routine.runTurn) });
      }
      changed = true;
      const success = end.data.reason?.kind === 'completed';
      const error = success ? '' : `Scheduled turn ended: ${end.data.reason?.kind ?? 'unknown'}. ${end.data.reason?.error?.message ?? ''}`.trim();
      settledNotes.push({ botId: routine.botId, status: success ? 'completed' : 'failed', name: routine.name, error });
      const output = routineTurnOutput(events, routine.runTurn);
      const silent = isSilentResponse(output);
      const settled = updateRoutineRun(routine, runId, {
        status: success ? ROUTINE_RUN_STATUS.COMPLETED : ROUTINE_RUN_STATUS.FAILED,
        sessionId: agent.session.id,
        turn: routine.runTurn,
        error,
        output,
        silent,
        endedAt: Number(end.time) || now(),
      });
      return { ...settled, pendingRunId: '', runSessionId: '', runTurn: 0,
        lastOutcome: success ? 'completed' : 'failed',
        lastOutput: output || (routine.lastOutput ?? ''),
        // A failed model turn may already have external side effects: stop, do not auto-retry.
        enabled: success ? routine.enabled : false,
        failureCount: success ? 0 : routine.failureCount + 1,
        lastError: error,
        updatedAt: now() };
    });
    if (changed) await scope.set({ ...catalog, routines }, catalog);
    for (const note of settledNotes) {
      pushWorkNote(note.botId,
        `[work] routine "${note.name}": ${note.status}${note.error ? ` ${note.error.slice(0, 200)}` : ''}`);
    }
  }

  return {
    command(endpoint, input = {}) {
      return serial(async () => {
        if (endpoint === 'describe') {
          const discovered = await capabilities(input.botId);
          return { view: view(), capabilities: discovered };
        }
        if (endpoint === 'group/runtime') {
          const roomId = String(input.roomId ?? '').trim();
          const catalog = scope.get();
          const room = catalog.items.find((item) => item.kind === 'room' && item.id === roomId)
            ?? fail('Group is unavailable.');
          return { roomId, sessionId: room.sessionId,
            members: groupMemberRuntimeSnapshot().filter((entry) => entry.roomSessionId === room.sessionId) };
        }
        if (endpoint === 'bot/trigger-token') {
          const existing = String(scope.get().triggerToken ?? '');
          if (existing) return { token: existing };
          const token = randomBytes(32).toString('hex');
          await projectCatalog(scope, (latest) => (
            latest.triggerToken ? latest : { ...latest, triggerToken: token }));
          return { token: String(scope.get().triggerToken ?? token) };
        }
        if (endpoint === 'bot/activity') return profiles.activity(input);
        if (endpoint === 'bot/mark-read') return profiles.markRead(input);
        if (endpoint === 'bot/open') return profiles.open(input);
        if (endpoint === 'bot/create') return profiles.create(input);
        if (endpoint === 'bot/update') return profiles.update(input);
        if (endpoint === 'bot/duplicate') return profiles.duplicate(input);
        if (endpoint === 'bot/delete-preview') return profiles.previewDelete(input);
        if (endpoint === 'bot/delete') return profiles.delete(input);
        if (endpoint === 'section/create') return profiles.sectionCreate(input);
        if (endpoint === 'section/rename') return profiles.sectionRename(input);
        if (endpoint === 'section/move') return profiles.sectionMove(input);
        if (endpoint === 'section/assign') return profiles.sectionAssign(input);
        if (endpoint === 'section/delete') return profiles.sectionDelete(input);
        if (endpoint === 'section/restore') return profiles.sectionRestore(input);
        if (endpoint === 'memory/get') return profiles.memoryGet(input);
        if (endpoint === 'memory/replace') return profiles.memoryReplace(input);
        if (/^bot\/objective\/(start|pause|clear)$/.test(endpoint)) {
          return objectiveCommand(endpoint.split('/')[2], input);
        }
        if (/^task\/(pause|resume|cancel)$/.test(endpoint)) return taskCommand(endpoint.split('/')[1], input);
        if (endpoint === 'task/retry') return retryTaskCommand(input);
        if (endpoint === 'routine/missed') {
          const at = now();
          return { ids: (scope.get().routines ?? [])
            .filter((row) => missedRoutine(row, at))
            .map((row) => row.id) };
        }
        if (/^routine\/(save|toggle|run|delete)$/.test(endpoint)) return routineCommand(endpoint.split('/')[1], input);
        if (endpoint === 'bot/stop') {
          checkRevision(input.revision);
          const catalog = scope.get();
          const target = catalog.items.find((item) => item.id === input.botId) ?? fail('Bot not found.');
          await stopProfile(target);
          return { view: view(), stopAccepted: true };
        }
        fail('Unknown Bot command.');
      });
    },
    tick() {
      return serial(async () => {
        if (ctx.settings.writable === false) return;
        const catalog = scope.get();
        const sessionIds = new Set((catalog.routines ?? []).filter((row) => row.lastOutcome === 'running').map((row) => row.runSessionId));
        for (const sessionId of sessionIds) {
          const target = catalog.items.find((item) => item.sessionId === sessionId);
          if (target) await settleRuns(await resolveAgent(target), { interruptMissing: true });
        }
        const ids = (scope.get().routines ?? []).filter((row) => row.enabled && row.nextRunAt <= now()).map((row) => row.id);
        for (const id of ids) await runRoutine(id);
      });
    },
    settle(agent) { return serial(() => settleRuns(agent)); },
    triggerRoutine(id) { return serial(() => runRoutine(id, true)); },
    async dispose() { disposed = true; await tail; },
  };
}

/** The existing authenticated Connection transport owns Host/Origin and browser auth. */
export function registerControlPlane(ctx, scope, options) {
  const control = createControlPlane(ctx, scope, options);
  ctx.on?.('agent/status', ({ agent, status }) => {
    if (status === 'idle') void control.settle(agent).catch((error) => ctx.logger?.warn?.('dshbot routine settlement failed: %s', error.message));
  });
  ctx.inject?.(['connection'], (host) => host.effect(() => host.connection.rpc.handle('/dshbot', async (endpoint, input) => {
    try { return { ok: true, value: await control.command(endpoint, input) }; }
    catch (error) { return { ok: false, error: { code: 'dshbot/rejected', message: String(error.message ?? error) } }; }
  })));
  ctx.inject?.(['webServer'], (host) => host.effect(() => host.webServer.register({
    kind: 'prefix',
    path: '/dshbot-hook',
    // Loopback-only by design: the desktop web server binds 127.0.0.1, so
    // this local trigger endpoint is never reachable from another machine.
    async handler(req, res) {
      const reply = (status) => { res.writeHead(status); res.end(); };
      const pathname = new URL(req.url ?? '/', 'http://x').pathname;
      const match = /^\/dshbot-hook\/routine\/([^/]+)$/.exec(pathname);
      if (!match || req.method !== 'POST') return reply(404);
      const provided = String(req.headers['x-dshbot-token'] ?? '');
      if (!provided) return reply(401);
      const expected = String(scope.get().triggerToken ?? '');
      const providedBuffer = Buffer.from(provided);
      const expectedBuffer = Buffer.from(expected);
      if (!expected || providedBuffer.length !== expectedBuffer.length
        || !timingSafeEqual(providedBuffer, expectedBuffer)) return reply(403);
      const routine = (scope.get().routines ?? []).find((row) => row.id === match[1]);
      if (!routine) return reply(404);
      try {
        await control.triggerRoutine(routine.id);
      } catch {
        return reply(409);
      }
      return reply(202);
    },
  })));
  ctx.effect(() => {
    const timer = setInterval(() => { void control.tick().catch((error) => ctx.logger?.warn?.('dshbot routine tick failed: %s', error.message)); }, 10000);
    timer.unref?.();
    return async () => { clearInterval(timer); await control.dispose(); };
  });
  return control;
}
