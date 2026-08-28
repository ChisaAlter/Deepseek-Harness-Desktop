/**
 * ask_participant: one catalog member speaks (Grok member turn via spawn).
 * Prompt/system from group-chat.js; deliveries only via send_room_message.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import {
  childPersonaText,
  GROUP_MAX_MESSAGES_PER_TURN,
  isPassContent,
  memberDisplayName,
  memberPersona,
  memberTurnOrPass,
  memberVisibleText,
  resolveAskTarget,
  roomTurnPromptForSpeaker,
} from './catalog.js';
import { currentTurnEpoch, isCurrentFactory } from './group-chat-host.js';

export const name = 'dshbot-ask-participant';
export const inject = ['tools'];

const NS = settingsNamespace('dshbot');
const SPAWN_PROVIDER = 'spawn';

/** @type {Map<string, AbortController>} */
const inFlightByRoom = new Map();

function blocksText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function contentText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
      continue;
    }
    if (block?.type === 'tool-result' && Array.isArray(block.content)) {
      const nested = contentText(block.content);
      if (nested) parts.push(nested);
    }
  }
  return parts.join('');
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {string[]}
 */
function extractSendRoomDeliveries(events) {
  const list = events ?? [];
  const pending = new Set();
  const deliveries = [];
  for (const event of list) {
    if (event?.type === 'tool/call' && event.data?.name === 'send_room_message') {
      if (event.data?.callId) pending.add(event.data.callId);
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = event.data?.message?.source?.callId;
    if (!callId || !pending.has(callId)) continue;
    pending.delete(callId);
    const raw = contentText(event.data.message?.content);
    let body = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.content === 'string') body = parsed.content;
    } catch {
      // Plain text tool results stay as-is.
    }
    const visible = memberVisibleText(body);
    if (visible) deliveries.push(visible);
    if (deliveries.length >= GROUP_MAX_MESSAGES_PER_TURN) break;
  }
  return deliveries;
}

/**
 * Abort in-flight member turns for a room (new user message / epoch bump).
 * @param {string} roomSessionId
 */
export function abortRoomMemberTurns(roomSessionId) {
  const prior = inFlightByRoom.get(roomSessionId);
  if (prior) {
    try {
      prior.abort();
    } catch {
      // Ignore abort errors.
    }
    inFlightByRoom.delete(roomSessionId);
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function registerSendRoomMessage(ctx) {
  ctx.tools.register(defineTool({
    name: 'send_room_message',
    description: 'Deliver visible text to the group room transcript.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'Message body shown in the group.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
        },
      },
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Room message',
      kind: 'other',
      content: [],
    }),
    presentResult: (_args, result) => {
      if (result.ok !== true) return undefined;
      const value = result.value;
      const text = typeof value === 'object' && value !== null && typeof value.content === 'string'
        ? value.content
        : '';
      return {
        card: 'generic',
        title: 'Room message',
        content: [{ type: 'text', text }],
      };
    },
    async execute(args) {
      return { content: String(args.content ?? '') };
    },
  }));
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerAskParticipant(ctx) {
  registerSendRoomMessage(ctx);
  ctx.tools.register(defineTool({
    name: 'ask_participant',
    description:
      'One room member speaks in the group. botId is that member\'s catalog id.',
    timeoutMs: 300000,
    parameters: {
      botId: {
        type: 'string',
        required: true,
        description: 'Catalog id of the room member who should speak.',
      },
      instruction: {
        type: 'string',
        required: true,
        description: 'Turn prompt for this member (Grok-style).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          botId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          text: { type: 'string', required: true },
          texts: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      // One text block per send_room_message delivery (Grok parity: two
      // deliveries in one member turn stay two visible room messages).
      render: (_args, value) => {
        const texts = Array.isArray(value.texts) && value.texts.length > 0
          ? value.texts
          : [value.text];
        return texts.map((text) => ({ type: 'text', text: String(text ?? '') }));
      },
    },
    presentCall: (args) => {
      const items = ctx.settings.get(NS)?.items ?? [];
      return {
        card: 'generic',
        title: memberDisplayName(items, args.botId),
        kind: 'other',
        content: [],
      };
    },
    presentResult: (_args, result) => {
      if (result.ok !== true) return undefined;
      const value = result.value;
      if (typeof value !== 'object' || value === null) return undefined;
      const name = typeof value.name === 'string' ? value.name : 'Bot';
      const text = typeof value.text === 'string' ? value.text : '';
      return {
        card: 'generic',
        title: name,
        content: [{ type: 'text', text }],
      };
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) {
        throw new Error('ask_participant requires a calling agent');
      }
      const roomSessionId = parent.session.id;
      const epoch = currentTurnEpoch(roomSessionId);
      const isCurrent = isCurrentFactory(roomSessionId, epoch);
      if (!isCurrent()) {
        return { botId: String(args.botId ?? ''), name: 'Bot', text: '', texts: [] };
      }

      const catalog = ctx.settings.get(NS);
      const items = catalog?.items ?? [];
      const target = resolveAskTarget(items, roomSessionId, args.botId);
      const bot = target.bot;
      const others = (target.room.memberBotIds ?? [])
        .filter((id) => id !== bot.id)
        .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
        .filter(Boolean);

      const instruction = String(args.instruction ?? '').trim()
        || roomTurnPromptForSpeaker(items, target.room, parent.session.events, bot.id);
      const prompt = [{ type: 'text', text: instruction }];
      const agentOptions = bot.model
        ? { provider: bot.model.provider, model: bot.model.model }
        : undefined;
      const persona = childPersonaText(bot, others, {
        group: { name: target.room.name, description: target.room.description },
      });

      const localAbort = new AbortController();
      // Do not abort peers in the same epoch; index.js aborts on epoch bump only.
      inFlightByRoom.set(roomSessionId, localAbort);
      const onParentAbort = () => localAbort.abort();
      exec.signal?.addEventListener?.('abort', onParentAbort, { once: true });

      try {
        return await memberTurnOrPass(bot, async () => {
          const run = await memberPersona.run(persona, () => ctx.subagents.start(SPAWN_PROVIDER, {
            label: bot.name,
            prompt,
            parent,
            signal: localAbort.signal,
            persona,
            toolFilter: { allow: ['send_room_message'] },
            ...(agentOptions ? { agentOptions } : {}),
          }));
          try {
            if (!isCurrent()) {
              return { botId: bot.id, name: bot.name, text: '', texts: [] };
            }
            const result = await run.result;
            if (!isCurrent()) {
              return { botId: bot.id, name: bot.name, text: '', texts: [] };
            }
            const childEvents = run.localAgent?.session?.events
              ?? ctx.sessions?.get?.(run.id)?.events;
            const deliveries = extractSendRoomDeliveries(childEvents);
            if (deliveries.length > 0) {
              return {
                botId: bot.id,
                name: bot.name,
                text: deliveries.join('\n\n'),
                texts: deliveries,
              };
            }
            const bare = blocksText(result.output);
            if (isPassContent(bare)) {
              return { botId: bot.id, name: bot.name, text: '', texts: [] };
            }
            return { botId: bot.id, name: bot.name, text: '', texts: [] };
          } finally {
            await run.dispose();
          }
        });
      } finally {
        if (inFlightByRoom.get(roomSessionId) === localAbort) {
          inFlightByRoom.delete(roomSessionId);
        }
        exec.signal?.removeEventListener?.('abort', onParentAbort);
      }
    },
  }));
}

/**
 * Room agent: keep only the plugin's global ask_participant.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.tools.restrict({ allow: ['ask_participant'] });
}
