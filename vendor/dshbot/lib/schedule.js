import { CronExpressionParser } from 'cron-parser';

const MAX_INTERVAL = 525_600;
const DURATION = Object.freeze({ m: 60_000, h: 3_600_000, d: 86_400_000 });

const fail = (message) => { throw new Error(message); };

function timezone(value) {
  const name = String(value ?? '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }).format(0); }
  catch { fail('Invalid routine timezone.'); }
  return name;
}

function durationMinutes(amount, unit) {
  return amount * DURATION[unit] / DURATION.m;
}

/** Parse the Hermes-compatible schedule vocabulary used by Bot routines. */
export function normalizeRoutineSchedule(value, { intervalMinutes, timezone: zone } = {}) {
  const scheduleText = String(value ?? '').trim();
  if (!scheduleText && intervalMinutes !== undefined
    && (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > MAX_INTERVAL)) {
    fail('Routine interval is out of range.');
  }
  const raw = scheduleText || (Number.isInteger(intervalMinutes) ? `every ${intervalMinutes}m` : '');
  if (!raw || raw.length > 200 || raw.includes('\0')) fail('Invalid routine schedule.');
  const tz = timezone(zone);
  const shorthand = /^(every\s+)?(\d+)([mhd])$/i.exec(raw);
  if (shorthand) {
    const amount = Number(shorthand[2]);
    const unit = shorthand[3].toLowerCase();
    const minutes = durationMinutes(amount, unit);
    if (!Number.isInteger(amount) || amount < 1 || minutes > MAX_INTERVAL) fail('Routine interval is out of range.');
    return {
      schedule: `${shorthand[1] ? 'every ' : ''}${amount}${unit}`,
      timezone: tz,
      kind: shorthand[1] ? 'interval' : 'once',
      intervalMinutes: minutes,
    };
  }
  if (raw.split(/\s+/).length !== 5) fail('Advanced schedules must use a five-field cron expression.');
  try {
    CronExpressionParser.parse(raw, { currentDate: new Date(), tz, strict: false }).next();
  } catch (error) {
    fail(`Invalid cron schedule: ${String(error.message ?? error)}`);
  }
  return { schedule: raw, timezone: tz, kind: 'cron', intervalMinutes: 0 };
}

/** Calculate the first fire strictly after the supplied timestamp. */
export function nextRoutineRun(schedule, at = Date.now()) {
  if (schedule.kind === 'once' || schedule.kind === 'interval') {
    return at + schedule.intervalMinutes * DURATION.m;
  }
  return CronExpressionParser.parse(schedule.schedule, {
    currentDate: new Date(at),
    tz: schedule.timezone,
    strict: false,
  }).next().getTime();
}

export function scheduleFromRoutine(routine) {
  return normalizeRoutineSchedule(routine?.schedule, {
    intervalMinutes: Number(routine?.intervalMinutes),
    timezone: routine?.timezone,
  });
}

export function routineReachedLimit(routine, nextRunCount = Number(routine?.runCount ?? 0)) {
  const maxRuns = Number(routine?.maxRuns ?? 0);
  return Number.isInteger(maxRuns) && maxRuns > 0 && nextRunCount >= maxRuns;
}
