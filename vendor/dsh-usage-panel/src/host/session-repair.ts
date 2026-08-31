// dsh-usage-panel · damaged session-log repair (desktop-vendored feature).
//
// A corrupted artifact (e.g. a duplicated event batch causing "seq gap in
// committed region") blocks ONE session from every read. This module decodes
// ALL storage rows — packed chunk runs included — via the runtime's own
// `decodeStorageRecord`, renumbers every event seq to a 0-based continuous
// index (content preserved, order preserved), re-packs chunk runs, and
// rewrites the zstd container (header frame + event frame) atomically,
// keeping a timestamped backup of the original first. It never touches a
// healthy log: callers pass ONLY the session id the framework reported as
// failed, and any decode failure aborts without writing.
//
// Runtime coupling is deliberately dynamic: both `decodeStorageRecord` and
// Node's DSH bundles live in the desktop harness, so the standalone npm
// package loads fine and the repair fails gracefully where unavailable.
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type * as SessionModule from '@deepseek-ai/dsh-session'
import { compressZstdFrame, decompressZstdFrame, scanZstdFrames } from './zstd-frames.ts'

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

/**
 * Locate a session's artifact beneath `<home>/sessions`: dirs are
 * `<project>/<encoded-session-id>` and the file is `session.jsonl.zstd`
 * (or an uncompressed `session.jsonl`). The id may arrive either as the
 * full `session-<uuid>` (coverage failed-ids) or the bare uuid.
 */
export async function locateSessionArtifact(home: string, sessionId: string): Promise<string | null> {
  const needle = sessionId.startsWith('session-') ? sessionId : 'session-' + sessionId
  const sessionsRoot = join(home, 'sessions')
  let projects: string[] = []
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return null
  }
  for (const project of projects) {
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
      const zstd = join(sessionDir, 'session.jsonl.zstd')
      const plain = join(sessionDir, 'session.jsonl')
      if (await exists(zstd)) return zstd
      if (await exists(plain)) return plain
      return null
    }
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export interface RebuildResult {
  events: number
  rebuilt: Buffer
  header: string
}

/**
 * Decode a full artifact into a rebuilt plaintext+buffer pair: every line is
 * decoded through `decode` (packed rows expand), seqs renumber 0-based
 * continuously, and the body is written as ONE PLAIN EVENT PER LINE. The
 * backend reads layout-blind (packed / unpacked / mixed load identically), so
 * plain rows remove any packer-version compatibility risk for the reader.
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
  // Torn-tail semantics, mirroring the backend scanner: a final record without
  // a trailing newline is an interrupted write and is dropped (the prefix is
  // the committed region). Only NEWLINE-terminated lines are records.
  let bodyLines = lines.slice(1)
  if (!plain.endsWith('\n') && bodyLines.length > 0) {
    bodyLines = bodyLines.slice(0, -1)
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

/** Production codec: the harness's own lossless storage-row decoder. */
export async function runtimeCodec(): Promise<{
  decode: (value: unknown) => unknown[]
}> {
  const mod = (await import('@deepseek-ai/dsh-session')) as typeof SessionModule
  return {
    decode: (value: unknown) => mod.decodeStorageRecord(value) as unknown[],
  }
}
