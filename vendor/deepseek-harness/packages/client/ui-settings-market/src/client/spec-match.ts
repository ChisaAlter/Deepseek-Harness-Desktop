/**
 * Boundary-safe matching between installed-plugin specs and catalog
 * `owner/repo` coordinates. Substring matching false-positives on
 * repo-name prefixes (`acme/demo` inside `github:acme/demo-extra`),
 * so the segment must be delimited on both sides.
 */

/** Escape regex metacharacters in one literal segment. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether an installed-plugin spec refers to the exact GitHub `owner/repo`,
 * case-insensitively, as a whole path segment: the name may be preceded by
 * start-of-string or a delimiter (e.g. `github:`) and must not continue into
 * a longer owner or repo name (`-`/`_`/alphanumerics), so `acme/demo` matches
 * `github:acme/demo` and `github:acme/demo#path:/x` but not
 * `github:acme/demo-extra`.
 * @param spec - the profile's installed spec (e.g. `github:acme/demo#path:/x`).
 * @param owner - catalog row owner login; empty never matches.
 * @param repo - catalog row repository name; empty never matches.
 * @returns true when the spec names exactly that owner/repo.
 */
export function specMatchesOwnerRepo(spec: string, owner: string, repo: string): boolean {
  if (owner === '' || repo === '') return false
  const key = escapeRegExp(`${owner}/${repo}`.toLowerCase())
  return new RegExp(`(?:^|[^a-z0-9_-])${key}(?=[^a-z0-9_-]|$)`).test(spec.toLowerCase())
}
