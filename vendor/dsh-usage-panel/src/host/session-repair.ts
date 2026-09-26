// dsh-usage-panel · damaged session-log repair (desktop-vendored feature).
//
// Two refusal classes land a session on the scan's failed list:
//
// 1. Corruption in the CURRENT format (v4): a duplicated event batch, a seq
//    gap, or a torn tail. Repair decodes ALL storage rows — packed chunk runs
//    included — via the vendored `decodeStorageRecord` in `./storage-rows.ts`,
//    renumbers every event seq to a 0-based continuous index (content
//    preserved, order preserved), and rewrites the zstd container atomically.
//    The backend reads layout-blind, so plain rows remove any packer-version
//    compatibility risk for the reader.
//
// 2. A HISTORICAL format v3 the current build only serves through its
//    migration pipeline: the pipeline hard-refuses event types unknown to the
//    frozen released vocabulary unless they are `ignorable` (the mechanism
//    plugin-owned events are supposed to use). Repair then rewrites rows
//    VERBATIM except for `ignorable: true` on non-released event envelopes —
//    no decode, no renumber (migration remaps seqs positionally; rewriting
//    them could break `sourceEventSeqs`/`surfaceOp` references). The source
//    stays its own version; the backend migrates on read and publishes the
//    upgraded generation itself on the next write.
//
// Both paths keep a timestamped backup of the original first and abort
// without writing on any decode/serialize failure. They never touch a
// healthy log: callers pass ONLY the session id the framework reported as
// failed. A NEWER format version is refused outright — rewriting a foreign
// envelope under this build's assumptions would falsify the artifact.
//
// The decoder is vendored, not imported from `@deepseek-ai/dsh-session`: the
// desktop pin removed that export and a mixed node_modules tree resolves a
// build whose transitive `@deepseek-ai/dsh-llm` lacks `CallId` — either mix
// fails the repair before a row is decoded (AGENTS §6.5 class of pin drift).
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { compressZstdFrame, decompressZstdFrame, scanZstdFrames } from './zstd-frames.ts'

export { decodeStorageRecord } from './storage-rows.ts'

export type StorageRowDecoder = (value: unknown) => SessionEventLike[]

interface SessionEventLike {
  type: string
  [key: string]: unknown
}

/** Where this build keeps the harness home (desktop sets DSH_HOME explicitly). */
export function resolveDshHome(): string {
  const env = process.env.DSH_HOME
  if (env !== undefined && env.trim() !== '') return resolve(env.trim())
  return join(homedir(), '.dsh')
}

/** Repair is limited to ids reported by this scan, never arbitrary RPC input. */
export function isRepairableSessionId(sessionId: unknown, failedSessionIds: readonly string[]): sessionId is string {
  return typeof sessionId === 'string' &&
    sessionId !== '' && sessionId !== '.' && sessionId !== '..' &&
    !/[\x00/\\]/u.test(sessionId) && failedSessionIds.includes(sessionId)
}

// Canonical generation filenames, mirroring the backend grammar
// (`parseGenerationLogFilename`): v0 keeps `session.jsonl`, later generations
// carry `.vN` (N ≥ 1, no leading zeros); `.zstd` marks the compressed
// encoding. Backups (`*.bak-*`) and temps (`*.tmp`) never match.
const CANONICAL_ZSTD_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$/u
const CANONICAL_PLAIN_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u

function generationVersion(name: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(name)
  if (match === null) return undefined
  return match[1] === undefined ? 0 : Number(match[1])
}

/**
 * Locate a session's artifact beneath `<home>/sessions`: dirs are
 * `<project>/<encoded-session-id>` and the file is the HIGHEST canonical
 * generation the backend would read (`session.vN.jsonl.zstd`, with v0's
 * `session.jsonl.zstd` as the unversioned name) — never an obsolete earlier
 * generation left behind by a format migration. Compressed candidates win
 * over uncompressed ones; the uncompressed set is only a graceful fallback
 * (the rebuild rejects it later). The exact persisted id is preferred; old
 * callers that supply a bare UUID may still resolve a `session-` directory.
 */
