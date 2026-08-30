/**
 * Browser-facing subagent control assembly: the catalog view sampled against
 * the live Agent registry, one browser zone's validation, and the stable
 * failure codes the Remote surface answers with.
 *
 * @module @deepseek-ai/dsh-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  SubagentCatalog, SubagentControlErrorDetailsMap, SubagentListEntry,
} from './control-types.ts'
import { SubagentError } from './error.ts'

/** Strict browser-zone profile: UTC or an IANA Area/Location-style identifier. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

const SESSION_ID_SCHEMA = z.string().min(1)
const CONTROL_ID_SCHEMAS = {
  'subagent.list': z.object({ parentSessionId: SESSION_ID_SCHEMA }),
  'subagent.prompt': z.object({
    parentSessionId: SESSION_ID_SCHEMA,
    childSessionId: SESSION_ID_SCHEMA,
    mode: z.literal('continuable'),
  }),
  'subagent.interrupt': z.object({
    parentSessionId: SESSION_ID_SCHEMA,
    childSessionId: SESSION_ID_SCHEMA,
    mode: z.literal('continuable'),
  }),
} as const

/**
 * Validate and canonicalize one browser-supplied IANA zone at the wire boundary.
 * @param value - the browser's reported zone name.
 * @returns the canonical zone, or `undefined` when the name is unusable.
 */
export function canonicalClientTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions().timeZone
    /* v8 ignore next -- Intl returns UTC or a canonical IANA Area/Location for accepted input. */
    if (canonical !== 'UTC' && !IANA_TIME_ZONE.test(canonical)) return undefined
    return canonical
  } catch {
    // Intl rejects unsupported zone names; the caller maps that parser rejection.
    return undefined
  }
}

/**
 * Refuse one Remote call with a stable business failure the carrier preserves.
 * @param code - declared caller-facing code.
 * @param message - human-readable refusal.
 * @param details - that code's declared detail payload.
 * @returns Never — the failure is thrown.
 * @throws {TypertRemoteFailure} always.
 */
export function rejectControl<Code extends keyof SubagentControlErrorDetailsMap>(
  code: Code,
  message: string,
  details: SubagentControlErrorDetailsMap[Code],
): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * Apply the subagent payload checks that are stricter than generated
 * branded-string codecs.
 * @param method - method name carried in the failure message.
 * @param payload - decoded control fields to validate.
 * @throws {TypertRemoteFailure} `bad-request` with the original Zod issues.
 */
export function validateControlRequest(
  method: keyof typeof CONTROL_ID_SCHEMAS,
  payload: unknown,
): void {
  const parsed = CONTROL_ID_SCHEMAS[method].safeParse(payload)
  if (!parsed.success) {
    return rejectControl('bad-request', `invalid payload for ${method}`, {
      issues: parsed.error.issues,
    })
  }
}

/**
 * Project one durable listing onto the catalog view, replacing each row's
 * store-derived activity with the live Agent driver's status and reporting
 * whether the exact parent Agent is live. Without an Agent registry no driver
 * runs at all, so every row is inactive and the parent is unavailable.
 * @param ctx - Host context that may carry the Agent registry.
 * @param parentSessionId - the listed parent.
 * @param entries - the durable direct-child listing.
 * @returns the catalog view answered to one browser.
 */
export function catalogView(
  ctx: Context,
  parentSessionId: SessionId,
  entries: readonly SubagentListEntry[],
): SubagentCatalog {
  const agents = ctx.get('agents')
  return {
    entries: entries.map((entry): SubagentListEntry => entry.kind === 'child'
      ? { ...entry, activity: agents?.get(entry.id)?.status === 'running' ? 'running' : 'inactive' }
      : entry),
    parentAvailable: agents?.get(parentSessionId) !== undefined,
  }
}

/**
 * Refuse one catalog read while preserving cancellation and a missing
 * projections registry as distinct failures.
 * @param error - the thrown value.
 * @param signal - the caller's cancellation.
 * @returns Never — the refusal is thrown.
 * @throws {TypertRemoteFailure} always.
 */
export function rejectCatalogRead(error: unknown, signal: AbortSignal): never {
  if (isCancellation(error, signal)) {
    return rejectControl('cancelled', 'subagent catalog read was cancelled', {})
  }
  if (error instanceof SubagentError && error.code === 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE') {
    return rejectControl(
      'subagent-projections-unavailable',
      'subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
      {},
    )
  }
  return rejectControl('internal', 'subagent catalog read failed', {})
}

/**
 * Refuse one continuation prompt without exposing provider detail: admission
 * failures the caller can act on keep their own code, everything else is
 * internal.
 * @param error - the thrown value.
 * @param childSessionId - the addressed child.
 * @param signal - the caller's cancellation.
 * @returns Never — the refusal is thrown.
 * @throws {TypertRemoteFailure} always.
 */
export function rejectPrompt(error: unknown, childSessionId: SessionId, signal: AbortSignal): never {
  if (isCancellation(error, signal)) {
    return rejectControl('cancelled', 'subagent prompt was cancelled', {})
  }
  if (error instanceof SubagentError) {
    switch (error.code) {
      case 'NOT_RESUMABLE':
        return rejectControl('subagent-not-resumable', 'subagent cannot be resumed', { childSessionId })
      case 'UNAUTHORIZED':
        return rejectControl(
          'subagent-unauthorized',
          'subagent does not belong to this parent',
          { childSessionId },
        )
      case 'DRAINING':
      case 'ACTIVATION_CLOSING':
      case 'CONTINUATION_UNAVAILABLE':
      case 'PERSISTENCE_UNAVAILABLE':
        return rejectControl(
          'subagent-delivery-unavailable',
          'subagent follow-up is temporarily unavailable',
          { childSessionId },
        )
      // A code outside the admission vocabulary is not the caller's move to make.
      default:
        break
    }
  }
  return rejectControl('internal', 'subagent prompt failed', {})
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof SubagentError && error.code === 'CANCELLED')
}
