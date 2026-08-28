/**
 * Host apply for dshbot: settings catalog, 1:1 persona + memory injection,
 * room llm/stream dispatch (no chat model), ask_participant / send_room_message,
 * send_to_agent A2A.
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MAX_SPEAKS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_ROUNDS,
  isRoomConversationRequest,
  memberTurnAttempts,
  memberPersona,
  personaText,
  resolveGroupProtocolLimits,
  roomDispatchChunks,
  emptyStopChunks,
} from './catalog.js';
import { abortRoomMemberTurns, registerAskParticipant } from './ask-participant.js';
import { nextTurnEpoch } from './group-chat-host.js';
import { buildAgentDirectoryPrompt } from './agent-messaging.js';
import { ensureRoomPreset } from './room-preset.js';
import {
  ackPendingInboxDrain,
  registerInboxDrain,
  registerSendToAgent,
} from './send-to-agent.js';
import {
  composePersonaWithMemory,
  readBotMemory,
  writeBotMemory,
} from './memory.js';

export const name = 'dsh-bot';
export const inject = ['settings', 'systemPrompt', 'subagents', 'llm', 'sessions', 'tools'];

export const Config = z.object({
  maxSpeaks: z.number().step(1).min(1).max(GROUP_MAX_MEMBER_TURNS).default(DEFAULT_MAX_SPEAKS),
  maxRounds: z.number().step(1).min(1).max(GROUP_MAX_ROUNDS).default(DEFAULT_MAX_ROUNDS),
});

const NS = settingsNamespace('dshbot');

const ModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
});

const AvatarSchema = z.object({
  kind: z.string(),
  shape: z.string().default(''),
  color: z.string().default(''),
  dataUrl: z.string().default(''),
  crop: z.string().default(''),
});

const InboxSchema = z.object({
  fromId: z.string(),
  fromName: z.string(),
  text: z.string(),
  timestampMs: z.number(),
  priority: z.boolean().default(false),
});

const ItemSchema = z.object({
  id: z.string(),
  kind: z.string().default('bot'),
  sessionId: z.string(),
  name: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  avatar: AvatarSchema.default({ kind: 'blob' }),
  model: ModelSchema,
  workspaceId: z.string(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  pinOrder: z.number().default(0),
  memberBotIds: z.array(z.string()).default([]),
  inbox: z.array(InboxSchema).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CatalogSchema = z.object({
  items: z.array(ItemSchema).default([]),
});

function dshHomeDir() {
  return process.env.DSH_HOME || process.env.DSHD_HOME || '';
}

/**
 * Register the catalog namespace, room stream dispatch, persona, A2A, and memory.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ maxSpeaks?: number, maxRounds?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const { maxSpeaks, maxRounds } = resolveGroupProtocolLimits(config);
  // Standalone install path: provision the dshbot-room agent preset into
  // $DSH_HOME so sessions.create({ agentPreset: 'dshbot-room' }) mounts
  // without any desktop shell copying presets for us.
  try {
    ensureRoomPreset(dshHomeDir());
  } catch {
    // Room creation surfaces a missing preset; 1:1 bots are unaffected.
  }
  registerAskParticipant(ctx);
  const scope = ctx.settings.register(NS, CatalogSchema);
  const getScope = () => scope;
  registerSendToAgent(ctx, { getScope });
  registerInboxDrain(ctx, { getScope });

  ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Append a durable note to this bot\'s memory (explicit user request only).',
    timeoutMs: 10_000,
    parameters: {
      note: { type: 'string', required: true, description: 'Fact or preference to remember.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
        },
      },
      render: () => [{ type: 'text', text: 'Remembered.' }],
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id;
      const items = scope.get()?.items ?? [];
      const bot = items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
      if (!bot) throw new Error('remember is only available in a 1:1 bot session');
      const home = dshHomeDir();
      if (!home) throw new Error('DSH_HOME is not set');
      const prior = readBotMemory(home, bot.id);
      const note = String(args.note ?? '').trim();
      if (!note) return { ok: false };
      writeBotMemory(home, bot.id, prior ? `${prior.trim()}\n- ${note}\n` : `- ${note}\n`);
      return { ok: true };
    },
  }));

  ctx.on('llm/stream', (options, next) => {
    const items = scope.get()?.items ?? [];
    if (isRoomConversationRequest(options, items)) {
      const session = options.sessionId ? ctx.sessions.get(options.sessionId) : undefined;
      const events = session?.events ?? [];
      // New user turn: bump epoch and abort any in-flight member spawn.
      if (memberTurnAttempts(events).length === 0 && options.sessionId) {
        abortRoomMemberTurns(options.sessionId);
        nextTurnEpoch(options.sessionId);
      }
      const chunks = roomDispatchChunks({
        items,
        sessionId: options.sessionId,
        events,
        callId: globalThis.crypto.randomUUID(),
        maxSpeaks,
        maxRounds,
      }) ?? emptyStopChunks();
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    }
    // 1:1 — after a turn that peeked inbox via systemPrompt, ack-delete (not during assemble).
    const bot = items.find(
      (entry) => entry.sessionId === options.sessionId && entry.kind !== 'room',
    );
    const downstream = next();
    if (!bot || !downstream?.[Symbol.asyncIterator]) return downstream;
    return (async function* () {
      try {
        for await (const chunk of downstream) yield chunk;
      } finally {
        ackPendingInboxDrain(scope, bot.id);
      }
    })();
  });
  ctx.subagents.registerContinuableSetup((childCtx) => {
    const text = memberPersona.getStore();
    if (!text) return () => {};
    return childCtx.systemPrompt.section({
      name: 'dshbot:member',
      order: 1,
      complete: true,
      text,
    });
  });
  ctx.systemPrompt.section({
    name: 'dshbot:persona',
    order: 20,
    text: (assembleCtx) => {
      const sessionId = assembleCtx.agent?.session?.id ?? assembleCtx.agent?.id;
      const items = scope.get()?.items ?? [];
      const base = personaText(items, sessionId);
      const bot = items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
      if (!bot) return base;
      const home = dshHomeDir();
      const memory = home ? readBotMemory(home, bot.id) : '';
      return composePersonaWithMemory(base, memory);
    },
  });
  // Grok agent-directory prompt: a 1:1 bot sees its teammates and rooms so
  // send_to_agent is a discoverable capability, not a hidden one.
  ctx.systemPrompt.section({
    name: 'dshbot:teammates',
    order: 22,
    text: (assembleCtx) => {
      const sessionId = assembleCtx.agent?.session?.id ?? assembleCtx.agent?.id;
      const items = scope.get()?.items ?? [];
      const bot = items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
      if (!bot) return '';
      return buildAgentDirectoryPrompt(items, bot.id);
    },
  });
}
