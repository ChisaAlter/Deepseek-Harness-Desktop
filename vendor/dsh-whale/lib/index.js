/**
 * Host apply for dsh-whale: the `dsh-whale` settings namespace, the
 * whale-girl agent preset + whale home provisioning, the persistent
 * assistant session, live persona injection, and the `/dsh-whale` RPC
 * surface the client settings page uses.
 *
 * The orchestration tools themselves mount via the preset row
 * `dsh-whale/tools` (lib/tools.js) so they stay scoped to whale sessions.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { createWhaleScope } from './scope.js';
import { buildPersonaText, normalizePersonality, PERSONALITIES } from './persona.js';
import { startPulse } from './observe.js';
import {
  SYSTEM_REMINDER_RE,
  controllerFrom,
  eventText,
  sessionIdFromRow,
  sessionRowsFrom,
  sessionSnapshot,
  trimTo,
} from './shared.js';
import {
  WHALE_PRESET_ID,
  ensureWhalePreset,
  ensureWhaleHome,
  listWhaleSkills,
  setWhaleSkillEnabled,
  whaleHomeDir,
  appendPetOutbox,
} from './preset.js';

export const name = 'dsh-whale';
export const inject = ['settings', 'systemPrompt'];

export const Config = z.object({});

const WhaleSchema = z.object({
  name: z.string().default('鲸鱼娘'),
  personality: z.string().default('natural'),
  userTitle: z.string().default(''),
  personaText: z.string().default(''),
  modelProvider: z.string().default(''),
  modelModel: z.string().default(''),
  modelReasoningEffort: z.string().default(''),
  imDefault: z.boolean().default(false),
  sessionId: z.string().default(''),
});

const PRESENTATION_OWNER = 'dsh-whale:assistant';
const MEMORY_MAX_CHARS = 40000;
const MAX_RPC_BODY_BYTES = 4 * 1024 * 1024;

async function readBoundedJson(req, maxBytes) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    const error = new Error('payload too large');
    error.status = 413;
    req.destroy();
    throw error;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.byteLength;
    if (received > maxBytes) {
      const error = new Error('payload too large');
      error.status = 413;
      req.destroy();
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('body is not JSON');
    error.status = 400;
    throw error;
  }
}

function dshHomeDir() {
  return process.env.DSH_HOME || '';
}

function whaleDisplayName(settings) {
  return `🐳 ${String(settings?.name ?? '').trim() || '鲸鱼娘'}`;
}

/**
 * Find-or-create the persistent assistant session. The session id lives in
 * the settings catalog so restarts reuse the same conversation; a missing
 * or dead session id falls through to a fresh create exactly once, under
 * the same stable-id contract the dshbot room sessions use.
 */
