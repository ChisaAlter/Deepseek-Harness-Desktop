function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes an opaque workspace id by trimming empty values
 * @param value Raw workspace id, if any
 * @returns Trimmed id, or null when missing/blank
 */
export function normalizeWorkspaceOpaqueId(value: string | null | undefined): string | null {
  return trimNonEmpty(value);
}

/**
 * Normalizes a workspace filesystem path for identity comparisons
 * @param value Raw path using either Windows or Unix separators
 * @returns Trimmed path with Unix separators and no trailing slash (except root)
 */
export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) {
    return null;
  }
  const withUnixSeparators = trimmed.replace(/\\/g, "/");
  if (withUnixSeparators === "/") {
    return withUnixSeparators;
  }
  const withoutTrailingSlash = withUnixSeparators.replace(/\/+$/, "");
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : "/";
}
