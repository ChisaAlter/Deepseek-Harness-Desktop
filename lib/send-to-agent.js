/**
 * Host registration for send_to_agent (Grok-style A2A).
 * Priority only reorders the queue (no runner interrupt on desktop).
 * Inbox drain does NOT clear inside systemPrompt assemble — client/open path
 * acks. Drain semantics live in the dependency-free ./inbox-drain.js.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  buildAgentInboundWakePrompt,
  clampAgentMessage,
  enqueueAgentInbound,
  resolveSendToAgentTarget,
} from './agent-messaging.js';
import { upsertItem } from './catalog.js';
import { ackInboxMessages } from './inbox-drain.js';

export { ackPendingInboxDrain, registerInboxDrain } from './inbox-drain.js';

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ getScope: () => { get: () => any, set: (v: any) => void } }} deps
 */
export function registerSendToAgent(ctx, deps) {
  ctx.tools.register(defineTool({
    name: 'send_to_agent',
    description:
      'Send an asynchronous message to another bot or post into a group room you belong to. Do not wait for a reply.',
    timeoutMs: 30_000,
    parameters: {
      botId: {
        type: 'string',
        required: true,
        description: 'Catalog id of the recipient bot or group room.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'Message body.',
      },
      priority: {
        type: 'boolean',
        description: 'When true, queue ahead of non-priority (1:1 only; groups ignore interrupt).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Send to agent',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    presentResult: (_args, result) => {
      if (result.ok !== true) return undefined;
      return {
        card: 'generic',
        title: 'Sent',
        content: [{ type: 'text', text: String(result.value?.detail ?? '') }],
      };
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent?.session?.id) {
        throw new Error('send_to_agent requires a calling agent session');
      }
      const scope = deps.getScope();
      const catalog = scope.get() ?? { items: [] };
      const items = catalog.items ?? [];
      const sender = items.find((entry) => entry.sessionId === parent.session.id && entry.kind !== 'room');
      if (!sender) {
        throw new Error('send_to_agent is only available from a 1:1 bot session');
      }
      const text = clampAgentMessage(args.text);
      if (!text) return { ok: false, detail: 'Message was empty; nothing was sent.' };
      const resolved = resolveSendToAgentTarget(items, sender.id, String(args.botId ?? ''));
      if (!resolved.ok) return { ok: false, detail: resolved.error };
      const priority = args.priority === true;

      if (resolved.toGroup) {
        // Post into the room transcript (Grok postToGroup). No member
        // interrupt. There is deliberately NO room inbox fallback: the 1:1
        // inbox drain only assembles for bots, so a room queue would accept
        // the message and never deliver it — an idle room is an honest
        // failure the sender can retry, not a silent black hole.
        const fromName = String(sender.name ?? 'Bot');
        const body = `[${fromName}]\n${text}`;
        let posted = false;
        try {
          const live = ctx.sessions?.get?.(resolved.to.sessionId);
          const agent = live?.agent ?? live;
          if (agent && typeof agent.followup === 'function') {
            await agent.followup({
              content: [{ type: 'text', text: body }],
              source: { kind: 'user' },
            });
            posted = true;
          }
        } catch {
          posted = false;
        }
        if (!posted) {
          return {
            ok: false,
            detail: `Group ${resolved.to.name} is idle; the post was NOT delivered. Rooms have no offline inbox — try again while the room is active, or tell the user in your own chat instead.`,
          };
        }
        const note = priority
          ? ' Note: priority is 1:1 only — this post did not interrupt members.'
          : '';
        return { ok: true, detail: `Posted to group ${resolved.to.name}.${note}` };
      }

      const inbound = {
        fromId: sender.id,
        fromName: String(sender.name ?? 'Bot'),
        text,
        timestampMs: Date.now(),
        ...(priority ? { priority: true } : {}),
      };
      const nextInbox = enqueueAgentInbound(resolved.to.inbox, inbound);
      const nextItems = upsertItem(items, { ...resolved.to, inbox: nextInbox, updatedAt: Date.now() });
      scope.set({ ...catalog, items: nextItems });

      let woke = false;
      try {
        const live = ctx.sessions?.get?.(resolved.to.sessionId);
        const agent = live?.agent ?? live;
        if (agent && typeof agent.followup === 'function') {
          const content = [{ type: 'text', text: buildAgentInboundWakePrompt(inbound) }];
          await agent.followup({ content, source: { kind: 'user' } });
          woke = true;
          ackInboxMessages(scope, resolved.to.id, [inbound]);
        }
      } catch {
        woke = false;
      }

      if (priority) {
        return {
          ok: true,
          detail: woke
            ? `Sent to ${resolved.to.name} as a priority message — queued ahead of other agent mail. Runner interrupt is not available in this desktop build; the message is delivered asynchronously.`
            : `Queued priority message for ${resolved.to.name}. It will be delivered when that bot's chat runs next.`,
        };
      }
      return {
        ok: true,
        detail: woke
          ? `Sent to ${resolved.to.name}. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.`
          : `Queued for ${resolved.to.name}. Open that bot's chat to deliver if it was idle.`,
      };
    },
  }));
}

