/**
 * Branch picker pure logic: local names from remote refs, hide origin
 * rows that already have a local match, and keep the create-branch row
 * visible while filtering.
 * @module @deepseek-ai/dsh-client-ui-git/client/branches
 */

/** One ref row the picker lists. */
export interface BranchRef {
  /** Short display name, e.g. `main` or `origin/main`. */
  name: string
  /** True for refs/remotes/* rows. */
  isRemote: boolean
  /** True on the checked-out branch. */
  isCurrent: boolean
  /** Remote name for remote rows (`origin`); absent for local rows. */
  remoteName?: string
  /** True on the origin/HEAD target when known. */
  isDefault?: boolean
  /**
   * `false` when the desktop switch IPC would reject this name (its
   * injection whitelist is narrower than git's own ref rules); the picker
   * disables such rows. Absent means switchable.
   */
  switchable?: boolean
}

/**
 * Strip the remote prefix from a remote ref such as `origin/feature/demo`.
 * @param branchName - ref short name.
 * @returns the local branch name the ref would check out as.
 */
export function deriveLocalBranchNameFromRemoteRef(branchName: string): string {
  const firstSeparatorIndex = branchName.indexOf('/')
  if (firstSeparatorIndex <= 0 || firstSeparatorIndex === branchName.length - 1) {
    return branchName
  }
  return branchName.slice(firstSeparatorIndex + 1)
}

function localNameCandidates(branchName: string, remoteName?: string): string[] {
  const candidates = new Set<string>()
  const firstSlash = deriveLocalBranchNameFromRemoteRef(branchName)
  if (firstSlash.length > 0) candidates.add(firstSlash)
  if (remoteName !== undefined) {
    const prefix = `${remoteName}/`
    if (branchName.startsWith(prefix) && branchName.length > prefix.length) {
      candidates.add(branchName.slice(prefix.length))
    }
  }
  return [...candidates]
}

/**
 * Hide `origin/*` remote refs when a matching local ref already exists.
 * @param refs - full ref list from gitBranchList.
 * @returns refs with redundant origin rows removed.
 */
export function dedupeRemoteBranchesWithLocalMatches(refs: readonly BranchRef[]): BranchRef[] {
  const localNames = new Set(refs.filter(ref => !ref.isRemote).map(ref => ref.name))
  return refs.filter((ref) => {
    if (!ref.isRemote) return true
    if (ref.remoteName !== 'origin') return true
    return !localNameCandidates(ref.name, ref.remoteName).some(candidate => localNames.has(candidate))
  })
}

/**
 * Whether a picker row survives the current query; the synthetic create row
 * always survives so the "create branch" affordance stays reachable.
 * @param input - row value, normalized query, and synthetic row ids.
 * @returns whether the row is visible.
 */
export function shouldIncludeBranchPickerItem(input: {
  itemValue: string
  normalizedQuery: string
  createBranchItemValue: string | null
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue } = input
  if (normalizedQuery.length === 0) return true
  if (createBranchItemValue !== null && itemValue === createBranchItemValue) return true
  return itemValue.toLowerCase().includes(normalizedQuery)
}

const AUTO_FEATURE_BRANCH_FALLBACK = 'update'

/**
 * Sanitize an arbitrary string into a valid, lowercase git ref fragment.
 * @param raw - commit subject or typed name.
 * @returns a non-empty fragment, or `update`.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/^[./\s_-]+|[./\s_-]+$/g, '')
  const fragment = normalized
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./_-]+|[./_-]+$/g, '')
    .slice(0, 64)
    .replace(/[./_-]+$/g, '')
  return fragment.length > 0 ? fragment : AUTO_FEATURE_BRANCH_FALLBACK
}

/**
 * Sanitize a string into a `feature/…` ref name.
 * @param raw - commit subject or typed name.
 * @returns a feature ref name.
 */
export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw)
  if (sanitized.includes('/')) {
    return sanitized.startsWith('feature/') ? sanitized : `feature/${sanitized}`
  }
  return `feature/${sanitized}`
}

/**
 * Pick a unique `feature/…` name that does not collide with existing refs.
 * @param existingBranchNames - current local and remote short names.
 * @param preferredBranch - optional preferred fragment or subject.
 * @returns a unique feature ref name.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim()
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  )
  const existingNames = new Set(existingBranchNames.map(name => name.toLowerCase()))
  if (!existingNames.has(resolvedBase)) return resolvedBase
  let suffix = 2
  while (existingNames.has(`${resolvedBase}-${suffix}`)) suffix += 1
  return `${resolvedBase}-${suffix}`
}

/**
 * Order the picker rows the way the titlebar shows them: current first, then
 * locals alphabetically, then remotes alphabetically.
 * @param refs - deduped ref list.
 * @returns ordered rows.
 */
export function orderBranchRefs(refs: readonly BranchRef[]): BranchRef[] {
  const weight = (ref: BranchRef): number => (ref.isCurrent ? 0 : ref.isRemote ? 2 : 1)
  return [...refs].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name))
}