export async function locateSessionArtifact(home: string, sessionId: string): Promise<string | null> {
  const sessionsRoot = join(home, 'sessions')
  let projects: string[] = []
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return null
  }
  const needles = sessionId.startsWith('session-') ? [sessionId] : [sessionId, 'session-' + sessionId]
  for (const needle of needles) for (const project of projects) {
    const projectDir = join(sessionsRoot, project)
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name !== needle) continue
      const sessionDir = join(projectDir, entry.name)
      let files: import('node:fs').Dirent[] = []
      try {
        files = await readdir(sessionDir, { withFileTypes: true })
      } catch {
        return null
      }
      let best: { path: string; version: number; compressed: boolean } | undefined
      for (const file of files) {
        if (!file.isFile()) continue
        const compressedVersion = generationVersion(file.name, CANONICAL_ZSTD_NAME)
        const version = compressedVersion ?? generationVersion(file.name, CANONICAL_PLAIN_NAME)
        if (version === undefined) continue
        const compressed = compressedVersion !== undefined
        if (
          best === undefined ||
          (compressed && !best.compressed) ||
          (compressed === best.compressed && version > best.version)
        ) {
          best = { path: join(sessionDir, file.name), version, compressed }
        }
      }
      return best?.path ?? null
    }
  }
  return null
}

export interface RebuildResult {
  events: number
  rebuilt: Buffer
  header: string
}

/** Format version this build's backend reads natively (mirrors the pin). */
const SESSION_FORMAT_VERSION = 4

/**
 * Frozen released-v3 event vocabulary, mirrored verbatim from the vendored
 * migration (`session-format-v3-to-v4/src/extension-identities.ts`). A
 * historical event whose type is absent here must carry `ignorable: true`
 * for the migration pipeline to admit it as a `plugin:`-namespaced opaque
 * event; without the flag the whole session is refused before a byte is
 * migrated.
 */
const RELEASED_V3_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked',
  'approval/decided', 'approval/policy', 'assistant/attempt',
  'assistant/message', 'command/done', 'command/run', 'compaction/end',
  'compaction/prune', 'compaction/start', 'compaction/summary',
  'deliverables/presented', 'feedback/message-delete', 'feedback/message-put',
  'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
  'image/offload', 'llm/retry', 'llm/retry-started', 'model/selection',
  'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
  'session/end-seed', 'session/title', 'session/title-llm-request',
  'step/end', 'step/start', 'subagent/catalog', 'subagent/descriptor',
  'subagent/model-selection-policy', 'system/message', 'team/member',
  'team/message/delivered', 'team/message/queued', 'team/task', 'todo/write',
  'tool-workflow/agent-end', 'tool-workflow/agent-start',
  'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call',
  'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/result', 'turn/end',
  'turn/start', 'user/message', 'web/deepseek-search-llm-request',
  'workspace/changes',
])

/**
 * Header line → declared format version. Mirrors the backend's admission:
 * only a numeric version means anything; a missing/misshaped field is read
 * as the current format (the catalog rejects a bogus header downstream).
 */
function headerVersion(header: string): number | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(header)
  } catch {
    throw new Error('corrupt session log: header line is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('corrupt session log: first line is not a session header')
  }
  const version = (parsed as { version?: unknown }).version
  return typeof version === 'number' ? version : undefined
}

/**
 * Rewrite a v3 body: event envelopes (a `seq`+`type` pair — packed
 * `*-chunks` rows carry `seq0` instead and stay byte-identical) whose type
 * the frozen released vocabulary does not know get `ignorable: true`, which
 * is the migration pipeline's own contract for plugin-owned events.
 * Everything else — seqs, packed rows, ordering — is preserved verbatim.
 */
