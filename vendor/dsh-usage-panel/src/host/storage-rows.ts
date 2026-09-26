// dsh-usage-panel · vendored session storage-row decoder.
//
// Ported from `@deepseek-ai/dsh-session` rc.6 `decodeStorageRecord` — the
// lossless row→events expansion the repair path needs. The desktop-vendored
// pin (0.1.7-rc.2) REMOVED that export (decode moved behind the persistence
// format catalog), and the plugin's own `^0.1.0-rc.6` spec can resolve to a
// build whose transitive `@deepseek-ai/dsh-llm` no longer exports `CallId` —
// either mix breaks `import('@deepseek-ai/dsh-session')` before a single row
// is decoded. Storage rows are append-only history: the grammar a file was
// written with never changes retroactively, so a pinned decoder is the
// correct boundary — the runtime package surface is not (see AGENTS §6.5).
//
// Row grammar (immutable for all logs this repair can meet):
//   plain event  — one JSONL line, passed through verbatim
//   packed run   — {type:'text-chunks'|'reasoning-chunks'|'tool-call-chunks',
//                   seq0, time0, data:{turn,step,index,dt[], texts[]|args[]}}
// A `-chunks` tag outside the known three means a NEWER packing generation:
// abort rather than renumber a row we cannot expand (it would corrupt the
// file further instead of repairing it).

interface StorageRowData {
  turn: number
  step: number
  index: number
  dt: number[]
  texts?: string[]
  args?: string[]
  id?: string
  name?: string
}

interface PackedRow {
  type: string
  seq0: number
  time0: number
  data: StorageRowData
}

type ChunkTag = 'text-chunks' | 'reasoning-chunks' | 'tool-call-chunks'

const CHUNK_TAGS = new Set<string>(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Exact-key check: `value` has every key in `keys` and nothing else. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k))
}

/** Throw the uniform malformed-row diagnostic. */
function malformed(tag: string, why: string): never {
  throw new Error(`malformed ${tag} storage row: ${why}`)
}

/** Validate the shared run-data fields and the payload/dt arity; returns the member payload. */
function validateRunData(tag: ChunkTag, data: Record<string, unknown>, payloadKey: 'texts' | 'args'): string[] {
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
    malformed(tag, 'turn/step/index must be numbers')
  }
  const payload = data[payloadKey]
  if (!Array.isArray(payload) || payload.length === 0 || payload.some((entry) => typeof entry !== 'string')) {
    malformed(tag, `${payloadKey} must be a non-empty string array`)
  }
  const dt = data.dt
  if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) {
    malformed(tag, 'dt must be an array of safe integers')
  }
  if (dt.length !== (payload as string[]).length - 1) {
    malformed(tag, `dt length ${dt.length} does not match ${(payload as string[]).length} members`)
  }
  return payload as string[]
}

/** Validate a row-tagged parsed value's envelope and data, throwing on any malformation. */
function validateRow(value: Record<string, unknown>, tag: ChunkTag): PackedRow {
  if (!hasExactKeys(value, ['type', 'seq0', 'time0', 'data'])) {
    malformed(tag, 'envelope must be exactly {type, seq0, time0, data}')
  }
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0) malformed(tag, 'seq0 must be a non-negative safe integer')
  if (!Number.isSafeInteger(value.time0)) malformed(tag, 'time0 must be a safe integer')
  const data = value.data
  if (!isRecord(data)) malformed(tag, 'data must be an object')
  let payload: string[]
  if (tag === 'tool-call-chunks') {
    const withName = hasExactKeys(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args'])
    if (!withName && !hasExactKeys(data, ['turn', 'step', 'index', 'id', 'dt', 'args'])) {
      malformed(tag, 'data must be exactly {turn, step, index, id, name?, dt, args}')
    }
    if (typeof data.id !== 'string' || (withName && typeof data.name !== 'string')) {
      malformed(tag, 'id (and name when present) must be strings')
    }
    payload = validateRunData(tag, data, 'args')
  } else {
    if (!hasExactKeys(data, ['turn', 'step', 'index', 'dt', 'texts'])) {
      malformed(tag, 'data must be exactly {turn, step, index, dt, texts}')
    }
    payload = validateRunData(tag, data, 'texts')
  }
  if (!Number.isSafeInteger((value.seq0 as number) + payload.length - 1)) malformed(tag, 'member seqs must stay safe integers')
  let time = value.time0 as number
  for (const gap of data.dt as number[]) {
    time += gap
    if (!Number.isSafeInteger(time)) malformed(tag, 'member times must stay safe integers')
  }
  return value as unknown as PackedRow
}

/** Expand a validated row back into its exact original events, in order. */
function expandRow(row: PackedRow): Record<string, unknown>[] {
  const members = row.type === 'tool-call-chunks' ? row.data.args! : row.data.texts!
  const events: Record<string, unknown>[] = []
  let time = row.time0
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += row.data.dt[k - 1]!
    let chunk: Record<string, unknown>
    switch (row.type) {
      case 'text-chunks':
        chunk = { type: 'text-delta', index: row.data.index, text: members[k] }
        break
      case 'reasoning-chunks':
        chunk = { type: 'reasoning-delta', index: row.data.index, text: members[k] }
        break
      case 'tool-call-chunks':
        chunk = {
          type: 'tool-call-delta',
          index: row.data.index,
          id: row.data.id,
          ...(Object.hasOwn(row.data, 'name') ? { name: row.data.name } : {}),
          argumentsDelta: members[k],
        }
        break
      default:
        // validateRow only admits the three known tags; unreachable by contract.
        throw new Error(`unreachable chunk row tag: ${row.type}`)
    }
    events.push({
      type: 'assistant/chunk',
      seq: row.seq0 + k,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    })
  }
  return events
}

/**
 * Decode one parsed JSONL line value into the session event(s) it stores.
 * Chunk-row-tagged values validate and expand (a malformed row throws — it is
 * corrupt storage, and treating it as an event would silently drop a whole
 * run); every other value passes through as a single event, unvalidated.
 * An unrecognised `-chunks` tag means a newer packing generation: throw so the
 * repair aborts instead of rewriting a row it cannot expand.
 */
export function decodeStorageRecord(value: unknown): unknown[] {
  if (!isRecord(value)) return [value]
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
    if (typeof tag === 'string' && CHUNK_TAGS.has(tag) === false && tag.endsWith('-chunks')) {
      throw new Error(`unrecognised packed storage row tag: ${tag}`)
    }
    return [value]
  }
  return expandRow(validateRow(value, tag as ChunkTag))
}