async function ensureAssistantSession(ctx, scope, controller) {
  const home = dshHomeDir();
  if (!home) return { ok: false, error: 'missing-home' };
  ensureWhaleHome(home);
  controller = controller ?? controllerFrom(ctx);
  if (typeof controller?.list !== 'function' || typeof controller?.create !== 'function') {
    return { ok: false, error: 'session-controller-unavailable' };
  }
  const snap = scope.get() ?? {};
  const sessionId = String(snap.sessionId ?? '').trim() || `session-whale-${crypto.randomUUID()}`;
  const rows = sessionRowsFrom(await controller.list({}));
  const existing = rows.find((row) => sessionIdFromRow(row) === sessionId);
  const presentation = {
    owner: PRESENTATION_OWNER,
    title: whaleDisplayName(snap),
  };
  let created = false;
  if (!existing) {
    const result = await controller.create({
      sessionId,
      cwd: whaleHomeDir(home),
      agentPreset: WHALE_PRESET_ID,
      presentation,
    });
    const createdId = sessionIdFromRow(result) || sessionIdFromRow(result?.session) || sessionId;
    if (createdId !== sessionId) {
      throw new Error(`assistant session create changed identity ${sessionId} -> ${createdId}`);
    }
    created = true;
  } else if (typeof controller.setPresentation === 'function') {
    // Keep the title in lockstep with the configured name; also rewrite a
    // stale `composer:'managed'` frame from older versions — her composer is
    // the normal session surface (model/effort dock, header actions).
    // List rows carry presentation under the sessionListMetadata projection,
    // not as a top-level field.
    const current = existing?.projections?.values?.sessionListMetadata?.presentation
      ?? existing?.presentation;
    if (current?.owner === PRESENTATION_OWNER
      && (current?.title !== presentation.title || current?.composer !== presentation.composer)) {
      await controller.setPresentation({ sessionId, presentation }).catch(() => {});
    }
  }
  if (snap.sessionId !== sessionId) {
    const latest = scope.get() ?? {};
    await scope.set({ ...latest, sessionId }, latest).catch(() => {});
  }
  if (created && snap.modelProvider && snap.modelModel
    && typeof controller.selectModel === 'function') {
    await controller.selectModel({
      sessionId,
      provider: snap.modelProvider,
      model: snap.modelModel,
      ...(snap.modelReasoningEffort ? { reasoningEffort: snap.modelReasoningEffort } : {}),
      saveAsDefault: false,
    }).catch(() => {});
  }
  return { ok: true, sessionId, created };
}

function sanitizePatch(input) {
  const patch = {};
  if (input && typeof input === 'object') {
    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      patch.name = trimTo(input.name, 64).trim() || '鲸鱼娘';
    }
    if (Object.prototype.hasOwnProperty.call(input, 'personality')) {
      patch.personality = normalizePersonality(input.personality);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'userTitle')) {
      patch.userTitle = trimTo(input.userTitle, 64).trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'personaText')) {
      patch.personaText = trimTo(input.personaText, 4000);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'imDefault')) {
      patch.imDefault = input.imDefault === true;
    }
    if (input.model && typeof input.model === 'object') {
      patch.modelProvider = trimTo(input.model.provider, 128);
      patch.modelModel = trimTo(input.model.model, 128);
      patch.modelReasoningEffort = trimTo(input.model.reasoningEffort, 32);
    }
  }
  return patch;
}

async function applyCatalogPatch(scope, patch) {
  const previous = scope.get() ?? {};
  const next = { ...previous, ...patch };
  await scope.set(next, previous);
  return scope.get();
}

function memoryFile() {
  const home = dshHomeDir();
  return home ? path.join(whaleHomeDir(home), 'MEMORY.md') : '';
}

function readMemory() {
  const file = memoryFile();
  if (!file || !fs.existsSync(file)) return '';
  return trimTo(fs.readFileSync(file, 'utf8'), MEMORY_MAX_CHARS);
}

function writeMemory(text) {
  const file = memoryFile();
  if (!file) throw new Error('missing-home');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, trimTo(text, MEMORY_MAX_CHARS), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * IM default binding: when `imDefault` is on, write `agentPreset` into every
 * dsh-im channel account that does not already choose one. Only absent/
 * empty values are filled — an explicit user choice is never overwritten;
 * `null` per dsh-im means "follow host default".
 */
function applyImDefault(home, enabled) {
  const root = path.join(home, 'integrations');
  if (!fs.existsSync(root)) return { ok: true, touched: 0 };
  let touched = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-')) continue;
    const file = path.join(root, entry.name, 'config.json');
    if (!fs.existsSync(file)) continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!Array.isArray(doc?.accounts)) continue;
    let dirty = false;
    for (const account of doc.accounts) {
      if (enabled && (account.agentPreset === undefined || account.agentPreset === '')) {
        account.agentPreset = WHALE_PRESET_ID;
        dirty = true;
      } else if (!enabled && account.agentPreset === WHALE_PRESET_ID) {
        delete account.agentPreset;
        dirty = true;
      }
    }
    if (!dirty) continue;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    touched += 1;
  }
  return { ok: true, touched };
}

