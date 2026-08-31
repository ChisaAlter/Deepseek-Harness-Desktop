/**
 * Host directory-picking Remote owner: capability gating, cancellation, and the
 * stable wire failure vocabulary over the `ctx.directoryPicker` seam.
 */

import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapabilities } from '@deepseek-ai/dsh-host-directory-picker'
// The seam owns the listing declaration; the generator requires the reference
// site to name that package rather than this package's re-export of it.
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DirectoryPickerErrorDetailsMap } from './types.ts'

const createDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  request => request.name.trim() !== '' && request.name !== '.' && request.name !== '..'
    && !/[/\\]/.test(request.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host directory-picking Remote namespace owner. */
    directoryPickerController: DirectoryPickerController
  }
}

/**
 * Host service backing the generated `ctx.remote.directoryPicker` namespace. The
 * seam it exports is abstract and therefore never a Loader entry of its own, so
 * this controller carries the wire verbs: one composed backend serves either the
 * native chooser or the browse primitives, and a verb the composition cannot
 * serve is refused rather than approximated.
 */
export class DirectoryPickerController extends TypertRemoteService {
  static inject = ['directoryPicker']

  /** @param ctx - Host context carrying the composed directory-picking backend. */
  constructor(ctx: Context) {
    super(ctx, 'directoryPickerController', { namespace: 'directoryPicker' })
  }

  /**
   * Open the host's OS chooser for a Remote caller.
   * @param signal - caller lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  @Remote('pick')
  async pick(signal: AbortSignal): Promise<string | null> {
    const capability = this.requireCapability('native', 'pick')
    try {
      return await capability.pick(signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'directory picker was aborted', 'directory picker failed')
    }
  }

  /**
   * List one directory level for a Remote caller's in-app browser.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the backend's scan instead of
   *   letting it outlive a disconnected caller.
   * @returns the level's listing with its ancestry.
   */
  @Remote('list')
  async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing> {
    const capability = this.requireCapability('browse', 'list')
    try {
      return await capability.list(path, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'directory listing was aborted')
    }
  }

  /**
   * Create one child directory for a Remote caller's in-app browser.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  @Remote('createDirectory')
  async createDirectory(path: string, name: string): Promise<string> {
    const request = createDirectoryRequestSchema.safeParse({ path, name })
    if (!request.success) {
      throw pickerFailureOf(
        'bad-request',
        'invalid payload for host.createDirectory',
        { issues: request.error.issues },
      )
    }
    const capability = this.requireCapability('browse', 'createDirectory')
    try {
      return await capability.createDirectory(request.data.path, request.data.name)
    } catch (error: unknown) {
      throw browseFailure(error)
    }
  }

  /** Resolve the capability one wire verb needs, or refuse with the kind this backend serves. */
  private requireCapability<Kind extends keyof DirectoryPickerCapabilities>(
    kind: Kind,
    method: string,
  ): DirectoryPickerCapabilities[Kind] {
    const capability = this.ctx.directoryPicker.capability()
    if (capability.kind !== kind) {
      throw pickerFailureOf(
        'directory-picker-unavailable',
        `directoryPicker.${method} needs the ${kind} capability; the composed picker serves "${capability.kind}"`,
        { capability: capability.kind },
      )
    }
    return capability as DirectoryPickerCapabilities[Kind]
  }
}

/**
 * Raise one entry of the picking wire failure vocabulary.
 * @param code - the failure code a caller discriminates on.
 * @param message - operator-facing description.
 * @param details - the payload this code carries.
 * @returns the failure to throw across the Remote boundary.
 */
function pickerFailureOf<Code extends keyof DirectoryPickerErrorDetailsMap>(
  code: Code,
  message: string,
  details: DirectoryPickerErrorDetailsMap[Code],
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/**
 * Classify a browse-primitive rejection: the seam's own closed codes carry the
 * path they are about, and anything else stays an infrastructure failure.
 * @param error - the primitive's rejection.
 * @returns the failure to throw across the Remote boundary.
 */
function browseFailure(error: unknown): TypertRemoteFailure {
  if (error instanceof DirectoryPickerError) {
    return pickerFailureOf(error.code, error.message, { path: error.path })
  }
  return pickerFailureOf('internal', errorMessage(error), {})
}

/**
 * Classify a cancellable primitive's rejection. An abort is the caller's own
 * timeout or disconnect, not a backend failure, so it answers `cancelled`
 * before the business classification runs.
 * @param error - the primitive's rejection.
 * @param signal - the caller lifetime the primitive ran under.
 * @param cancelled - operator-facing text for the abort outcome.
 * @param failed - prefix for a non-seam failure, when the verb has no closed codes.
 * @returns the failure to throw across the Remote boundary.
 */
function cancellableFailure(
  error: unknown,
  signal: AbortSignal,
  cancelled: string,
  failed?: string,
): TypertRemoteFailure {
  if (signal.aborted) return pickerFailureOf('cancelled', cancelled, {})
  if (failed === undefined) return browseFailure(error)
  return pickerFailureOf('internal', `${failed}: ${errorMessage(error)}`, {})
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
