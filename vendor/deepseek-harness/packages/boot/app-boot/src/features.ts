/**
 * Host-baked feature registry: the stable list of named host capabilities a
 * plugin may require through its `dsh.compatibility.features` declaration.
 *
 * The registry is baked into the host build on purpose — an old host has
 * exactly the features its build lists, so `assertHostFeatures` (and the
 * install-time and module-graph gates that reuse its helpers) decide against
 * the running host's own list, never against a plugin's assumptions. A plugin
 * whose requirements exceed the host fails before it activates: the standalone
 * plugin Node entry imports `assertHostFeatures` from
 * `@deepseek-ai/dsh-app-boot/features`, and a host too old to export that
 * subpath fails the import itself, which is the intended fail-fast.
 *
 * Feature ids are stable public contract: renaming one breaks every plugin
 * that requires it, so additions only ever append.
 * @module @deepseek-ai/dsh-app-boot/features
 */

/** Stable feature ids this dsh host supports (additive only; see the module doc). */
export const HOST_FEATURES = [
  'conversation.chat.user-actions',
  'session.fork.beforeSeq',
  'session.fork.blank',
  'conversation.chat.user-editor',
] as const

/** One supported host feature id. */
export type HostFeature = (typeof HOST_FEATURES)[number]

/** Membership set backing {@link isHostFeature} and {@link missingHostFeatures}. */
const HOST_FEATURE_SET = new Set<string>(HOST_FEATURES)

/**
 * Whether the host supports one feature id.
 * @param feature - the feature id to test.
 * @returns true when the id is in the host-baked registry.
 */
export function isHostFeature(feature: string): boolean {
  return HOST_FEATURE_SET.has(feature)
}

/**
 * Compute which required features the host does not support, in declaration
 * order and deduplicated.
 * @param required - feature ids a plugin requires.
 * @returns the unsupported ids; empty when every requirement is met.
 */
export function missingHostFeatures(required: readonly string[]): string[] {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const feature of required) {
    if (isHostFeature(feature) || seen.has(feature)) continue
    seen.add(feature)
    missing.push(feature)
  }
  return missing
}

/**
 * Parse a plugin's `dsh.compatibility` declaration value (the raw JSON value
 * of the `dsh.compatibility` manifest key) into its required feature ids.
 * Malformed declarations fail loud with the package named, so an install or
 * module-graph gate can fail closed instead of silently ignoring a plugin's
 * requirements.
 * @param packageName - the declaring package, named in parse errors.
 * @param value - the raw `dsh.compatibility` value.
 * @returns the required feature ids (possibly empty); `undefined` when the
 * package declares no compatibility section.
 * @throws when the section is not an object or `features` is not a string array.
 */
export function parseCompatibilityFeatures(packageName: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${packageName}: dsh.compatibility must be an object`)
  }
  const features = (value as Record<string, unknown>).features
  if (features === undefined) return []
  if (!Array.isArray(features) || features.some(feature => typeof feature !== 'string')) {
    throw new Error(`${packageName}: dsh.compatibility.features must be a string array of feature ids`)
  }
  return features as string[]
}

/**
 * Fail-loud host-feature gate: throw when any required feature is not
 * supported by this host. The runtime face of the compatibility contract for
 * external plugins (`import { assertHostFeatures } from
 * '@deepseek-ai/dsh-app-boot/features'`), called from a plugin's Node entry
 * before it applies; hosts without the subpath fail the import itself.
 * @param pluginName - the requiring plugin, named in the error.
 * @param required - feature ids the plugin requires.
 * @throws when one or more required features are not host-supported.
 */
export function assertHostFeatures(pluginName: string, required: readonly string[]): void {
  const missing = missingHostFeatures(required)
  if (missing.length === 0) return
  throw new Error(
    `${pluginName} requires host features this dsh host does not support: ${missing.join(', ')} `
    + '— update dsh to a host that provides them, or remove the plugin',
  )
}
