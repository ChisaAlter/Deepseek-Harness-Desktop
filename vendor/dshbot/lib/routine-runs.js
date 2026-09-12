export const ROUTINE_RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
});

export const ROUTINE_RUN_TERMINAL_STATUSES = new Set([
  ROUTINE_RUN_STATUS.COMPLETED,
  ROUTINE_RUN_STATUS.FAILED,
  ROUTINE_RUN_STATUS.INTERRUPTED,
]);

export const MAX_ROUTINE_RUN_HISTORY = 50;

const ACTIVE_STATUSES = new Set([
  ROUTINE_RUN_STATUS.QUEUED,
  ROUTINE_RUN_STATUS.RUNNING,
]);

function timestamp(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function turn(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function status(value, fallback = ROUTINE_RUN_STATUS.QUEUED) {
  return Object.values(ROUTINE_RUN_STATUS).includes(value) ? value : fallback;
}

function normalizeRun(input, fallback = {}) {
  const runId = String(input?.runId ?? fallback.runId ?? '').trim();
  if (!runId) return undefined;
  return {
    runId,
    routineId: String(input?.routineId ?? fallback.routineId ?? ''),
    botId: String(input?.botId ?? fallback.botId ?? ''),
    trigger: input?.trigger === 'manual' || fallback.trigger === 'manual' ? 'manual' : 'schedule',
    status: status(input?.status, status(fallback.status)),
    sessionId: String(input?.sessionId ?? fallback.sessionId ?? ''),
    turn: turn(input?.turn ?? fallback.turn),
    error: String(input?.error ?? fallback.error ?? ''),
    createdAt: timestamp(input?.createdAt, timestamp(fallback.createdAt)),
    startedAt: timestamp(input?.startedAt, timestamp(fallback.startedAt)),
    endedAt: timestamp(input?.endedAt, timestamp(fallback.endedAt)),
  };
}

function trimHistory(history) {
  if (history.length <= MAX_ROUTINE_RUN_HISTORY) return history;
  const active = history.filter((run) => ACTIVE_STATUSES.has(run.status));
  const terminalLimit = Math.max(0, MAX_ROUTINE_RUN_HISTORY - active.length);
  const terminalRows = history.filter((run) => !ACTIVE_STATUSES.has(run.status));
  const terminal = terminalLimit === 0 ? [] : terminalRows.slice(-terminalLimit);
  const keep = new Set([...active, ...terminal].map((run) => run.runId));
  return history.filter((run) => keep.has(run.runId));
}

export function routineRunHistory(routine) {
  return Array.isArray(routine?.runHistory) ? routine.runHistory : [];
}

export function routineRunFor(routine, runId) {
  const id = String(runId ?? '').trim();
  if (!id) return undefined;
  return routineRunHistory(routine).find((run) => run.runId === id);
}

export function createRoutineRun(routine, { runId, trigger, at }) {
  return normalizeRun({
    runId,
    routineId: routine.id,
    botId: routine.botId,
    trigger,
    status: ROUTINE_RUN_STATUS.QUEUED,
    createdAt: at,
  });
}

export function appendRoutineRun(routine, run) {
  const record = normalizeRun(run, { routineId: routine.id, botId: routine.botId });
  if (!record) return routine;
  const history = routineRunHistory(routine).filter((entry) => entry.runId !== record.runId);
  return { ...routine, runHistory: trimHistory([...history, record]) };
}

export function updateRoutineRun(routine, runId, patch = {}) {
  const id = String(runId ?? '').trim();
  if (!id) return routine;
  let history = routineRunHistory(routine);
  let index = history.findIndex((run) => run.runId === id);
  if (index < 0 && routine.pendingRunId === id) {
    const legacy = normalizeRun({
      runId: id,
      routineId: routine.id,
      botId: routine.botId,
      trigger: 'schedule',
      status: routine.lastOutcome === ROUTINE_RUN_STATUS.RUNNING
        ? ROUTINE_RUN_STATUS.RUNNING
        : ROUTINE_RUN_STATUS.QUEUED,
      sessionId: routine.runSessionId,
      turn: routine.runTurn,
      error: routine.lastError,
      createdAt: routine.lastRunAt || routine.updatedAt,
      startedAt: routine.lastOutcome === ROUTINE_RUN_STATUS.RUNNING ? routine.lastRunAt : 0,
    });
    history = legacy ? [...history, legacy] : history;
    index = history.length - 1;
  }
  if (index < 0) return routine;
  const current = history[index];
  const next = normalizeRun({ ...current, ...patch }, {
    routineId: routine.id,
    botId: routine.botId,
  });
  if (!next) return routine;
  const updated = history.map((entry, entryIndex) => entryIndex === index ? next : entry);
  return { ...routine, runHistory: trimHistory(updated) };
}
