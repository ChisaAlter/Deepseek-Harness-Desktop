/**
 * Host apply for dshbot: settings catalog, 1:1 persona + memory injection,
 * room llm/stream dispatch (no chat model), ask_participant / send_room_message,
 * send_to_agent A2A.
 */
import z from '@deepseek-ai/schemastery';
import { createCatalogScope, projectCatalog } from './catalog-scope.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MAX_SPEAKS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_ROUNDS,
  isRoomConversationRequest,
  memberTurnAttempts,
  personaText,
  resolveGroupProtocolLimits,
  roomDispatchChunks,
  emptyStopChunks,
} from './catalog.js';
import {
  groupMemberPersonaForTurn,
  isRoomMemberTurnComplete,
  registerAskParticipant,
} from './ask-participant.js';
import { nextTurnEpoch } from './group-chat-host.js';
import { buildAgentDirectoryPrompt } from './agent-messaging.js';
import { botDisplayName } from './bot-identity.js';
import { ensureRoomPreset } from './room-preset.js';
import {
  registerInboxDrain,
  registerSendToAgent,
} from './send-to-agent.js';
import { registerTaskTools } from './task-tools.js';
import { registerControlPlane } from './control-plane.js';
import { registerObjective } from './objective.js';
import { registerMemoryReview } from './memory-review.js';
import { registerCapabilities } from './capabilities.js';
import { registerBotModelPolicy } from './model-policy.js';
import {
  disposeGroupMemberRuntime,
  isGroupMemberSession,
  reconcileGroupMemberRuntime,
} from './group-member-runtime.js';
import { registerGroupLateResultRecovery } from './group-late-results.js';
import { reconcileGroupRoomHolds } from './group-room-state.js';
import { bootstrapSessionHygiene } from './session-hygiene.js';
import {
  applyMemoryOps,
  DEFAULT_BOT_MEMORY_LIMIT,
  DEFAULT_USER_MEMORY_LIMIT,
  MAX_BOT_MEMORY_CHARS,
  readMemorySnapshot,
} from './memory.js';
import {
  applyNotepadOps,
  readRoutineNotepad,
  ROUTINE_NOTEPAD_MAX_CHARS,
} from './routine-notepad.js';

export const name = 'dsh-bot';
export const inject = ['settings', 'systemPrompt', 'subagents', 'llm', 'sessions', 'agents', 'tools', 'agentDefaultModel'];

export const Config = z.object({
  maxSpeaks: z.number().step(1).min(1).max(GROUP_MAX_MEMBER_TURNS).default(DEFAULT_MAX_SPEAKS),
  maxRounds: z.number().step(1).min(1).max(GROUP_MAX_ROUNDS).default(DEFAULT_MAX_ROUNDS),
  memoryMaxChars: z.number().step(1).min(1).max(MAX_BOT_MEMORY_CHARS).default(DEFAULT_BOT_MEMORY_LIMIT),
  memoryUserMaxChars: z.number().step(1).min(1).max(MAX_BOT_MEMORY_CHARS).default(DEFAULT_USER_MEMORY_LIMIT),
  memoryReviewEvery: z.number().step(1).min(1).max(100).default(10),
});

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
  routineId: z.string().default(''),
  runId: z.string().default(''),
  kind: z.string().default('message'),
  fromId: z.string(),
  fromName: z.string(),
  text: z.string(),
  taskId: z.string().default(''),
  task: z.string().default(''),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.string().default(''),
  timestampMs: z.number(),
  priority: z.boolean().default(false),
  // Routine mail extras resolved when the run is queued; the wake prompt
  // renders them so a restored inbox reproduces the same prompt.
  previousOutput: z.string().default(''),
  contextOutputs: z.array(z.object({
    name: z.string().default(''),
    output: z.string().default(''),
  })).default([]),
  notepad: z.string().default(''),
  watchContent: z.string().default(''),
  silentAllowed: z.boolean().default(false),
});

const TaskEventSchema = z.object({
  type: z.string(),
  actorId: z.string(),
  detail: z.string().default(''),
  at: z.number(),
});

