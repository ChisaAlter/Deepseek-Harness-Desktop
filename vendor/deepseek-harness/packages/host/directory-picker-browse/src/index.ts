/**
 * Browse backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `browse` capability — one-level directory listing and child-directory
 * creation over the host filesystem via Node's stdlib (which already carries
 * the per-OS adaptation). Nothing renders on the host display, so this backend
 * serves remote clients the dialog backend cannot. Policy decisions (hidden
 * entries flagged but returned, symlinks followed, whole-filesystem scope) are
 * recorded in the directory-picker seam Agent Note.
 * @module @deepseek-ai/dsh-host-directory-picker-browse
 */

import { mkdir, opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DirectoryPicker, DirectoryPickerError, WINDOWS_VOLUME_ROOT,
} from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryEntry, DirectoryListing, DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'

export { WINDOWS_VOLUME_ROOT }

/** Letters probed for Win32 drive roots; order is the listing order. */
const DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Per-letter `stat` hang fence. An empty floppy/optical controller can block
 * indefinitely; past this bound the letter is omitted rather than stalling
 * the volume picker.
 */
const DRIVE_PROBE_MS = 300

/**
 * True when `path` is the Win32 volume-picker sentinel, compared with
 * Windows path semantics on every host so a typed wire value cannot miss
 * because POSIX `resolve` would treat the slashes as relative.
 * @param path - candidate list/create parent path.
 * @returns whether `path` names the volume picker.
 */
export function isWindowsVolumeRoot(path: string): boolean {
  return win32.normalize(path).toLowerCase() === win32.normalize(WINDOWS_VOLUME_ROOT).toLowerCase()
}

/**
 * Ancestor chain from the volume picker (Win32) or filesystem root (POSIX)
 * to `target` inclusive — the breadcrumb rows of a listing, every one a jump
 * target.
 * @param target - fully qualified directory that was listed.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns root-to-target crumbs; Win32 prepends {@link WINDOWS_VOLUME_ROOT}.
 */
export function ancestryCrumbs(target: string, platform: NodeJS.Platform = process.platform): DirectoryEntry[] {
  const crumbs: DirectoryEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    // basename of a root is '' — label the root crumb by its full path ('/', 'C:\').
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false })
    if (parent === current) break
    current = parent
  }
  if (platform === 'win32') {
    crumbs.unshift({ name: WINDOWS_VOLUME_ROOT, path: WINDOWS_VOLUME_ROOT, hidden: false })
  }
  return crumbs
}

/** Probe used to decide whether a drive-root path is an enterable directory. */
export type VolumeProbe = (path: string) => Promise<{ isDirectory(): boolean }>

/**
 * List accessible Win32 drive roots by probing `A:\`…`Z:\`. Missing, blocked,
 * or non-directory letters are omitted; a probe that outlives
 * 300ms is skipped. Does not enumerate network neighborhood;
 * a fully qualified UNC path still lists through `list` directly.
 * @param probe - `stat`-compatible directory probe (injectable in tests).
 * @param signal - caller lifetime; abort rejects instead of returning a partial list.
 * @returns accessible drive-root entries in A–Z order; hanging letters omitted.
 */
export async function listWindowsVolumes(
  probe: VolumeProbe,
  signal?: AbortSignal,
): Promise<DirectoryEntry[]> {
  const rows: Array<DirectoryEntry | null> = await Promise.all(Array.from(DRIVE_LETTERS).map(async (letter) => {
    const path = `${letter}:\\`
    const timeout = AbortSignal.timeout(DRIVE_PROBE_MS)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      const info = await raceAbort(probe(path), combined)
      if (!info.isDirectory()) return null
      return { name: `${letter}:`, path, hidden: false }
    } catch {
      if (signal?.aborted) throw asError(signal.reason)
      return null
    }
  }))
  return rows.filter((row): row is DirectoryEntry => row !== null)
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/** One streamed listing candidate: the dirent facts a row needs, nothing else retained. */
export interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
  /** Dirent says directory (no probe needed). */
  isDirectory: boolean
  /** Dirent says symlink (enterability needs an opendir probe). */
  isSymbolicLink: boolean
}

/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting
 * the name-largest candidate when the window exceeds `keep`. Memory over an
 * arbitrarily large level therefore stays O(keep) regardless of how many
 * children the directory holds.
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // Full window, name at or beyond the tail: one comparison rejects, so an
  // oversized level costs O(1) per candidate past the head instead of a
  // window scan (100k children against a 1,001 window must not approach
  // 10^8 comparisons).
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true
  // Binary insertion keeps a retained candidate at O(log keep) comparisons.
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer, and forcing one needs a filesystem torn down mid-request. */
/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether `path` can be opened as a directory. Abort throws the caller's
 * reason; EPERM/EACCES, a broken symlink, and any other open failure mean
 * "not enterable" so the parent listing can omit the row instead of failing.
 * @param path - candidate filesystem path.
 * @param signal - caller lifetime; abort rejects with the abort reason.
 * @returns false when open fails for any reason other than abort.
 */
export async function canOpenDirectory(path: string, signal?: AbortSignal): Promise<boolean> {
  const opening = opendir(path)
  try {
    const dir = await raceAbort(opening, signal)
    try {
      await dir.close()
    } catch {
      /* v8 ignore next -- close of a just-opened probe handle; forcing a failure needs the filesystem torn down mid-request. */
      swallowCloseFailure()
    }
    return true
  } catch {
    void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
      // Open already rejected: nothing to close.
    })
    if (signal?.aborted) throw asError(signal.reason)
    return false
  }
}

