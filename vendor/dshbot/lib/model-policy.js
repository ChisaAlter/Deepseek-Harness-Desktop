import { groupMemberProfileForSession } from './group-member-runtime.js';

/** Resolve the Bot profile without inheriting a stale session model or effort. */
export function botModelSelection(bot, defaultSelection) {
  const selected = bot.model?.provider && bot.model?.model
    ? bot.model
    : defaultSelection();
  if (!selected?.provider || !selected?.model) {
    throw new Error('No application default model is configured for this Bot.');
  }
  return {
    provider: selected.provider,
    model: selected.model,
    ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
  };
}

/** Keep prompt variables and the durable request header on one profile snapshot. */
export function registerBotModelPolicy(ctx, scope) {
  const assembled = new WeakMap();
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent;
    const items = scope.get().items;
    const sessionId = agent?.session?.id;
    const profile = groupMemberProfileForSession(sessionId);
    const bot = agent && (items.find((item) =>
      item.kind !== 'room' && item.sessionId === sessionId)
      ?? (profile ? items.find((item) => item.kind !== 'room' && item.id === profile.botId) : undefined));
    if (!bot) {
      if (agent) assembled.delete(agent);
      return next();
    }
    const selection = botModelSelection(bot, () => ctx.get('agentDefaultModel')?.currentSelection());
    const result = await next();
    assembled.set(agent, selection);
    return { ...result, variables: { ...result.variables,
      provider: selection.provider, model: selection.model } };
  }, { prepend: true });
  ctx.on('agent/request', async ({ agent }, next) => {
    const result = await next();
    const selection = assembled.get(agent);
    if (!selection) return result;
    const { reasoningEffort: _oldEffort, ...rest } = result;
    return { ...rest, ...selection };
  }, { prepend: true });
}
