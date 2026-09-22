/**
 * Autonomous memory-extraction loop. After enough completed turns — and once
 * more just before compaction — a one-shot side LLM call reviews the recent
 * conversation and writes durable dual-track entries through applyMemoryOps.
 * It never writes to the session transcript; auto entries carry `[auto]`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  applyMemoryOps,
  readMemoryTrack,
  scanMemoryEntryThreats,
} from './memory.js';
import { botModelSelection } from './model-policy.js';

const MAX_EXCERPT_CHARS = 20_000;
const FRESH_WINDOW_EVENTS = 40;
const MAX_OPS_PER_REVIEW = 8;
const MAX_WORK_NOTES = 20;
const MAX_CONSECUTIVE_FAILURES = 3;
const AUTO_PREFIX = '[auto] ';

const SYSTEM_PROMPT = 'You maintain the persistent memory of a coworker bot. '
  + 'From the conversation excerpt and existing notes, output ONLY a JSON object {"ops":[{...}]} with at most 8 ops. '
  + 'Each op: {"op":"add"|"replace"|"remove","track":"bot"|"user","text":"short fact","match":"unique substring for replace/remove"}. '
  + 'Store facts and preferences only — never instructions, never behavior requests, never secrets. '
  + "Track 'user' is for facts about the user; 'bot' is for project/work facts. "
  + 'Omit ops when nothing is worth persisting.';

// B-5: recent routine/task settlements ride along with the next review so the
// extractor sees work outcomes that never reached the transcript.
const workNotes = new Map();

export function pushWorkNote(botId, line) {
  const id = String(botId ?? '');
  const text = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!id || !text) return;
  const list = [...(workNotes.get(id) ?? []), text];
  workNotes.set(id, list.slice(-MAX_WORK_NOTES));
}

/** Latest recorded work note for a bot, or '' when none was pushed this runtime. */
export function latestWorkNote(botId) {
  const list = workNotes.get(String(botId ?? ''));
  return list?.length ? list[list.length - 1] : '';
}

const safeId = (botId) => String(botId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
const cursorPath = (homeDir, botId) => path.join(homeDir, 'dshbot-memory', `${safeId(botId)}.review.json`);

function readCursor(homeDir, botId) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cursorPath(homeDir, botId), 'utf8'));
  } catch {
    return { exists: false, seq: -1 };
  }
  return Number.isFinite(parsed?.seq)
    ? { exists: true, seq: Number(parsed.seq) }
    : { exists: false, seq: -1 };
}

