/** Relative-path math for intercepting absolute workspace opens. */

/**
 * Return `absolute` as a `/`-separated path relative to `cwd`, or undefined
 * when it is outside `cwd`. Comparison is case-insensitive so Windows drive
 * letters match. The workspace root itself yields an empty string.
 * @param cwd - session workspace directory.
 * @param absolute - host-absolute path from `workspaces.openPath`.
 * @returns the relative path, empty string for the root, or undefined.
 */
export function relativeTo(cwd: string, absolute: string): string | undefined {
  const root = normalize(cwd)
  const full = normalize(absolute)
  if (root.length === 0 || full.length === 0) return undefined
  if (full.toLowerCase() === root.toLowerCase()) return ''
  const prefix = `${root.toLowerCase()}/`
  if (!full.toLowerCase().startsWith(prefix)) return undefined
  return full.slice(root.length + 1)
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').replace(/\/\.$/, '')
}