// ── pet bridge ─────────────────────────────────────────────────
// The desktop pet's quick-chat card is a second surface onto the SAME
// persistent assistant session: messages go through `controller.prompt`
// so they land in the shared log, replies come back by following the
// turn stream, and the card's model picker is just the session's own
// selection — what you see in the DSHD conversation is what the pet saw.

const PET_HISTORY_MAX = 24;
const PET_TEXT_MAX = 800;
const PET_CHAT_TIMEOUT_MS = 120000;

/** Recent user/assistant tail of the shared session for card backfill. */
function historyFromRecords(records) {
  const out = [];
  for (const rec of records ?? []) {
    const ev = rec?.event ?? rec;
    if (ev?.type !== 'user/message' && ev?.type !== 'assistant/message') continue;
    // Relayed user/messages (whale tools kind:'plugin', IM bridges) are not
    // the human talking — rendering them as user rows would confuse the card.
    const srcKind = ev?.data?.source?.kind;
    if (ev.type === 'user/message' && srcKind && srcKind !== 'user') continue;
    // Workspace-instruction wrappers ride inside the user message; strip the
    // reminder block and drop the row when nothing human-facing remains.
    const text = eventText(ev).replace(SYSTEM_REMINDER_RE, '').trim();
    if (!text) continue;
    out.push({
      role: ev.type === 'user/message' ? 'user' : 'her',
      text: trimTo(text, PET_TEXT_MAX),
      seq: Number(ev.seq) || 0,
    });
  }
  return out.slice(-PET_HISTORY_MAX);
}

/** Current session model = pending selection if any, else last used.
 * The wire view publishes `{lastUsed, next}` — `pending` is internal state. */
function selectedModelFrom(snapshot) {
  const sel = snapshot?.projections?.values?.modelSelection;
  const cur = sel?.next ?? sel?.lastUsed;
  if (!cur?.provider || !cur?.model) return null;
  return {
    provider: String(cur.provider),
    model: String(cur.model),
    reasoningEffort: String(cur.reasoningEffort ?? ''),
  };
}

function catalogGroups(catalog) {
  return (catalog?.groups ?? []).map((g) => ({
    id: String(g.id ?? ''),
    name: String(g.name ?? g.id ?? ''),
    models: (g.models ?? []).map((m) => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? ''),
      efforts: (m.reasoning?.efforts ?? []).map((e) => ({
        id: String(e.id ?? ''),
        name: String(e.name ?? e.id ?? ''),
      })),
      defaultEffort: String(m.reasoning?.defaultEffort ?? ''),
    })),
  })).filter((g) => g.id && g.models.length);
}

/**
 * Send one pet-card message into the shared session and collect the turn's
 * assistant text. The event bus (`session/event`, same one the follow
 * generator subscribes) avoids the Remote stream carrier entirely — a
 * follow iterable closes when its carrier's caller finishes, which is not
 * the lifetime a chat reply needs.
 * Scoping: our prompt is identified by its requestId (the durable
 * user/message carries it back on `data.source.rpcId`). The queue mode
 * commits that message only inside our own turn's boundary, so the FIRST
 * `turn/end` seen after `mine` is unconditionally ours — including an
 * error/aborted/empty end, which must resolve instead of hanging to the
 * timeout (or worse, resolving on a later unrelated turn).
 */
