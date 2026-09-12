/**
 * ask_participant: one catalog member speaks (Grok member turn via spawn).
 * Prompt/system from group-chat.js; deliveries only via send_room_message.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { botDisplayName, stableBotName } from './bot-identity.js';
import { admitGroupMemberResult } from './group-chat.js';
import {
  activeRoomThreadId,
  childPersonaText,
  groupThreadIdForUserEvent,
  GROUP_MAX_MESSAGES_PER_TURN,
  isPassContent,
  latestRoomInputIdentity,
  memberDisplayName,
  memberTurnOrPass,
  memberVisibleText,
  resolveAskTarget,
  roomTurnPromptContentForSpeaker,
  roomTurnPromptForSpeaker,
} from './catalog.js';
import { currentTurnEpoch } from './group-chat-host.js';
import { composePersonaWithMemory, readBotMemory } from './memory.js';
import { botModelSelection } from './model-policy.js';
import {
  abortGroupMemberTurns,
  disposeGroupMemberRuntime,
  runGroupMemberTurn,
} from './group-member-runtime.js';

export const name = 'dshbot-ask-participant';
export const inject = ['tools'];

const NS = 'dshbot';

/** @type {Map<string, AbortController>} */
const inFlightByRoom = new Map();

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

function askParticipantErrorText(result, identity) {
  const structured = result?.error;
  const structuredCode = typeof structured?.info?.code === 'string'
    ? structured.info.code
    : typeof structured?.code === 'string' ? structured.code : '';
  const rawMessage = typeof structured?.message === 'string'
    ? structured.message
    : contentText(result?.content);
  const withoutPrefix = String(rawMessage ?? '').replace(/^Error:\s*/i, '').trim();
  const embedded = withoutPrefix.match(/^([A-Za-z][A-Za-z0-9_.:/-]+):\s*(.*)$/u);
  const code = structuredCode || embedded?.[1] || 'TOOL_FAILED';
  let message = structuredCode && embedded?.[1] === structuredCode
    ? embedded[2]
    : embedded && !structuredCode ? embedded[2] : withoutPrefix;
  if (identity?.stableName && identity.name !== identity.stableName) {
    message = message.replaceAll(identity.stableName, identity.name);
  }
  return `${code}: ${message || 'Unknown ask_participant failure.'}`;
}

function askParticipantIdentity(ctx, args) {
  const requestedId = String(args?.botId ?? '').trim();
  let items = [];
  try {
    const configured = ctx.settings?.get?.(NS)?.items;
    if (Array.isArray(configured)) items = configured;
  } catch {
    // Presentation must remain replay-safe when the catalog service is absent.
  }
  const byId = items.find((entry) => entry.id === requestedId && entry.kind !== 'room');
  const named = items.filter((entry) => entry.kind !== 'room' && entry.name === requestedId);
  const member = byId ?? (named.length === 1 ? named[0] : undefined);
  const botId = String(member?.id ?? requestedId) || 'unknown';
  const name = member ? botDisplayName(member, botId) : memberDisplayName(items, requestedId) || 'Bot';
  return { botId, name, stableName: member ? stableBotName(member) : botId };
}

function askParticipantFailureTitle(ctx, args) {
  const { botId, name } = askParticipantIdentity(ctx, args);
  return `${name} (${botId}) failed`;
}

/**
 * @param {readonly object[] | undefined} events
 * @returns {Generator<string>}
 */
function* successfulRoomMessages(events) {
  const all = events ?? [];
  const start = all.findLastIndex((event) => event?.type === 'turn/start');
  const list = all.slice(Math.max(0, start));
  const pending = new Set();
  for (const event of list) {
    if (event?.type === 'tool/call' && event.data?.name === 'send_room_message') {
      if (event.data?.callId) pending.add(event.data.callId);
      continue;
    }
    if (event?.type !== 'tool/result') continue;
    const callId = event.data?.message?.source?.callId;
    if (!callId || !pending.has(callId)) continue;
    pending.delete(callId);
    if (event.data.error || event.data.message?.content?.some((block) => block.isError === true)) continue;
    const raw = contentText(event.data.message?.content);
    let body = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.content === 'string') body = parsed.content;
    } catch {
      // Plain text tool results stay as-is.
    }
    yield body;
  }
}

