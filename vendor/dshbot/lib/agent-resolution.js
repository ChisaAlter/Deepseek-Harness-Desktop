/**
 * Resolve and wake catalog recipients without creating replacement sessions.
 *
 * Live agents are preferred. Cold recovery is delegated to the Host Session
 * Controller, which owns the persisted session identity and composition.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const DEFAULT_WAKE_SOURCE = Object.freeze({
  kind: 'plugin',
  plugin: 'dshbot',
  form: 'relay',
});

function sessionIdFor(target) {
  return String(typeof target === 'string' ? target : target?.sessionId ?? '').trim();
}

function controllerFor(ctx) {
  try {
    return ctx.get?.('sessionController') ?? ctx.sessionController;
  } catch {
    return ctx.sessionController;
  }
}

function errorFromResult(result, sessionId) {
  if (result?.error) return result.error;
  return new Error(`Session ${sessionId} could not be resolved.`);
}

/**
 * @param {import('@deepseek-ai/cordis').Context | object} ctx
 * @param {string | { sessionId?: string }} target
 * @returns {Promise<{ ok: true, agent: object, source: 'live' | 'cold' } | { ok: false, error: Error }>}
 */
export async function resolveAgent(ctx, target) {
  const sessionId = sessionIdFor(target);
  if (!sessionId) return { ok: false, error: new Error('Recipient session is unavailable.') };

  const live = ctx.agents?.get?.(sessionId);
  if (live) return { ok: true, agent: live, source: 'live' };

  const controller = controllerFor(ctx);
  if (typeof controller?.resolveAgent !== 'function') {
    return {
      ok: false,
      error: new Error(`Recipient session ${sessionId} is offline and no Session Controller is available.`),
    };
  }

  try {
    const result = await controller.resolveAgent(sessionId);
    const agent = result?.agent ?? (typeof result?.followup === 'function' ? result : undefined);
    if (agent) return { ok: true, agent, source: 'cold' };
    return { ok: false, error: errorFromResult(result, sessionId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Wake a recipient after its durable catalog write has completed.
 * @param {import('@deepseek-ai/cordis').Context | object} ctx
 * @param {string | { sessionId?: string }} target
 * @param {string} instruction
 * @param {{ kind: string, form?: string, senderSessionId?: string }} [source]
 * @returns {Promise<{ ok: true, agent: object, source: 'live' | 'cold' } | { ok: false, error: Error }>}
 */
export async function wakeAgent(ctx, target, instruction, source = DEFAULT_WAKE_SOURCE) {
  const resolved = await resolveAgent(ctx, target);
  if (!resolved.ok) return resolved;
  if (typeof resolved.agent.followup !== 'function') {
    return { ok: false, error: new Error('Resolved recipient cannot accept a wake.') };
  }
  try {
    await resolved.agent.followup(createUserMessage({
      content: [{ type: 'text', text: String(instruction ?? '') }],
      source: source ?? DEFAULT_WAKE_SOURCE,
    }));
    return resolved;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function wakeFailureDetail(result) {
  if (result?.ok === true) return '';
  return String(result?.error?.message ?? result?.error ?? 'Recipient wake failed.');
}