function petSessionTurn(ctx, controller, sessionId, { requestId, matchText, content, timeoutMs }) {
  const ac = new AbortController();
  return new Promise((resolve) => {
    let mine = false;
    const texts = [];
    let off = null;
    const finish = (out) => {
      clearTimeout(timer);
      try { off?.(); } catch { /* disposer best-effort */ }
      ac.abort();
      resolve(out);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    off = typeof ctx.on === 'function'
      ? ctx.on('session/event', (session, event) => {
        try {
          if (String(session?.id ?? session ?? '') !== String(sessionId)) return;
          const d = event?.data ?? {};
          if (!mine) {
            if (event?.type === 'user/message') {
              const rid = d.source?.rpcId;
              // rpcId is the reliable claim; the text-equality fallback only
              // accepts genuinely user-sourced messages (plugin/IM relays
              // carry their own source.kind and never an rpcId).
              if (rid === requestId
                || (!rid && (!d.source?.kind || d.source.kind === 'user')
                    && eventText({ data: d }).trim() === matchText)) {
                mine = true;
              }
            }
            return;
          }
          if (event?.type === 'assistant/message') {
            const t = eventText({ data: d }).trim();
            if (t) texts.push(t);
            return;
          }
          if (event?.type === 'turn/end') {
            const reply = texts.join('\n').trim();
            if (reply) {
              finish({ ok: true, reply: trimTo(reply, PET_TEXT_MAX * 4) });
            } else {
              const kind = d.reason?.kind;
              finish(kind === 'completed'
                ? { ok: true, reply: '' }
                : { ok: false, error: `turn-${typeof kind === 'string' ? kind : 'unknown'}` });
            }
          }
        } catch { /* one bad frame never kills the turn watcher */ }
      }, { global: true })
      : null;
    if (typeof off !== 'function') {
      finish({ ok: false, error: 'event-bus-unavailable' });
      return;
    }
    // A rejected prompt never committed its user/message — flag it so the
    // caller can fall back; a later turn error is reported as a turn result.
    controller.prompt({ requestId, sessionId, mode: 'queue', content }, ac.signal)
      .catch((error) => finish({
        ok: false,
        error: String(error?.message ?? error),
        admission: true,
      }));
  });
}

function petChatTurn(ctx, controller, sessionId, text) {
  return petSessionTurn(ctx, controller, sessionId, {
    requestId: `pet-${crypto.randomUUID()}`,
    matchText: text,
    content: [{ type: 'text', text }],
    timeoutMs: PET_CHAT_TIMEOUT_MS,
  });
}

// 「看看屏幕」: the glance belongs inside her conversation, so it rides a
// real queued prompt whenever her session route can carry the picture —
// the screenshot lands as a user row and her comment as a real assistant
// row settled by a real turn (a fabricated assistant event would be
// rejected on replay: settlement fields must name the live turn/step).
// When her current model cannot see and no vision fallback is configured,
// the glance stays a standalone `ctx.llm.stream` call on the configured
// look route — the caller's provider+model pick resolves the adapter and
// its credentials, which the desktop shell's own baseUrl cannot express —
// and the exchange is recorded as a folded plugin notice: the picture
// itself stays out of history because a block her own requests cannot
// carry would fail every later turn.

const LOOK_MAX_TOKENS = 1024;
const LOOK_TIMEOUT_MS = 45000;
const LOOK_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const LOOK_SESSION_WAIT_MS = 50000;
const LOOK_SESSION_TEXT = '看一眼我现在的屏幕，随口说说你看到什么。';

function lookFinishError(finish) {
  if (!finish || finish.kind === 'stop' || finish.kind === 'max-tokens') return undefined;
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const failure = finish.failure ?? {};
    return {
      code: trimTo(String(failure.code ?? 'UNKNOWN'), 64) || 'UNKNOWN',
      message: trimTo(String(failure.message ?? ''), 200),
      ...(typeof failure.status === 'number' ? { status: failure.status } : {}),
    };
  }
  return { code: 'UNEXPECTED_FINISH', message: trimTo(String(finish.kind ?? ''), 64) };
}

