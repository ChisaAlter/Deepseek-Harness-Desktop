/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-usage-stats`.
 * @module @deepseek-ai/dsh-usage-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-stats'

/** Cordis companion plugin name. */
export const name = 'usage-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns a pure projection fold whose wire
 * payload is schema-validated by the projection registry, and a read-only
 * summary over already-logged sessions. Event relations the fold relies on
 * (usage chunks replaced by the same turn/step's assistant message, user
 * source kind) are owned by dsh-agent-loop and the session surface.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
