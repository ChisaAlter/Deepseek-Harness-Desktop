/** Display labels and toast sentences for global plugin management. */

import type { ManagementError, Registry } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerLocaleKey } from './locales.ts'
import type { FailedAction, ManagerNotice, PackageRow, PackageView, PluginManagerFace } from './manager-store.ts'

/** The translate seat of the manager's dictionary. */
export type Translate = PropsLocale<'pluginManager'>['t']

/** The registries with a name of their own, by host. */
const REGISTRY_COPY = new Map<string, PluginManagerLocaleKey>([
  ['registry.npmmirror.com', 'registryNpmmirror'],
])

/** npm's own registry, which pnpm names without any configuration. */
const OFFICIAL_NPM_HOST = 'registry.npmjs.org'

/**
 * What a registry reads as: pnpm's own as the default registry, a known mirror by its name, any other registry by
 * its host; and the host each names, for where the name alone would leave it unsaid.
 * @param registry - the registry, null for the one pnpm's own configuration names.
 * @param t - the manager's translate seat.
 * @param resolved - the URL pnpm's own configuration names, null while unknown, when it reads as npm's own.
 * @returns the name and the host.
 */
export function registryText(registry: Registry, t: Translate, resolved: string | null): { name: string; host: string } {
  if (registry === null) return { name: t('registryDefault'), host: resolved === null ? OFFICIAL_NPM_HOST : registryHost(resolved) }
  const host = registryHost(registry)
  const key = REGISTRY_COPY.get(host)
  return { name: key === undefined ? host : t(key), host }
}

/** The host of a registry URL; the URL as written when it does not parse. */
function registryHost(registry: string): string {
  try {
    return new URL(registry).host
  } catch {
    // The Host validated its own registries; a remembered one that no longer parses is shown as written.
    return registry
  }
}

/** The sentence each of the Host's refusal codes reads as. */
const CODE_KEYS = {
  'management-required': 'reasonManagementRequired',
  'unaddressable': 'reasonUnaddressable',
  'unknown-plugin': 'reasonUnknownPlugin',
  'invalid-spec': 'reasonInvalidSpec',
  'ambiguous-install': 'reasonAmbiguousInstall',
  'not-bundle': 'reasonNotBundle',
  'not-removable': 'reasonNotRemovable',
  'stop-profile': 'reasonStopProfile',
  'bundle-in-use': 'reasonBundleInUse',
  'stale-approval': 'reasonStaleApproval',
  'operation-error': 'reasonOperationError',
} satisfies Record<ManagementError['code'], PluginManagerLocaleKey>

/** The sentence a failed action opens with, by what was being done. */
const FAILED_KEYS = {
  enable: 'failedEnable',
  disable: 'failedDisable',
  uninstall: 'failedUninstall',
  rowEnable: 'failedRowEnable',
  rowDisable: 'failedRowDisable',
} satisfies Record<FailedAction, PluginManagerLocaleKey>

/**
 * What a management error reads as: the code's sentence, or, for an
 * operation error, the Host's diagnostic as it is.
 * @param error - the Host's code and its diagnostic, when it has one.
 * @param t - the manager's translate seat.
 * @returns the sentence.
 */
export function managementText(error: { readonly code: ManagementError['code']; readonly diagnostic?: string }, t: Translate): string {
  if (error.code !== 'operation-error') return t(CODE_KEYS[error.code])
  return error.diagnostic === undefined || error.diagnostic === '' ? t('reasonOperationError') : error.diagnostic
}

/**
 * Compact a package name to what a person calls it.
 * @param name - the package name.
 * @returns the unscoped name without the harness prefixes.
 */
export function shortName(name: string): string {
  const unscoped = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name
  return unscoped.replace(/^dsh-(?:host-|client-)?/, '')
}

/**
 * Resolve installed package metadata without changing its technical identity.
 * @param pkg - package identity and local metadata.
 * @param resolveText - current-locale package text resolver.
 * @returns localized copy with a technical-name fallback and the independent beta status.
 */
export function packageText(
  pkg: Pick<PackageView, 'name' | 'meta'>, resolveText: PluginManagerFace['resolveText'],
): { title: string; description: string | undefined; beta: boolean } {
  return {
    title: pkg.meta?.title === undefined ? pkg.name : resolveText(pkg.meta.title),
    description: pkg.meta?.description === undefined ? undefined : resolveText(pkg.meta.description) || undefined,
    beta: pkg.name.startsWith('@deepseek-ai/dsh-experimental-'),
  }
}

/**
 * Resolve a bundle row's plugin metadata, using its full module specifier as the final title fallback.
 * @param row - row identity and local metadata.
 * @param resolveText - current-locale package text resolver.
 * @returns the row's display title and optional description.
 */
export function rowText(
  row: Pick<PackageRow, 'moduleName' | 'meta'>, resolveText: PluginManagerFace['resolveText'],
): { title: string; description: string | undefined } {
  return {
    title: row.meta?.title === undefined ? row.moduleName : resolveText(row.meta.title),
    description: row.meta?.description === undefined ? undefined : resolveText(row.meta.description) || undefined,
  }
}

/**
 * The sentence one notice shows.
 * @param notice - the last action's outcome.
 * @param t - the manager's translate seat.
 * @returns the sentence.
 */
export function noticeText(notice: ManagerNotice, t: Translate): string {
  switch (notice.kind) {
    case 'restart': return t('restartNotice')
    case 'overridden': return t('overriddenNotice', { name: notice.packageName })
    case 'cancelled': return t('installCancelled')
    case 'install': return t(({
      done: 'installBackgroundDone', failed: 'installBackgroundFailed',
      unconfirmed: 'installBackgroundUnconfirmed', applying: 'installBackgroundApplying', unknown: 'installBackgroundUnknown',
    } as const)[notice.outcome])
    case 'failed': {
      const reason = notice.code === undefined ? notice.reason : managementText({ code: notice.code, diagnostic: notice.reason }, t)
      return t(FAILED_KEYS[notice.action], { reason: reason === '' ? t('reasonOperationError') : reason })
    }
  }
}
