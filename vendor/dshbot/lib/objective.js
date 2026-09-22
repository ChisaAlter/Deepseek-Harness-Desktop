/**
 * Catalog objective → host goal bridge. The catalog item is the source of
 * truth for what a bot should keep working on; the durable same-session goal
 * materializes lazily once the bot's agent is already live for other reasons,
 * and the host goal-round driver owns continuation after that.
 */

const trimObjective = (value) => String(value ?? '').trim();
const roundCap = (value) => (Number.isInteger(value) ? value : undefined);

/**
 * Optional goal service lookup. `ctx.get('goals')` reads the global service
 * store, so the goal stack needs no entry in this plugin's inject list; the
 * `ctx.goals` property fallback covers contexts that expose it directly.
 */
export function goalsService(ctx) {
  for (const read of [() => ctx.get?.('goals'), () => ctx.goals]) {
    try {
      const service = read();
      if (service) return service;
    } catch {
      // A missing service or an undeclared-injection proxy error falls through.
    }
  }
  return null;
}

export function goalRefOf(goal) {
  return { id: goal.id, revision: goal.revision };
}

/** Current goal view for a live agent, or null when none is readable. */
export function goalViewFor(ctx, agent) {
  const goals = goalsService(ctx);
  if (!goals || typeof goals.get !== 'function' || !agent) return null;
  try {
    return goals.get(agent) ?? null;
  } catch {
    return null;
  }
}

/**
 * Reconcile the live agent's goal with the catalog objective. Callers must
 * already know the agent is live; this never resolves a cold agent.
 * @returns the goal view produced or already current; undefined on failure.
 */
export function syncObjective(ctx, bot, agent, logger) {
  const goals = goalsService(ctx);
  if (!goals || !agent) return undefined;
  const objective = trimObjective(bot?.objective);
  const maxGoalRounds = roundCap(bot?.objectiveMaxRounds);
  try {
    const goal = goals.get(agent);
    if (objective && (!goal || goal.phase !== 'active')) {
      return goals.create(agent, {
        objective,
        ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
      });
    }
    if (goal) {
      const ref = goalRefOf(goal);
      if (!objective) return goals.clear(agent, ref);
      if (goal.phase === 'active' && (goal.objective !== objective
        || (maxGoalRounds !== undefined && goal.maxGoalRounds !== maxGoalRounds))) {
        return goals.edit(agent, ref, {
          objective,
          ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
        });
      }
    }
    return goal;
  } catch (error) {
    const warn = typeof logger === 'function'
      ? logger
      : (message, cause) => ctx.logger?.warn?.('%s %s', message, String(cause?.message ?? cause ?? ''));
    warn(`dshbot objective sync failed for bot ${String(bot?.id ?? '')}.`, error);
    return undefined;
  }
}

/**
 * Resume a stopped goal after an explicit user start: paused and blocked
 * goals resume, and an active-but-disarmed goal re-arms. Returns the current
 * view when no transition applies, null when no goal exists.
 */
export function resumeObjective(ctx, agent) {
  const goal = goalViewFor(ctx, agent);
  if (!goal) return null;
  const resumable = goal.phase === 'paused' || goal.phase === 'blocked'
    || (goal.phase === 'active' && goal.activation === 'disarmed');
  if (!resumable) return goal;
  return goalsService(ctx).resume(agent, goalRefOf(goal));
}

/**
 * Register lazy objective sync: `agent/created` marks the bot's goal dirty
 * and the first `agent/status` idle reconciles it; `requestSync` schedules
 * the same path after catalog writes without ever resolving a cold agent.
 * @param {import('@deepseek-ai/cordis').Context | object} ctx
 * @param {{ getScope: () => { get: () => object }, logger?: (...args) => void }} deps
 */
export function registerObjective(ctx, { getScope, logger } = {}) {
  const pendingSync = new Set();
  const rearmed = new Set();
  const log = (message, error) => {
    if (typeof logger === 'function') logger(message, error);
    else ctx.logger?.warn?.('dshbot objective: %s %s', message, String(error?.message ?? error ?? ''));
  };
  const botForSession = (sessionId) => {
    let items = [];
    try {
      items = getScope?.().get?.().items ?? [];
    } catch {
      items = [];
    }
    return items.find((item) => item.kind !== 'room' && item.sessionId === sessionId);
  };

  const handleIdle = (agent) => {
    const bot = botForSession(agent?.session?.id);
    if (!bot) return;
    if (pendingSync.delete(bot.id)) syncObjective(ctx, bot, agent, log);
    // A restarted process inherits disarmed goals from the previous runtime.
    // Re-arm exactly once per runtime so cold→live recovery continues the
    // objective; every later disarm (errors, max-tokens, user pause) stands.
    if (rearmed.has(bot.id) || !trimObjective(bot.objective)) return;
    const goal = goalViewFor(ctx, agent);
    if (!goal || goal.phase !== 'active' || goal.activation !== 'disarmed') return;
    try {
      goalsService(ctx)?.resume?.(agent, goalRefOf(goal));
    } catch (error) {
      log('goal re-arm failed', error);
    } finally {
      rearmed.add(bot.id);
    }
  };

  const requestSync = (bot) => {
    if (!bot?.id || bot.kind === 'room') return;
    pendingSync.add(bot.id);
    const agent = ctx.agents?.get?.(bot.sessionId);
    if (agent && agent.status === 'idle') handleIdle(agent);
  };

  ctx.on?.('agent/created', ({ agent } = {}) => {
    const bot = botForSession(agent?.session?.id);
    if (bot) pendingSync.add(bot.id);
  });
  ctx.on?.('agent/status', ({ agent, status } = {}) => {
    if (status !== 'idle') return;
    try {
      handleIdle(agent);
    } catch (error) {
      log('objective idle handling failed', error);
    }
  });

  return { requestSync };
}
