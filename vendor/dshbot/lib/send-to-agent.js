/**
 * Host registration for send_to_agent (Grok-style A2A).
 * Priority only reorders the queue (no runner interrupt on desktop).
 * Inbox drain does NOT clear inside systemPrompt assemble. The consuming turn's
 * successful final stop acknowledges it through ./inbox-drain.js.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { botDisplayName } from './bot-identity.js';
import {
  AGENT_MESSAGE_MAX_TEXT,
  agentRelaySource,
  buildAgentInboundWakePrompt,
  enqueueAgentInbound,
  resolveSendToAgentTarget,
} from './agent-messaging.js';
import { wakeAgent, wakeFailureDetail } from './agent-resolution.js';
import { upsertItem } from './catalog.js';
import { appendA2AAudit } from './tasks.js';
import {
  markInboxMessageAdmitted,
  unmarkInboxMessageAdmitted,
} from './inbox-drain.js';

export { ackPendingInboxDrain, registerInboxDrain } from './inbox-drain.js';

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ getScope: () => { get: () => any, set: (next: any, previous: any) => Promise<void> } }} deps
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
      const text = String(args.text ?? '').trim();
      if (!text) return { ok: false, detail: 'Message was empty; nothing was sent.' };
      const textLength = Array.from(text).length;
      if (textLength > AGENT_MESSAGE_MAX_TEXT) {
        return {
          ok: false,
          detail: `Message too long (${textLength} chars > ${AGENT_MESSAGE_MAX_TEXT}). Nothing was sent.`,
        };
      }
      const resolved = resolveSendToAgentTarget(items, sender.id, String(args.botId ?? ''));
      if (!resolved.ok) {
        const detail = resolved.error;
        await scope.set({
          ...catalog,
          audit: appendA2AAudit(catalog.audit, {
            type: 'message.refused',
            fromId: sender.id,
            toId: String(args.botId ?? ''),
            detail,
          }),
        }, catalog);
        return { ok: false, detail };
      }
      const priority = args.priority === true;

      if (resolved.toGroup) {
        // Post into the room transcript (Grok postToGroup). No member
        // interrupt. There is deliberately NO room inbox fallback: the 1:1
        // inbox drain only assembles for bots, so a room queue would accept
        // the message and never deliver it — an idle room is an honest
        // failure the sender can retry, not a silent black hole.
        const fromName = botDisplayName(sender);
        const body = `[${fromName}]\n${text}`;
        const wake = await wakeAgent(ctx, resolved.to, body);
        if (!wake.ok) {
          const latest = scope.get();
          await scope.set({
            ...latest,
            audit: appendA2AAudit(latest.audit, {
              type: 'message.failed',
              fromId: sender.id,
              toId: resolved.to.id,
              detail: 'Group is idle; no room post was delivered.',
            }),
          }, latest);
          return {
            ok: false,
            detail: `Group ${botDisplayName(resolved.to, resolved.to.id)} could not be woken (${wakeFailureDetail(wake)}); the post was NOT delivered. Rooms have no offline inbox — try again while the room is active, or tell the user in your own chat instead.`,
          };
        }
        const note = priority
          ? ' Note: priority is 1:1 only — this post did not interrupt members.'
          : '';
        const latest = scope.get();
        await scope.set({
          ...latest,
          audit: appendA2AAudit(latest.audit, {
            type: 'message.delivered',
            fromId: sender.id,
            toId: resolved.to.id,
            detail: 'Posted to a live group room.',
          }),
        }, latest);
        return { ok: true, detail: `Posted to group ${botDisplayName(resolved.to, resolved.to.id)}.${note}` };
      }

      const inbound = {
        fromId: sender.id,
        fromName: botDisplayName(sender),
        text,
        timestampMs: Date.now(),
        ...(priority ? { priority: true } : {}),
      };
      const source = agentRelaySource(sender.sessionId);
      if (!source) throw new Error('Sender canonical session is unavailable.');
      const nextInbox = enqueueAgentInbound(resolved.to.inbox, inbound);
      const nextItems = upsertItem(items, { ...resolved.to, inbox: nextInbox, updatedAt: Date.now() });
      await scope.set({
        ...catalog,
        items: nextItems,
        audit: appendA2AAudit(catalog.audit, {
          type: 'message.queued',
          fromId: sender.id,
          toId: resolved.to.id,
          detail: priority ? 'Priority message queued.' : 'Message queued.',
        }),
      }, catalog);

      markInboxMessageAdmitted(scope, resolved.to.id, [inbound]);
      const wake = await wakeAgent(ctx, resolved.to, buildAgentInboundWakePrompt(inbound), source);
      if (!wake.ok) unmarkInboxMessageAdmitted(scope, resolved.to.id, [inbound]);
      if (wake.ok) {
        try {
          const latest = scope.get() ?? catalog;
          await scope.set({
            ...latest,
            audit: appendA2AAudit(latest.audit, {
              type: 'message.delivered',
              fromId: sender.id,
              toId: resolved.to.id,
              detail: 'Recipient wake accepted.',
            }),
          }, latest);
        } catch {
          // The durable queue write already succeeded and the wake was
          // accepted; an audit-only conflict must not misreport delivery.
        }
      }

      if (priority) {
        return {
          ok: true,
          detail: wake.ok
            ? `Sent to ${botDisplayName(resolved.to, resolved.to.id)} as a priority message — queued ahead of other agent mail. Runner interrupt is not available in this desktop build; the message is delivered asynchronously.`
            : `Queued priority message for ${botDisplayName(resolved.to, resolved.to.id)}; the recipient wake failed (${wakeFailureDetail(wake)}). It remains queued for a later explicit wake.`,
        };
      }
      return {
        ok: true,
        detail: wake.ok
          ? `Sent to ${botDisplayName(resolved.to, resolved.to.id)}. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.`
          : `Queued for ${botDisplayName(resolved.to, resolved.to.id)}; the recipient wake failed (${wakeFailureDetail(wake)}). It remains queued for a later explicit wake.`,
      };
    },
  }));
}