const RoutineRunSchema = z.object({
  runId: z.string(),
  routineId: z.string(),
  botId: z.string(),
  trigger: z.union(['manual', 'schedule']).default('schedule'),
  status: z.union(['queued', 'running', 'completed', 'failed', 'interrupted']).default('queued'),
  sessionId: z.string().default(''),
  turn: z.number().step(1).min(0).default(0),
  error: z.string().default(''),
  output: z.string().default(''),
  silent: z.boolean().default(false),
  createdAt: z.number().default(0),
  startedAt: z.number().default(0),
  endedAt: z.number().default(0),
});

const TaskSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  fromName: z.string(),
  toId: z.string(),
  toName: z.string(),
  task: z.string(),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.string().default(''),
  idempotencyKey: z.string().default(''),
  originalIdempotencyKey: z.string().default(''),
  parentTaskId: z.string().default(''),
  retryOf: z.string().default(''),
  lineageRootTaskId: z.string().default(''),
  retryRequestId: z.string().default(''),
  workspaceId: z.string().default(''),
  profile: z.string().default(''),
  status: z.string().default('queued'),
  attempts: z.number().default(0),
  resultSummary: z.string().default(''),
  error: z.string().default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
  events: z.array(TaskEventSchema).default([]),
});

const A2AAuditSchema = z.object({
  id: z.string(),
  type: z.string(),
  taskId: z.string().default(''),
  fromId: z.string(),
  toId: z.string().default(''),
  detail: z.string().default(''),
  at: z.number(),
});

const GroupHoldStampSchema = z.object({
  at: z.number().default(0),
  byMessageId: z.string(),
  thread: z.string(),
  noted: z.boolean(),
});

const GroupHoldsSchema = z.dict(GroupHoldStampSchema);

const GroupHoldCheckpointSchema = z.object({
  version: z.number().step(1).min(1).default(1),
  holds: GroupHoldsSchema.default({}),
  processedEventIds: z.array(z.string()).default([]),
  processedThroughSeq: z.number().step(1).min(-1).default(-1),
});

