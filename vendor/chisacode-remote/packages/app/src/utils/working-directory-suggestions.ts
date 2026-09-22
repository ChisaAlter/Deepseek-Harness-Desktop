/** Inputs used to rank and filter working-directory autocomplete suggestions */
export interface BuildWorkingDirectorySuggestionsInput {
  recommendedPaths: string[];
  serverPaths: string[];
  query: string;
}

/**
 * Builds ordered working-directory suggestions from recommended and server paths
 * @param input Recommended paths, server paths, and the current query filter
 * @returns Deduplicated paths with recommended entries first, filtered by query when present
 */
export function buildWorkingDirectorySuggestions(
  input: BuildWorkingDirectorySuggestionsInput,
): string[] {
  const rawQuery = input.query.trim();
  const recommended = uniquePaths(input.recommendedPaths);
  if (!rawQuery) {
    return recommended;
  }

  const normalizedQuery = normalizeQuery(rawQuery);
  const shouldFilterByQuery = normalizedQuery.length > 0;

  const recommendedMatches = shouldFilterByQuery
    ? recommended.filter((entry) => pathMatchesQuery(entry, normalizedQuery))
    : recommended;
  const seen = new Set(recommendedMatches);
  const ordered = [...recommendedMatches];

  for (const entry of uniquePaths(input.serverPaths)) {
    if (shouldFilterByQuery && !pathMatchesQuery(entry, normalizedQuery)) {
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    ordered.push(entry);
    seen.add(entry);
  }

  return ordered;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const pathEntry of paths) {
    const trimmed = pathEntry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function normalizeQuery(query: string): string {
  let normalized = query.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("~")) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.replace(/^\/+/, "").toLowerCase();
  return normalized;
}

function pathMatchesQuery(candidatePath: string, query: string): boolean {
  const lowerPath = candidatePath.toLowerCase();
  if (lowerPath.includes(query)) {
    return true;
  }
  const segments = lowerPath.split("/");
  return (segments[segments.length - 1] ?? "").includes(query);
}