function latestRoomInputKey(events, threadId) {
  return latestRoomInputIdentity(events, threadId);
}

function parentToolCall(events, callId) {
  const id = String(callId ?? '');
  return (events ?? []).findLast((event) => (
    event?.type === 'tool/call'
      && String(event.data?.callId ?? event.data?.toolCallId ?? '') === id
  ));
}

function normalizeGroupProtocol(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ask_participant groupProtocol must be an object.');
  }
  const phase = value.phase;
  const round = Number(value.round);
  if (!['normal', 'continuation'].includes(phase)
    || !Number.isInteger(round) || round < 0
    || !Array.isArray(value.responders)
    || value.responders.some((entry) => typeof entry !== 'string')) {
    throw new Error('ask_participant groupProtocol has invalid phase, round, or responders.');
  }
  if (value.continuation !== undefined
    && (!Number.isInteger(value.continuation) || value.continuation < 0)) {
    throw new Error('ask_participant groupProtocol continuation must be a non-negative integer.');
  }
  if (value.targets !== undefined
    && (!Array.isArray(value.targets) || value.targets.some((entry) => typeof entry !== 'string'))) {
    throw new Error('ask_participant groupProtocol targets must be an array of strings.');
  }
  return {
    phase,
    round,
    responders: [...value.responders],
    ...(value.continuation === undefined ? {} : { continuation: value.continuation }),
    ...(value.targets === undefined ? {} : { targets: [...value.targets] }),
  };
}

function groupProtocolSchema(required = false) {
  return {
    type: 'object',
    ...(required ? { required: true } : {}),
    additionalProperties: false,
    properties: {
      phase: {
        type: 'string',
        enum: ['normal', 'continuation'],
        required: true,
      },
      round: { type: 'integer', required: true },
      responders: {
        type: 'array',
        items: { type: 'string' },
        required: true,
      },
      continuation: { type: 'integer' },
      targets: { type: 'array', items: { type: 'string' } },
    },
  };
}

function askDispatchIdentity(events, roomSessionId, threadId, epoch, exec, groupProtocol) {
  const toolCallId = String(exec?.callId ?? '');
  const call = parentToolCall(events, toolCallId);
  return {
    roomSessionId,
    threadId,
    owningThreadId: threadId,
    memberSessionId: '',
    requestId: latestRoomInputKey(events, threadId),
    toolCallId,
    callId: toolCallId,
    turn: Number(call?.data?.turn ?? 0),
    step: Number(call?.data?.step ?? 0),
    epoch,
    ...(groupProtocol ? { groupProtocol } : {}),
  };
}

function newerRoomInputInThread(events, identity) {
  let foundDispatchInput = false;
  const list = events ?? [];
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index];
    if (event?.type !== 'user/message') continue;
    const source = event.data?.source;
    const admitted = source?.kind === 'user'
      || (source?.kind === 'plugin' && source.plugin === 'dshbot' && source.form === 'relay');
    if (!admitted) continue;
    const eventThreadId = groupThreadIdForUserEvent(event, index);
    const key = event.seq !== undefined
      ? `seq:${String(event.seq)}`
      : event.data?.id !== undefined ? `id:${String(event.data.id)}` : `index:${index}`;
    if (!foundDispatchInput) {
      foundDispatchInput = key === identity.requestId;
      continue;
    }
    if (eventThreadId === identity.threadId) return true;
  }
  return false;
}

function askParticipantValue(bot, identity, texts, status) {
  const deliveries = Array.isArray(texts) ? texts.map((text) => String(text ?? '')) : [];
  return {
    botId: bot.id,
    name: botDisplayName(bot),
    text: deliveries.join('\n\n'),
    texts: deliveries,
    roomSessionId: identity.roomSessionId,
    threadId: identity.threadId,
    memberSessionId: identity.memberSessionId,
    requestId: identity.requestId,
    toolCallId: identity.toolCallId,
    turn: identity.turn,
    step: identity.step,
    epoch: identity.epoch,
    status,
    ...(identity.groupProtocol ? { groupProtocol: identity.groupProtocol } : {}),
  };
}