const ItemSchema = z.object({
  capabilities: z.object({
    tools: z.object({ mode: z.union(['all', 'selected']).default('all'), names: z.array(z.string()).default([]) }).default({}),
    skills: z.object({ mode: z.union(['all', 'selected']).default('all'), names: z.array(z.string()).default([]) }).default({}),
    mcp: z.object({ mode: z.union(['all', 'selected']).default('all'), names: z.array(z.string()).default([]) }).default({}),
  }).default({}),
  maxRounds: z.number().step(1).min(1).max(GROUP_MAX_ROUNDS),
  maxSpeaks: z.number().step(1).min(1).max(GROUP_MAX_MEMBER_TURNS),
  id: z.string(),
  kind: z.string().default('bot'),
  sessionId: z.string(),
  name: z.string(),
  title: z.string().max(120).default(''),
  sectionId: z.string().default(''),
  description: z.string().default(''),
  avatar: AvatarSchema.default({ kind: 'blob' }),
  model: ModelSchema,
  workspaceId: z.string(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  pinOrder: z.number().default(0),
  allowedSenderIds: z.array(z.string()).default([]),
  memberBotIds: z.array(z.string()).default([]),
  objective: z.string().max(2000).default(''),
  objectiveMaxRounds: z.number().step(1).min(1).max(200).default(16),
  memoryReview: z.boolean().default(true),
  notify: z.boolean().default(true),
  holds: GroupHoldsSchema.default({}),
  holdCheckpoint: GroupHoldCheckpointSchema,
  inbox: z.array(InboxSchema).default([]),
  readInitialized: z.boolean().default(false),
  lastSeenSeq: z.number().step(1).min(0).default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// INVARIANT: `watch` is only writable through the routine/save RPC by the
// user — never expose it to a model tool (watch.command runs a local shell).
const RoutineWatchSchema = z.object({
  kind: z.union(['url', 'command']),
  value: z.string().max(2000),
  timeoutMs: z.number().default(15000),
});

const SectionSchema = z.object({
  id: z.string(),
  name: z.string().max(120).pattern(/\S/),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CatalogSchema = z.object({
  routines: z.array(z.object({
    id: z.string(), name: z.string(), botId: z.string(), prompt: z.string(),
    schedule: z.string().default(''), timezone: z.string().default(''), maxRuns: z.number().step(1).min(0).max(100000).default(0),
    intervalMinutes: z.number().step(1).min(0).max(525600).default(0), enabled: z.boolean().default(false),
    nextRunAt: z.number(), createdAt: z.number(), updatedAt: z.number(),
    lastRunAt: z.number().default(0), failureCount: z.number().default(0),
    lastError: z.string().default(''), pendingRunId: z.string().default(''), runCount: z.number().default(0),
    lastOutcome: z.string().default(''), runSessionId: z.string().default(''), runTurn: z.number().default(0),
    contextFrom: z.array(z.string()).max(3).default([]),
    silentAllowed: z.boolean().default(true),
    lastOutput: z.string().default(''),
    watch: z.union([RoutineWatchSchema, z.const(null)]).default(null),
    watchHash: z.string().default(''),
    lastWatchCheckAt: z.string().default(''),
    runHistory: z.array(RoutineRunSchema).default([]),
  })).default([]),
  sections: z.array(SectionSchema).default([]),
  items: z.array(ItemSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
  audit: z.array(A2AAuditSchema).default([]),
  avatarShapeMigration: z.number().default(0),
  triggerToken: z.string().default(''),
});

function dshHomeDir() {
  return process.env.DSH_HOME || process.env.DSHD_HOME || '';
}

// Catalogs written before the circle default stored a random blob shape per
// bot. Normalize them once; deliberate picks after the migration are kept.
function migrateBlobAvatarShapes(previous) {
  if (!previous || previous.avatarShapeMigration >= 1) return previous;
  const items = (previous.items ?? []).map((item) => {
    const avatar = item?.avatar;
    if (avatar?.kind !== 'blob' || avatar.shape === 'circle') return item;
    return { ...item, avatar: { ...avatar, shape: 'circle' } };
  });
  return { ...previous, avatarShapeMigration: 1, items };
}

/**
 * Register the catalog namespace, room stream dispatch, persona, A2A, and memory.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ maxSpeaks?: number, maxRounds?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const { maxSpeaks, maxRounds } = resolveGroupProtocolLimits(config);
  const memoryLimits = {
    bot: Number(config.memoryMaxChars) > 0 ? Math.floor(Number(config.memoryMaxChars)) : DEFAULT_BOT_MEMORY_LIMIT,
    user: Number(config.memoryUserMaxChars) > 0 ? Math.floor(Number(config.memoryUserMaxChars)) : DEFAULT_USER_MEMORY_LIMIT,
  };
  const memorySnapshots = new WeakMap();
  // Standalone install path: provision the dshbot-room agent preset into
  // $DSH_HOME so sessions.create({ agentPreset: 'dshbot-room' }) mounts
  // without any desktop shell copying presets for us.
  try {
    ensureRoomPreset(dshHomeDir());
  } catch {
    // Room creation surfaces a missing preset; 1:1 bots are unaffected.
  }
  registerAskParticipant(ctx);
  const scope = createCatalogScope(ctx.settings, CatalogSchema);
  void projectCatalog(scope, migrateBlobAvatarShapes).catch(() => {});
  registerBotModelPolicy(ctx, scope);
  ctx.inject?.(['sessionController'], async (host) => {
    if (typeof host.sessionController.setPresentation !== 'function') {
      throw new Error('dshbot requires Harness Session presentation support. Rebuild or update the desktop runtime.');
    }
    const hygiene = bootstrapSessionHygiene(host, scope, {
      controller: host.sessionController,
      autoStart: false,
      logger: (message, error) => host.logger?.warn?.('%s %s', message, error?.message ?? error ?? ''),
    });
    const lateResults = registerGroupLateResultRecovery({
      ownerCtx: host,
      items: () => scope.get().items,
      logger: (message, error) => host.logger?.warn?.('%s %s', message, error?.message ?? error ?? ''),
    });
    host.effect(() => async () => {
      await lateResults.dispose();
      hygiene.dispose();
      await disposeGroupMemberRuntime();
    });
    await hygiene.run();
    for (const room of scope.get().items.filter((item) => item.kind === 'room')) {
      try {
        const inspection = await host.sessionController.inspect(room.sessionId);
        await reconcileGroupRoomHolds(scope, { roomId: room.id, events: inspection.events });
      } catch (error) {
        host.logger?.warn?.(
          '%s %s',
          `dshbot could not reconcile hold state for room ${room.id}; dispatch stays fail-closed until the Session is available.`,
          error?.message ?? error ?? '',
        );
      }
    }
    await reconcileGroupMemberRuntime({
      ownerCtx: host,
      items: scope.get().items,
      personaForBot: (bot, room) => {
        const items = scope.get().items;
        const members = new Set(room.memberBotIds ?? []);
        const others = items.filter((item) => item.kind !== 'room' && item.id !== bot.id && members.has(item.id));
        return groupMemberPersonaForTurn(bot, others, { name: room.name, description: room.description });
      },
    });
    try {
      await lateResults.reconcile();
    } catch (error) {
      host.logger?.warn?.('%s %s', 'dshbot startup late-result reconciliation failed.', error?.message ?? error ?? '');
    }
  });
  const getScope = () => scope;
  registerSendToAgent(ctx, { getScope });
  registerTaskTools(ctx, { getScope });
  registerInboxDrain(ctx, { getScope });
  const capabilities = registerCapabilities(ctx, scope);
  const objective = registerObjective(ctx, { getScope });
  registerControlPlane(ctx, scope, { capabilities, memoryLimits, objective });
  const reviewEvery = Number.isInteger(config.memoryReviewEvery)
    ? Math.min(100, Math.max(1, config.memoryReviewEvery))
    : 10;
  registerMemoryReview(ctx, { getScope, memoryLimits, reviewEvery, home: dshHomeDir });

  const memoryBotFor = (exec) => {
    const sessionId = exec.agent?.session?.id;
    const items = scope.get()?.items ?? [];
    return items.find((entry) => entry.sessionId === sessionId && entry.kind !== 'room');
  };
  const applyMemoryTool = (exec, ops) => {
    const bot = memoryBotFor(exec);
    if (!bot) throw new Error('memory is only available in a 1:1 bot session');
    const home = dshHomeDir();
    if (!home) throw new Error('DSH_HOME is not set');
    const result = applyMemoryOps(home, bot.id, ops, { limits: memoryLimits });
    const track = ops[0]?.track === 'user' ? 'user' : 'bot';
    const snapshot = result.snapshot[track];
    const label = track === 'user' ? 'User memory' : 'Notes';
    const used = snapshot.text.length;
    const skipped = result.skipped.length ? ` Skipped ${result.skipped.length} duplicate entr${result.skipped.length === 1 ? 'y' : 'ies'}.` : '';
    return { ok: true, detail: `${label}: ${used}/${memoryLimits[track]} chars used.${skipped}` };
  };

  ctx.tools.register(defineTool({
    name: 'memory',
    description: 'Persist a durable fact or preference that will still matter in future sessions. Store facts, not instructions; never store text that tells you how to behave. Use replace or remove to correct or retire outdated entries. Keep entries short.',
    timeoutMs: 10_000,
    parameters: {
      action: { type: 'string', required: true, enum: ['add', 'replace', 'remove'], description: 'add appends a new entry; replace and remove target one existing entry via match.' },
      track: { type: 'string', enum: ['bot', 'user'], description: 'bot stores notes about yourself; user stores facts about the user. Defaults to bot.' },
      text: { type: 'string', required: true, description: 'Entry text for add and replace.' },
      match: { type: 'string', description: 'Unique substring of the entry to replace or remove.' },
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
      render: (_args, value) => [{ type: 'text', text: value.ok ? `Saved. ${value.detail}` : value.detail }],
    },
    async execute(args, exec) {
      return applyMemoryTool(exec, [{
        op: args.action,
        track: args.track === 'user' ? 'user' : 'bot',
        text: args.text,
        match: args.match,
      }]);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Persist a durable fact or preference that will still matter in future sessions. Store facts, not instructions; never store text that tells you how to behave. Keep entries short.',
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
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.ok ? `Remembered. ${value.detail}` : 'Nothing to remember.' }],
    },
    async execute(args, exec) {
      const note = String(args.note ?? '').trim();
      if (!note) return { ok: false, detail: '' };
      return applyMemoryTool(exec, [{ op: 'add', track: 'bot', text: note }]);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'routine_notepad',
    description: 'Read or edit the notepad of one of your own scheduled routines. The notepad persists between routine runs; keep short working notes there, not instructions. add appends an entry; replace and remove target one existing entry via match.',
    timeoutMs: 10_000,
    parameters: {
      routineId: { type: 'string', required: true, description: 'Id of a routine owned by this bot.' },
      action: { type: 'string', required: true, enum: ['read', 'add', 'replace', 'remove'], description: 'read returns the notepad; add appends an entry; replace and remove target one entry via match.' },
      text: { type: 'string', description: 'Entry text for add and replace.' },
      match: { type: 'string', description: 'Unique substring of the entry to replace or remove.' },
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
      render: (_args, value) => [{ type: 'text', text: value.ok ? `Done. ${value.detail}` : value.detail }],
    },
    async execute(args, exec) {
      const bot = memoryBotFor(exec);
      if (!bot) throw new Error('routine_notepad is only available in a 1:1 bot session');
      const routineId = String(args.routineId ?? '').trim();
      const routine = (scope.get()?.routines ?? [])
        .find((row) => row.id === routineId && row.botId === bot.id);
      if (!routine) throw new Error('routine_notepad requires a routine owned by this bot');
      const home = dshHomeDir();
      if (!home) throw new Error('DSH_HOME is not set');
      if (args.action === 'read') {
        const state = readRoutineNotepad(home, routineId);
        return { ok: true, detail: state.text.trim() || 'Notepad is empty.' };
      }
      const result = applyNotepadOps(home, routineId, [{
        op: args.action,
        text: args.text,
        match: args.match,
      }]);
      const used = result.snapshot.text.length;
      const skipped = result.skipped.length ? ` Skipped ${result.skipped.length} entr${result.skipped.length === 1 ? 'y' : 'ies'}.` : '';
      return { ok: true, detail: `Notepad: ${used}/${ROUTINE_NOTEPAD_MAX_CHARS} chars used.${skipped}` };
    },
  }));

  ctx.on('llm/stream', (options, next) => {
    const items = scope.get()?.items ?? [];
    const memberSession = !options.purpose && options.sessionId ? ctx.sessions.get(options.sessionId) : undefined;
    const ownedMember = memberSession !== undefined && isGroupMemberSession(options.sessionId);
    if (ownedMember && isRoomMemberTurnComplete(memberSession.snapshotEvents())) {
      return (async function* () { yield* emptyStopChunks(); })();
    }
    if (isRoomConversationRequest(options, items)) {
      const session = options.sessionId ? ctx.sessions.get(options.sessionId) : undefined;
      const events = session?.snapshotEvents() ?? [];
      // A new room thread gets a new epoch. Older threads retain their own
      // recoverable work; explicit stop/cancel paths perform abortion.
      if (memberTurnAttempts(events).length === 0 && options.sessionId) {
        nextTurnEpoch(options.sessionId);
      }
      return (async function* () {
        const room = items.find((item) => item.kind === 'room' && item.sessionId === options.sessionId);
        if (!room) {
          yield* emptyStopChunks();
          return;
        }
        await reconcileGroupRoomHolds(scope, { roomId: room.id, events });
        const currentItems = scope.get()?.items ?? [];
        const currentRoom = currentItems.find((item) => item.kind === 'room' && item.id === room.id);
        const chunks = roomDispatchChunks({
          items: currentItems,
          sessionId: options.sessionId,
          events,
          callId: globalThis.crypto.randomUUID(),
          maxSpeaks: currentRoom?.maxSpeaks ?? maxSpeaks,
          maxRounds: currentRoom?.maxRounds ?? maxRounds,
        }) ?? emptyStopChunks();
        for (const chunk of chunks) yield chunk;
      })();
    }
    if (options.purpose) return next();
    return next();
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
      const agent = assembleCtx.agent;
      // The snapshot is frozen per live agent so the prompt prefix stays
      // byte-stable for prefix caching; new sessions see later writes.
      let snapshot = agent && memorySnapshots.get(agent);
      if (!snapshot || snapshot.botId !== bot.id) {
        snapshot = {
          botId: bot.id,
          memory: home ? readMemorySnapshot(home, bot.id) : { bot: { text: '' }, user: { text: '' } },
        };
        if (agent) memorySnapshots.set(agent, snapshot);
      }
      const sections = [`You are ${botDisplayName(bot, 'Bot')}.`];
      const persona = String(base ?? '').trim();
      if (persona) sections.push(`Your persona: ${persona}`);
      if (snapshot.memory.bot.text) sections.push(`## Notes\n${snapshot.memory.bot.text}`);
      if (snapshot.memory.user.text) sections.push(`## About the user\n${snapshot.memory.user.text}`);
      return sections.join('\n\n');
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
