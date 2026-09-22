import type { TreeEntry } from './FileTree.tsx'

/**
 * Keep directories that contain a match and files whose name matches `query`.
 * @param entries - one directory's children.
 * @param query - case-insensitive name fragment; empty keeps every entry.
 * @param childrenByPath - already-loaded directory children.
 * @returns the visible subset, preserving order.
 */
export function filterEntries(
  entries: readonly TreeEntry[],
  query: string,
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>,
): TreeEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...entries]
  return entries.filter((entry) => {
    if (entry.name.toLowerCase().includes(needle)) return true
    if (entry.kind !== 'directory') return false
    return filterEntries(childrenByPath[entry.path] ?? [], query, childrenByPath).length > 0
  })
}