function admitAskParticipantValue(parent, value) {
  const events = parent.session.snapshotEvents();
  const newerUserEntryInThread = newerRoomInputInThread(events, value);
  const currentEpoch = currentTurnEpoch(value.roomSessionId);
  const admission = admitGroupMemberResult({
    result: value,
    threadId: value.threadId,
    epochAtDispatch: value.epoch,
    currentEpoch: newerUserEntryInThread && currentEpoch === value.epoch
      ? currentEpoch + 1
      : currentEpoch,
    newerUserEntryInThread,
  });
  return admission.admitted
    ? value
    : { ...value, text: '', texts: [], status: 'stale' };
}

function hasAttachments(content) {
  return (Array.isArray(content) ? content : []).some((block) => (
    (block?.type === 'image' || block?.type === 'file') && block.attachment !== undefined
  ));
}

function dshHomeDir() {
  return process.env.DSH_HOME || process.env.DSHD_HOME || '';
}

/** Read the current Bot memory whenever a new group member turn is prepared. */
export function groupMemberPersonaForTurn(bot, others, group) {
  const base = childPersonaText(bot, others, { group });
  const home = dshHomeDir();
  return composePersonaWithMemory(base, home ? readBotMemory(home, bot.id) : '');
}

/** Successful pass or the existing delivery cap closes a member turn before another model call. */
export function isRoomMemberTurnComplete(events) {
  let delivered = 0;
  for (const body of successfulRoomMessages(events)) {
    if (isPassContent(body)) return true;
    if (memberVisibleText(body) && ++delivered >= GROUP_MAX_MESSAGES_PER_TURN) return true;
  }
  return false;
}