function admitV3Lines(bodyLines: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]!
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      throw new Error('unparsable committed event at line ' + (i + 2))
    }
    const record = row as SessionEventLike
    if (
      typeof record === 'object' && record !== null && !Array.isArray(record)
      && typeof record.type === 'string' && typeof record.seq === 'number'
      && !RELEASED_V3_EVENT_TYPES.has(record.type) && record['ignorable'] !== true
    ) {
      record.ignorable = true
      out.push(JSON.stringify(record))
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * Rebuild a full artifact into a plaintext+buffer pair. A v3 artifact takes
 * the admission rewrite in {@link admitV3Lines}; anything else the
 * backend reads natively decodes every line through `decode` (packed rows
 * expand),
 * renumbers seqs 0-based continuously, and writes ONE PLAIN EVENT PER LINE.
 * The header line is preserved verbatim (format version + identity).
 */
export async function rebuildSessionLog(
  bytes: Buffer,
  decode: (value: unknown) => unknown[],
): Promise<RebuildResult> {
  const { frames, tornStart } = scanZstdFrames(bytes)
  if (frames.length === 0) {
    throw new Error('no complete zstd frames' + (tornStart !== undefined ? ' (torn tail ' + tornStart + ')' : ''))
  }
  const parts: Buffer[] = []
  for (const frame of frames) parts.push(await decompressZstdFrame(bytes.subarray(frame.start, frame.end)))
  const plain = Buffer.concat(parts).toString('utf8')
  const lines = plain.split('\n')
  const header = lines[0] ?? ''
  if (header.trim() === '') throw new Error('empty or header-less session log')
  const version = headerVersion(header)
  if (version !== undefined && version > SESSION_FORMAT_VERSION) {
    throw new Error(`session log format v${version} is newer than the supported v${SESSION_FORMAT_VERSION}`)
  }
  // Torn-tail semantics, mirroring the backend scanner: a final record without
  // a trailing newline is an interrupted write and is dropped (the prefix is
  // the committed region). Only NEWLINE-terminated lines are records.
  let bodyLines = lines.slice(1)
  if (!plain.endsWith('\n') && bodyLines.length > 0) {
    bodyLines = bodyLines.slice(0, -1)
  }
  if (version === 3) {
    const admitted = admitV3Lines(bodyLines)
    if (admitted.length === 0) throw new Error('no events found in session log')
    const rebuilt = Buffer.concat([
      await compressZstdFrame(header + '\n'),
      await compressZstdFrame(admitted.join('\n') + '\n'),
    ])
    return { events: admitted.length, rebuilt, header }
  }
  const events: unknown[] = []
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]!
    if (line.trim() === '') continue
    let decoded: unknown
    try {
      decoded = decode(JSON.parse(line))
    } catch {
      throw new Error('unparsable committed event at line ' + (i + 2))
    }
    if (!Array.isArray(decoded)) throw new Error('malformed storage row at line ' + (i + 2))
    for (const event of decoded) {
      const shaped = event as SessionEventLike
      shaped.seq = events.length
      events.push(shaped)
    }
  }
  if (events.length === 0) throw new Error('no events found in session log')
  const headerText = header + '\n'
  const bodyText = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  const rebuilt = Buffer.concat([await compressZstdFrame(headerText), await compressZstdFrame(bodyText)])
  return { events: events.length, rebuilt, header }
}

export interface RepairOutcome {
  repaired: number
  backup: string
  bytesBefore: number
  bytesAfter: number
}

/**
 * Repair one damaged session artifact: read → decode all rows → renumber →
 * plain-event rewrite → backup (timestamped copy) → atomic temp+rename
 * replace. Aborts without writing on ANY decode/serialize failure.
 */
export async function repairSessionLog(
  home: string,
  sessionId: string,
  decode: (value: unknown) => unknown[],
): Promise<RepairOutcome> {
  const artifact = await locateSessionArtifact(home, sessionId)
  if (artifact === null) {
    throw new Error('session artifact not found under ' + join(home, 'sessions'))
  }
  const bytes = await readFile(artifact)
  const rebuilt = await rebuildSessionLog(bytes, decode)
  if (rebuilt.events === 0) throw new Error('nothing to repair')
  const backup = artifact + '.bak-' + Date.now()
  await writeFile(backup, bytes)
  const tmp = artifact + '.tmp'
  await writeFile(tmp, rebuilt.rebuilt)
  await rename(tmp, artifact)
  return {
    repaired: rebuilt.events,
    backup,
    bytesBefore: bytes.length,
    bytesAfter: rebuilt.rebuilt.length,
  }
}
