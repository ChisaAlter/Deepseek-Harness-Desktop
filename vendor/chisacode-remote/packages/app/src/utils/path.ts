/**
 * Whether a path is absolute on Unix or Windows
 * @param value Path string to test
 * @returns True for rooted Unix paths, UNC paths, or Windows drive paths
 */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}
