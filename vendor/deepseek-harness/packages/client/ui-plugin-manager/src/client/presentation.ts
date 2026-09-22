/** Display labels and toast sentences for global plugin management. */

import type { ManagementError } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerLocaleKey } from './locales.ts'
import type { FailedAction, ManagerNotice, PackageView } from './manager-store.ts'

/** The translate seat of the manager's dictionary. */
export type Translate = PropsLocale<'pluginManager'>['t']

/** The official packages with copy of their own, and whether each is a beta feature the page tags as such. */
const BUILTIN_COPY = new Map<string, { title: PluginManagerLocaleKey; description: PluginManagerLocaleKey; beta: boolean }>([
  ['@deepseek-ai/dsh-experimental-agent-team-profile', {
    title: 'builtinAgentTeamTitle', description: 'builtinAgentTeamDescription', beta: true,
  }],
  ['@deepseek-ai/dsh-experimental-agent-team-web-profile', {
    title: 'builtinAgentTeamWebTitle', description: 'builtinAgentTeamWebDescription', beta: true,
  }],
  ['@deepseek-ai/dsh-experimental-auto-review', {
    title: 'builtinAutoReviewTitle', description: 'builtinAutoReviewDescription', beta: true,
  }],
])

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
 * Localize known official packages by exact npm name at render time.
 * @param pkg - original package identity and optional metadata description.
 * @param t - the manager's current translate function.
 * @returns localized copy and whether the package is a beta feature, or the package's short name and original description.
 */
export function packageText(
  pkg: Pick<PackageView, 'name' | 'description'>, t: Translate,
): { title: string; description: string | undefined; beta: boolean } {
  const keys = BUILTIN_COPY.get(pkg.name)
  return keys === undefined
    ? { title: shortName(pkg.name), description: pkg.description, beta: false }
    : { title: t(keys.title), description: t(keys.description), beta: keys.beta }
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
    case 'failed': {
      const reason = notice.code === undefined ? notice.reason : managementText({ code: notice.code, diagnostic: notice.reason }, t)
      return t(FAILED_KEYS[notice.action], { reason: reason === '' ? t('reasonOperationError') : reason })
    }
  }
}