/**
 * One listing row for a dirent, following symlinks to directories; null for
 * non-directories, broken/cyclic links, and directories the process cannot
 * open (Windows `System Volume Information` is the usual EPERM case). The
 * browser shows what can be entered; a row that cannot must not be clickable.
 */
async function directoryRow(
  parent: string, name: string, signal: AbortSignal | undefined,
): Promise<DirectoryEntry | null> {
  const path = join(parent, name)
  if (!await canOpenDirectory(path, signal)) return null
  // POSIX hidden convention; Windows' hidden attribute is not exposed by
  // dirents (Known Limitations). The client owns whether hidden rows show.
  return { name, path, hidden: name.startsWith('.') }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}

/** The `ctx.directoryPicker` browse implementation (stable capability object per service life). */
export default class BrowseDirectoryPicker extends DirectoryPicker {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize and put on the wire: at most this many child-directory rows
   * (hidden rows included), with `truncated` flagging a cut level. The
   * default follows GitHub's web UI, which truncates directory listings at
   * 1,000 entries.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
  })

  private readonly browseCapability: DirectoryPickerCapability = {
    kind: 'browse',
    list: (path, signal) => this.list(path, signal),
    createDirectory: (path, name) => this.createDirectory(path, name),
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * The browse interaction capability.
   * @returns the stable `browse` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.browseCapability
  }

  private async list(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const home = homedir()
    if (path !== undefined && isWindowsVolumeRoot(path)) {
      if (process.platform !== 'win32') {
        throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": volume picker is Win32-only`)
      }
      /* v8 ignore start -- Win32-only; `listWindowsVolumes` is covered with an injected probe. */
      const entries = await listWindowsVolumes(stat, signal)
      return {
        path: WINDOWS_VOLUME_ROOT,
        home,
        crumbs: [{ name: WINDOWS_VOLUME_ROOT, path: WINDOWS_VOLUME_ROOT, hidden: false }],
        entries,
        truncated: false,
      }
      /* v8 ignore stop */
    }
    // The seam contract takes fully qualified paths only; resolve() would
    // silently rebase a relative or empty wire value under the host process
    // cwd (or, for rooted drive-less Windows forms, its current drive).
    if (path !== undefined && !fullyQualified(path)) {
      throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path ?? home)
    // Stream the level (opendir, one dirent at a time) into a name-sorted
    // window of maxEntries + 1 candidates: memory stays bounded no matter how
    // many children the directory holds, the window keeps the name-sorted
    // head, and the +1 slot lets an in-window extra row prove the cut. A
    // window candidate that turns out non-enterable (broken symlink, or a
    // directory `opendir` refuses) is not backfilled from beyond the window — an eviction already marks the
    // level truncated, which stays the honest answer.
    const keep = this.config.maxEntries + 1
    const window: ListingCandidate[] = []
    let evicted = false
    try {
      // Every filesystem await races the caller's signal: a stalled
      // opendir/read on a network filesystem must not keep a departed
      // caller's scan alive, and an already-aborted request rejects even
      // when the level is empty.
      const opening = opendir(target)
      const level = await raceAbort(opening, signal).catch((error: unknown) => {
        // The abandoned open can still mint a handle after the abort won;
        // close it so a departed caller cannot leak a descriptor. (A lost
        // race against opendir's own rejection has nothing to close, and
        // the close's own failure is swallowed — the request already
        // returned, so a cleanup error has no consumer.)
        void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
      try {
        for (;;) {
          const dirent = await raceAbort(level.read(), signal)
          if (dirent === null) break
          // Only rows a browser could enter contend for the window; dirent
          // says "directory" outright, a symlink needs the later opendir probe.
          if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
          const candidate = { name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() }
          if (boundedInsert(window, candidate, keep)) evicted = true
        }
      } finally {
        // Manual read() never auto-closes; close on every exit. The aborted
        // exit must not await it — Node queues close behind any in-flight
        // read, so awaiting would chain the departed caller back onto the
        // very stall the abort escaped (the abandoned read's settlement is
        // already swallowed by raceAbort).
        const closing = level.close()
        /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
        if (signal?.aborted) {
          closing.catch(swallowCloseFailure)
        } else {
          await closing
        }
      }
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const detail = code === 'EPERM' || code === 'EACCES' ? 'not permitted' : messageOf(error)
      throw new DirectoryPickerError('directory-unreadable', target, `cannot list ${target}: ${detail}`)
    }
    const entries: DirectoryEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      // A caller that departed between reads and probes stops before the
      // next probe (each probe's own await is raced inside directoryRow).
      signal?.throwIfAborted()
      const row = await directoryRow(target, candidate.name, signal)
      if (row === null) continue
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      entries.push(row)
    }
    return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated }
  }

  private async createDirectory(path: string, name: string): Promise<string> {
    if (isWindowsVolumeRoot(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a filesystem directory`)
    }
    // Same fully-qualified fence as list: never rebase a parent under the
    // cwd or the current drive.
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    const parent = resolve(path)
    // The backend owns segment validation; the Remote controller also refuses
    // invalid wire input, but direct service consumers must hit the same fence.
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new DirectoryPickerError('directory-create-failed', join(parent, name), `"${name}" is not a single path segment`)
    }
    const target = join(parent, name)
    try {
      // Non-recursive: the parent is the directory the browser is showing, so
      // a missing parent is a real failure, not a level to invent.
      await mkdir(target)
      return target
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
      }
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
    }
  }
}