function extractSendRoomDeliveries(events) {
  const deliveries = [];
  for (const body of successfulRoomMessages(events)) {
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
export function abortRoomMemberTurns(roomSessionId, cause) {
  // An ordinary epoch bump is only an admission fence. Hermes lets the old
  // worker settle, then rejects it only for a newer entry in the same thread.
  if (cause === undefined) return;
  abortGroupMemberTurns(roomSessionId, cause);
  const prior = inFlightByRoom.get(roomSessionId);
  if (prior) {
    try {
      prior.abort(cause);
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
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
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
  const ownedTurns = new Map();
  const consumedAttachmentBatches = new Map();
  ctx.effect?.(() => async () => {
    for (const [controller, roomId] of ownedTurns) {
      controller.abort();
      if (inFlightByRoom.get(roomId) === controller) inFlightByRoom.delete(roomId);
    }
    ownedTurns.clear();
    consumedAttachmentBatches.clear();
    await disposeGroupMemberRuntime();
  });
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
      threadId: {
        type: 'string',
        description: 'Stable room thread containing this member turn.',
      },
      groupProtocol: {
        ...groupProtocolSchema(),
        description: 'Deterministic group round and continuation dispatch metadata.',
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
          roomSessionId: { type: 'string', required: true },
          threadId: { type: 'string', required: true },
          memberSessionId: { type: 'string', required: true },
          requestId: { type: 'string', required: true },
          toolCallId: { type: 'string', required: true },
          turn: { type: 'number', required: true },
          step: { type: 'number', required: true },
          epoch: { type: 'number', required: true },
          status: { type: 'string', required: true },
          groupProtocol: groupProtocolSchema(),
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
      presentationMeta: (_args, value) => ({
        dshbotGroupTurn: {
          roomSessionId: value.roomSessionId,
          threadId: value.threadId,
          memberSessionId: value.memberSessionId,
          requestId: value.requestId,
          toolCallId: value.toolCallId,
          turn: value.turn,
          step: value.step,
          epoch: value.epoch,
          status: value.status,
          ...(value.groupProtocol ? { groupProtocol: value.groupProtocol } : {}),
        },
      }),
    },
    finalizeContent: (_exec, result) => {
      if (result.isError !== true && result.ok !== false) return undefined;
      const identity = askParticipantIdentity(ctx, _exec?.arguments ?? {});
      return [{ type: 'text', text: `Error: ${askParticipantErrorText(result, identity)}` }];
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
    presentResult: (args, result) => {
      if (result.isError === true || result.ok === false) {
        const identity = askParticipantIdentity(ctx, args);
        return {
          card: 'generic',
          title: askParticipantFailureTitle(ctx, args),
          content: [{ type: 'text', text: `Error: ${askParticipantErrorText(result, identity)}` }],
        };
      }
      if (result.ok !== true
        && !(result.isError === false && result.value !== undefined)) return undefined;
      const value = result.value;
      if (typeof value !== 'object' || value === null) return undefined;
      const name = askParticipantIdentity(ctx, args).name;
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

      const catalog = ctx.settings.get(NS);
      const items = catalog?.items ?? [];
      const target = resolveAskTarget(items, roomSessionId, args.botId);
      const bot = target.bot;
      const others = (target.room.memberBotIds ?? [])
        .filter((id) => id !== bot.id)
        .map((id) => items.find((entry) => entry.id === id && entry.kind !== 'room'))
        .filter(Boolean);

      const events = parent.session.snapshotEvents();
      const threadId = String(args.threadId ?? '').trim() || activeRoomThreadId(events);
      const groupProtocol = normalizeGroupProtocol(args.groupProtocol);
      const dispatchIdentity = askDispatchIdentity(
        events, roomSessionId, threadId, epoch, exec, groupProtocol,
      );
      const instruction = String(args.instruction ?? '').trim()
        || roomTurnPromptForSpeaker(items, target.room, events, bot.id, threadId);
      const attachmentBatch = latestRoomInputKey(events, threadId);
      const attachmentConsumer = `${roomSessionId}:${bot.id}`;
      const includeAttachments = !attachmentBatch
        || consumedAttachmentBatches.get(attachmentConsumer) !== attachmentBatch;
      const prompt = roomTurnPromptContentForSpeaker(
        items, target.room, events, bot.id, instruction, includeAttachments, threadId,
      );
      const agentOptions = botModelSelection(bot, () => ctx.get('agentDefaultModel')?.currentSelection());
      const persona = groupMemberPersonaForTurn(bot, others, {
        name: target.room.name,
        description: target.room.description,
      });

      const localAbort = new AbortController();
      // Do not abort peers in the same epoch; index.js aborts on epoch bump only.
      inFlightByRoom.set(roomSessionId, localAbort);
      ownedTurns.set(localAbort, roomSessionId);
      const onParentAbort = () => localAbort.abort(exec.signal?.reason);
      exec.signal?.addEventListener?.('abort', onParentAbort, { once: true });

      try {
        try {
          return await memberTurnOrPass(bot, async () => {
            const run = await runGroupMemberTurn({
              ownerCtx: ctx,
              parent,
              room: target.room,
              roomSessionId,
              threadId,
              bot,
              persona,
              agentOptions,
              content: prompt,
              signal: localAbort.signal,
              abortController: localAbort,
              dispatchIdentity,
            });
            if (attachmentBatch && hasAttachments(prompt)) {
              consumedAttachmentBatches.set(attachmentConsumer, attachmentBatch);
            }
            const deliveries = extractSendRoomDeliveries(run.events);
            const identity = {
              ...dispatchIdentity,
              ...run.dispatchIdentity,
              memberSessionId: run.sessionId,
            };
            const status = deliveries.length > 0 ? 'replied' : 'passed';
            return admitAskParticipantValue(parent, askParticipantValue(bot, identity, deliveries, status));
          });
        } catch (error) {
          const failedIdentity = {
            ...dispatchIdentity,
            memberSessionId: String(error?.sessionId ?? ''),
          };
          if (newerRoomInputInThread(parent.session.snapshotEvents(), failedIdentity)) {
            return askParticipantValue(bot, failedIdentity, [], 'stale');
          }
          throw error;
        }
      } finally {
        ownedTurns.delete(localAbort);
        if (inFlightByRoom.get(roomSessionId) === localAbort) {
          inFlightByRoom.delete(roomSessionId);
        }
        exec.signal?.removeEventListener?.('abort', onParentAbort);
      }
    },
  }));
}

/**
 * Keep the room protocol available to the room and its descendants.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // The room parent only schedules and receives deliveries. Member turns run
  // in separate persistent Sessions with their own profile capability guard.
  ctx.tools.restrict({ allow: ['ask_participant', 'send_room_message'] });
}