async function petLook(ctx, scope, { provider, model, image }) {
  const llm = ctx.get?.('llm');
  const attachments = ctx.get?.('attachments');
  if (typeof llm?.stream !== 'function' || typeof attachments?.saveImages !== 'function') {
    return { ok: false, error: 'vision-stack-unavailable' };
  }
  const bytes = Buffer.from(image, 'base64');
  if (!bytes.length || bytes.length > LOOK_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'bad-image' };
  }
  // Preferred path: her own session answers the glance in a real turn.
  // Null means the session route cannot take the picture (or no session
  // exists) — the standalone look-model call below stays the fallback.
  const inSession = await lookInSession(ctx, scope, image).catch(() => null);
  if (inSession) return inSession;
  let modelInfo;
  try {
    modelInfo = await llm.resolveModelInfo?.(provider, model);
  } catch (error) {
    return { ok: false, error: 'model-resolve-failed', detail: trimTo(error?.message ?? String(error), 200) };
  }
  if (modelInfo && Array.isArray(modelInfo.inputModalities)
    && !modelInfo.inputModalities.includes('image')) {
    return { ok: false, error: 'model-no-vision', detail: '所选模型不支持图像输入' };
  }
  let ref;
  try {
    [ref] = await attachments.saveImages([
      { data: new Uint8Array(bytes), mediaType: 'image/jpeg', name: 'pet-look.jpg' },
    ]);
  } catch (error) {
    return { ok: false, error: 'image-rejected', detail: trimTo(error?.message ?? String(error), 200) };
  }
  const assembler = new BlockAssembler();
  // A glance needs no CoT pass — where the model exposes an "off" effort,
  // take it so hidden reasoning cannot eat the whole output budget.
  const reasoningOff = modelInfo?.reasoning?.efforts?.some((e) => e?.id === 'off');
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      ...(reasoningOff ? { reasoningEffort: 'off' } : {}),
      messages: [createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-whale' },
        content: [
          { type: 'image', attachment: ref },
          { type: 'text', text: '这是用户此刻的屏幕截图。用你的人设随口点评你实际看到的东西——像瞟了一眼工位那样，一两句话，别报菜名。' },
        ],
      })],
      system: buildPersonaText(scope.get() ?? {}),
      maxTokens: LOOK_MAX_TOKENS,
      purpose: 'vision-describe',
      signal: AbortSignal.timeout(LOOK_TIMEOUT_MS),
    })) {
      assembler.push(chunk);
    }
  } catch (error) {
    return { ok: false, error: 'model-error', detail: trimTo(error?.message ?? String(error), 200) };
  }
  const failure = lookFinishError(assembler.finish);
  if (failure) {
    return {
      ok: false,
      error: 'model-error',
      detail: failure.message || failure.code,
      code: failure.code,
      ...(failure.status === undefined ? {} : { status: failure.status }),
    };
  }
  const reply = assembler.blocks()
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!reply) {
    // A clean finish with no text most often means a reasoning model
    // burned the whole budget thinking — name that instead of a bare
    // 'empty-reply' the user cannot act on.
    return assembler.finish?.kind === 'max-tokens'
      ? { ok: false, error: 'model-error', detail: '输出 token 用尽（模型可能在思考中耗尽）', code: 'OUTPUT_TRUNCATED' }
      : { ok: false, error: 'empty-reply', detail: '模型回了空响应' };
  }
  // Bound the wait, not the write — the RPC caller holds a ~60s envelope
  // and a slow session resume must not turn a finished glance into a
  // transport timeout. The append may still land after the reply returns.
  await Promise.race([
    logLookNote(ctx, scope, reply),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
  return { ok: true, reply: trimTo(reply, PET_TEXT_MAX) };
}

/**
 * Whether the assistant session's current route can carry an image block
 * in derived history: the selected model declares image input, or a
 * vision fallback route is configured to describe it. Unresolvable
 * selections and failed model-info reads count as incapable — a picture
 * admitted anyway would fail every later request on a text-only route.
 */
async function lookImageAdmissible(ctx, controller, sessionId) {
  if (ctx.get?.('visionFallback')?.configured?.() === true) return true;
  const selected = selectedModelFrom(await sessionSnapshot(controller, sessionId, PET_HISTORY_MAX + 8));
  if (!selected) return false;
  const info = await ctx.get?.('llm')?.resolveModelInfo?.(selected.provider, selected.model)
    .catch(() => undefined);
  return info?.inputModalities?.includes('image') === true;
}

/**
 * Route the glance through her persistent session: one ordinary queued
 * prompt — screenshot as a user row, her comment as a real assistant row
 * settled by a real turn. Returns the turn's outcome once admitted;
 * returns null when the session path cannot take the picture (no usable
 * session, or a route without image input and no vision fallback), or
 * when prompt admission rejects, so the caller can run the standalone
 * glance instead. A turn that was admitted reports its own result —
 * including timeout — because its record already exists in her log.
 */
async function lookInSession(ctx, scope, imageBase64) {
  const controller = controllerFrom(ctx);
  const ensured = await ensureAssistantSession(ctx, scope, controller);
  if (!ensured.ok || typeof controller?.prompt !== 'function') return null;
  if (!(await lookImageAdmissible(ctx, controller, ensured.sessionId))) return null;
  const outcome = await petSessionTurn(ctx, controller, ensured.sessionId, {
    requestId: `pet-look-${crypto.randomUUID()}`,
    matchText: LOOK_SESSION_TEXT,
    content: [
      { type: 'image', mediaType: 'image/jpeg', data: imageBase64 },
      { type: 'text', text: LOOK_SESSION_TEXT },
    ],
    timeoutMs: LOOK_SESSION_WAIT_MS,
  });
  if (outcome.admission) return null;
  if (outcome.ok === true && !outcome.reply) {
    return { ok: false, error: 'empty-reply', detail: '模型回了空响应' };
  }
  return outcome;
}

/**
 * Record a standalone glance as a folded context notice — plugin-owned,
 * never a user bubble, and image-free: this path only runs when her
 * session route cannot carry the picture, so the notice keeps the fact
 * and her one-line comment in history without poisoning later requests.
 * Logging is caller-contained: a glance that cannot be recorded still
 * answers.
 */
async function logLookNote(ctx, scope, reply) {
  try {
    const controller = controllerFrom(ctx);
    const ensured = await ensureAssistantSession(ctx, scope, controller);
    if (!ensured.ok) return;
    let agent = ctx.get?.('agents')?.get?.(ensured.sessionId);
    if (!agent && typeof controller?.resolveAgent === 'function') {
      const resolved = await controller.resolveAgent(ensured.sessionId).catch(() => null);
      agent = resolved && 'agent' in resolved ? resolved.agent : undefined;
    }
    if (typeof agent?.session?.append !== 'function') return;
    agent.session.append('user/message', createUserMessage({
      source: {
        kind: 'plugin',
        plugin: 'dsh-whale',
        form: 'notice',
        summary: '她瞟了一眼屏幕',
      },
      content: [{ type: 'text', text: `（她瞟了一眼屏幕：${reply}）` }],
    }), { surfaceOp: 'append' });
  } catch (error) {
    ctx.logger?.warn?.(`dsh-whale look log failed: ${error?.message ?? error}`);
  }
}

function registerRpc(ctx, scope) {
  const handle = async (endpoint, input) => {
    const home = dshHomeDir();
    switch (endpoint) {
      case 'catalog': {
        const snap = scope.get() ?? {};
        return {
          ...snap,
          personalityOptions: PERSONALITIES,
          skills: home ? listWhaleSkills(home) : [],
          memory: readMemory(),
          homeDir: home ? whaleHomeDir(home) : '',
        };
      }
      case 'settings/update': {
        const patch = sanitizePatch(input);
        const next = await applyCatalogPatch(scope, patch);
        if (Object.prototype.hasOwnProperty.call(patch, 'imDefault') && home) {
          applyImDefault(home, patch.imDefault);
        }
        if (patch.name && next.sessionId) {
          const controller = controllerFrom(ctx);
          controller?.setPresentation?.({
            sessionId: next.sessionId,
            presentation: {
              owner: PRESENTATION_OWNER,
              title: whaleDisplayName(next),
            },
          })?.catch?.(() => {});
        }
        return next;
      }
      case 'assistant/ensure': {
        return ensureAssistantSession(ctx, scope, controllerFrom(ctx));
      }
      case 'memory/replace': {
        const text = trimTo(input?.text, MEMORY_MAX_CHARS);
        writeMemory(text);
        return { ok: true, chars: text.length };
      }
      case 'memory/clear': {
        writeMemory('# 鲸鱼娘的长期记忆\n\n（还没有记住什么。）\n');
        return { ok: true };
      }
      case 'skills/toggle': {
        if (!home) return { ok: false, error: 'missing-home' };
        return setWhaleSkillEnabled(home, input?.name, input?.enabled === true);
      }
      case 'pet/say': {
        if (!home) return { ok: false, error: 'missing-home' };
        appendPetOutbox(home, 'say', input?.text);
        return { ok: true };
      }
      case 'pet/state': {
        const ensured = await ensureAssistantSession(ctx, scope, controllerFrom(ctx));
        if (!ensured.ok) return ensured;
        const controller = controllerFrom(ctx);
        const snapshot = typeof controller?.follow === 'function'
          ? await sessionSnapshot(controller, ensured.sessionId, PET_HISTORY_MAX + 8)
          : null;
        let catalog = null;
        try { catalog = await controller?.modelCatalog?.(); } catch { catalog = null; }
        return {
          ok: true,
          sessionId: ensured.sessionId,
          name: (scope.get() ?? {}).name || '鲸鱼娘',
          model: selectedModelFrom(snapshot),
          groups: catalogGroups(catalog),
          history: historyFromRecords(snapshot?.records),
        };
      }
      case 'pet/select-model': {
        const ensured = await ensureAssistantSession(ctx, scope, controllerFrom(ctx));
        if (!ensured.ok) return ensured;
        const controller = controllerFrom(ctx);
        const provider = String(input?.provider ?? '').trim();
        const model = String(input?.model ?? '').trim();
        const reasoningEffort = String(input?.reasoningEffort ?? '').trim();
        if (!provider || !model) return { ok: false, error: 'missing-model' };
        if (typeof controller?.selectModel !== 'function') {
          return { ok: false, error: 'session-controller-unavailable' };
        }
        const result = await controller.selectModel({
          sessionId: ensured.sessionId,
          provider,
          model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          // Card picks are session-local — the non-managed presentation means
          // the controller would otherwise write the app-global default.
          saveAsDefault: false,
        });
        return { ok: true, selected: result?.selected ?? { provider, model, reasoningEffort } };
      }
      case 'pet/chat': {
        const text = trimTo(input?.text, 2000).trim();
        if (!text) return { ok: false, error: 'empty-input' };
        const ensured = await ensureAssistantSession(ctx, scope, controllerFrom(ctx));
        if (!ensured.ok) return ensured;
        const controller = controllerFrom(ctx);
        if (typeof controller?.prompt !== 'function' || typeof controller?.follow !== 'function') {
          return { ok: false, error: 'session-controller-unavailable' };
        }
        return petChatTurn(ctx, controller, ensured.sessionId, text);
      }
      case 'pet/look': {
        const provider = trimTo(input?.provider, 128).trim();
        const model = trimTo(input?.model, 128).trim();
        if (!provider || !model) return { ok: false, error: 'missing-model' };
        const image = typeof input?.image === 'string' ? input.image : '';
        if (!image) return { ok: false, error: 'missing-image' };
        return petLook(ctx, scope, { provider, model, image });
      }
      default:
        return { ok: false, error: `unknown-endpoint:${String(endpoint)}` };
    }
  };
  // `connection.rpc.handle` mounts its Fetch route via `owner.webServer`
  // resolved on a shadow context bound to the connection provider's own
  // fiber — for plugin consumers that fiber lacks `webServer` inject, so
  // the call fails with "cannot get property webServer without inject".
  // Register the prefix route on this fiber's own `webServer` instead (the
  // `/dshbot-hook` pattern) and replicate the client-request envelope so
  // `connection.rpc.call('/dsh-whale', endpoint, payload)` works unmodified.
  ctx.inject?.(['connection', 'webServer'], (host) => {
    return host.effect(() => host.webServer.register({
      kind: 'prefix',
      path: '/dsh-whale',
      async handler(req, res) {
        const rejection = host.connection.requestRejection(req);
        if (rejection !== undefined) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
        const endpoint = pathname.startsWith('/dsh-whale/') ? pathname.slice('/dsh-whale/'.length) : '';
        const badEndpoint = !endpoint || endpoint.split('/')
          .some((seg) => !seg || seg === '.' || seg === '..' || !/^[A-Za-z0-9_$.-]+$/.test(seg));
        if (req.method !== 'POST' || badEndpoint) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
          res.writeHead(415);
          res.end('content type must be application/json');
          return;
        }
        const reply = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        const fail = (rpcId, message) => reply(200, {
          type: 'server-response',
          rpcId: typeof rpcId === 'string' ? rpcId : 'invalid',
          result: { ok: false, error: { code: 'dsh-whale/rejected', message, details: {} } },
        });
        let body;
        try {
          body = await readBoundedJson(req, MAX_RPC_BODY_BYTES);
        } catch (error) {
          res.writeHead(error?.status ?? 400);
          res.end(error?.message ?? 'bad request body');
          return;
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || body.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== endpoint) {
          fail(body?.rpcId, `invalid client-request message for ${JSON.stringify(endpoint)}`);
          return;
        }
        try {
          const value = await handle(endpoint, body.payload);
          reply(200, { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } });
        } catch (error) {
          fail(body.rpcId, String(error?.message ?? error));
        }
      },
    }));
  });
}