/** Atomic sidecar write, same tmp+rename discipline as memory.js. */
function writeCursor(homeDir, botId, seq) {
  const file = cursorPath(homeDir, botId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ seq })}\n`, 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const eventSeq = (event) => {
  const seq = Number(event?.seq);
  return Number.isFinite(seq) ? seq : -1;
};

/** Plain text of a user/assistant message event; tool calls and results never enter. */
function eventText(event) {
  const role = event?.type === 'user/message' ? 'user'
    : event?.type === 'assistant/message' ? 'assistant' : '';
  if (!role) return '';
  const message = event.data?.message ?? event.data;
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text ? `[${role}] ${text}` : '';
}

/**
 * Render the excerpt for one window of events. Only user/assistant text
 * survives; the total is capped keeping the most recent content.
 */
export function buildExcerpt(events) {
  const rows = (Array.isArray(events) ? events : []).map(eventText).filter(Boolean);
  const kept = [];
  let size = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (kept.length === 0 && row.length > MAX_EXCERPT_CHARS) {
      kept.unshift(row.slice(-MAX_EXCERPT_CHARS));
      break;
    }
    if (size + row.length + (kept.length ? 1 : 0) > MAX_EXCERPT_CHARS) break;
    kept.unshift(row);
    size += row.length + (kept.length > 1 ? 1 : 0);
  }
  return kept.join('\n');
}

/** Events since the persisted cursor, or only the freshest window on a cold start. */
function windowFor(events, cursor) {
  const list = Array.isArray(events) ? events : [];
  if (cursor.exists) return list.filter((event) => eventSeq(event) > cursor.seq);
  return list.slice(-FRESH_WINDOW_EVENTS);
}

function reviewPrompt(memory, work, excerpt) {
  return [
    '## Current notes',
    memory.bot.text.trim() || '(empty)',
    '',
    '## About the user',
    memory.user.text.trim() || '(empty)',
    '',
    '## Recent work',
    work.length ? work.join('\n') : '(none)',
    '',
    '## Conversation excerpt',
    excerpt || '(none)',
  ].join('\n');
}

/** First parseable {...} JSON block; throws when no block yields an ops array. */
function parseOpsOutput(text) {
  const value = String(text ?? '');
  for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
    for (let end = value.indexOf('}', start); end > start; end = value.indexOf('}', end + 1)) {
      try {
        const parsed = JSON.parse(value.slice(start, end + 1));
        if (Array.isArray(parsed?.ops)) return parsed.ops;
        throw new Error('Memory review output has no ops array.');
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  throw new Error('Memory review output is not JSON.');
}

/**
 * Keep only well-formed, threat-free ops. Text for add/replace is prefixed so
 * learned entries stay distinguishable from user-written ones.
 */
function sanitizeOps(raw) {
  const ops = [];
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_OPS_PER_REVIEW)) {
    const op = String(entry?.op ?? '');
    if (!['add', 'replace', 'remove'].includes(op)) continue;
    const track = entry?.track === 'user' ? 'user' : 'bot';
    const text = String(entry?.text ?? '').trim();
    if (scanMemoryEntryThreats(text)) continue;
    const match = String(entry?.match ?? '').trim();
    if (op === 'add') {
      if (!text) continue;
      ops.push({ op, track, text: `${AUTO_PREFIX}${text}` });
    } else if (op === 'replace') {
      if (!text || !match) continue;
      ops.push({ op, track, text: `${AUTO_PREFIX}${text}`, match });
    } else {
      if (!match) continue;
      ops.push({ op, track, match });
    }
  }
  return ops;
}

/**
 * Register the background review loop.
 * @param {import('@deepseek-ai/cordis').Context | object} ctx
 * @param {{ getScope: () => { get: () => object }, memoryLimits?: object,
 *   reviewEvery?: number, home?: () => string }} deps
 */
export function registerMemoryReview(ctx, deps = {}) {
  const getScope = deps.getScope;
  const limits = deps.memoryLimits;
  const every = Math.max(1, Math.min(100, Math.floor(Number(deps.reviewEvery) || 10)));
  const homeDir = typeof deps.home === 'function'
    ? deps.home
    : () => process.env.DSH_HOME || process.env.DSHD_HOME || '';
  const states = new Map();
  const stateFor = (botId) => {
    let state = states.get(botId);
    if (!state) {
      state = { turns: 0, failures: 0, disabled: false, running: false, tail: Promise.resolve() };
      states.set(botId, state);
    }
    return state;
  };
  const warn = (message, error) => ctx.logger?.warn?.(
    'dshbot memory review: %s %s', message, String(error?.message ?? error ?? ''));
  const botForSession = (sessionId) => {
    let items = [];
    try {
      items = getScope?.().get?.().items ?? [];
    } catch {
      items = [];
    }
    return items.find((item) => item.kind !== 'room' && item.sessionId === sessionId);
  };

  const runReview = async (bot, events, state) => {
    const list = Array.isArray(events) ? events : [];
    const home = homeDir();
    const cursor = readCursor(home, bot.id);
    const excerpt = buildExcerpt(windowFor(list, cursor));
    const consumedSeq = eventSeq(list.at(-1));
    try {
      if (!home) throw new Error('DSH_HOME is not set');
      const selection = botModelSelection(bot, () => ctx.get?.('agentDefaultModel')?.currentSelection?.());
      const memory = {
        bot: readMemoryTrack(home, bot.id, 'bot'),
        user: readMemoryTrack(home, bot.id, 'user'),
      };
      const assembler = new BlockAssembler();
      const options = {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        system: SYSTEM_PROMPT,
        messages: [createUserMessage({
          content: [{ type: 'text', text: reviewPrompt(memory, workNotes.get(bot.id) ?? [], excerpt) }],
          source: { kind: 'plugin', plugin: 'dshbot' },
        })],
        ...(bot.sessionId ? { sessionId: bot.sessionId } : {}),
      };
      for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
      if (assembler.finish.kind !== 'stop') {
        throw new Error(`Memory review model finished with ${assembler.finish.kind}.`);
      }
      const output = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const ops = sanitizeOps(parseOpsOutput(output));
      if (ops.length > 0) applyMemoryOps(home, bot.id, ops, { limits });
      // Advance only once we actually consumed events; an empty first window
      // keeps the cold-start semantics of the last ~40 events.
      if (consumedSeq >= 0) writeCursor(home, bot.id, consumedSeq);
      state.failures = 0;
    } catch (error) {
      if (error?.code === 'MEMORY_FULL') {
        // The window is still marked consumed so the same excerpt is not
        // retried forever; curating space is left to the user or the bot.
        ctx.logger?.warn?.('dshbot memory.review_full: bot %s memory is at its limit; review round skipped', bot.id);
        try {
          if (consumedSeq >= 0) writeCursor(home, bot.id, consumedSeq);
        } catch (cursorError) {
          warn('cursor write failed', cursorError);
        }
        return;
      }
      state.failures += 1;
      warn(`review failed for bot ${bot.id} (${state.failures}/${MAX_CONSECUTIVE_FAILURES})`, error);
      if (state.failures >= MAX_CONSECUTIVE_FAILURES && !state.disabled) {
        state.disabled = true;
        ctx.logger?.warn?.('dshbot memory review disabled for bot %s after %d consecutive failures',
          bot.id, state.failures);
      }
    }
  };

  // The excerpt is captured synchronously: on compaction/start the transcript
  // is still fully present in snapshotEvents at this exact moment.
  const schedule = (bot, session) => {
    const state = stateFor(bot.id);
    if (state.disabled || state.running) return;
    let events = [];
    try {
      events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
    } catch {
      events = [];
    }
    state.running = true;
    state.tail = runReview(bot, events, state)
      .catch((error) => warn(`review crashed for bot ${bot.id}`, error))
      .finally(() => { state.running = false; });
  };

  ctx.on?.('session/event', (session, event) => {
    const type = event?.type;
    if (type !== 'turn/end' && type !== 'compaction/start') return;
    const bot = botForSession(session?.id);
    if (!bot || bot.memoryReview === false) return;
    if (type === 'compaction/start') {
      schedule(bot, session);
      return;
    }
    if (event.data?.reason?.kind !== 'completed') return;
    const state = stateFor(bot.id);
    state.turns += 1;
    if (state.turns < every) return;
    state.turns = 0;
    schedule(bot, session);
  });

  return {
    /** Await the in-flight review for one bot; resolves immediately when idle. */
    settled(botId) {
      return states.get(botId)?.tail ?? Promise.resolve();
    },
  };
}