export function apply(ctx) {
  const scope = createWhaleScope(ctx.settings, WhaleSchema);

  const home = dshHomeDir();
  if (home) {
    ensureWhaleHome(home);
    const preset = ensureWhalePreset(home);
    if (!preset.ok) ctx.logger?.warn?.(`dsh-whale preset ensure failed: ${preset.error}`);
    const snap = scope.get() ?? {};
    if (snap.imDefault) applyImDefault(home, true);
  }

  // Persona resolves from the live catalog per assemble — renaming or
  // re-personalizing lands on the next turn without a preset rewrite.
  ctx.systemPrompt.section({
    name: 'dsh-whale:persona',
    order: 20,
    text: (assembleCtx) => {
      const sessionId = assembleCtx?.agent?.session?.id ?? assembleCtx?.agent?.id ?? '';
      const snap = scope.get() ?? {};
      if (!snap.sessionId || sessionId !== snap.sessionId) return '';
      return buildPersonaText(snap);
    },
  });

  registerRpc(ctx, scope);

  // Create-or-reuse the persistent assistant session once the session
  // services are up, then start the pulse: watches and schedules wake her
  // by queueing a real prompt into that same session.
  ctx.inject?.(['sessionController'], (host) => {
    void ensureAssistantSession(ctx, scope, host.sessionController).catch((error) => {
      ctx.logger?.warn?.(`dsh-whale assistant ensure failed: ${error?.message ?? error}`);
    });
    if (home) {
      startPulse(ctx, {
        home: whaleHomeDir(home),
        getSelfId: () => String(scope.get()?.sessionId ?? ''),
        wake: async (text) => {
          const ensured = await ensureAssistantSession(ctx, scope, host.sessionController);
          if (!ensured.ok || typeof host.sessionController?.prompt !== 'function') return;
          await host.sessionController.prompt({
            requestId: `whale-pulse-${crypto.randomUUID()}`,
            sessionId: ensured.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: trimTo(text, 2000) }],
          }, new AbortController().signal);
        },
        logger: ctx.logger,
      });
    }
  });
}
