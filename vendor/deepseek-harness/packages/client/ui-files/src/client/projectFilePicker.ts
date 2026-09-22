/** Project file picker rows: subsequence highlights over walked file entries. */

export const PROJECT_FILE_PICKER_RESULT_LIMIT = 200

/** One workspace entry used as picker input. */
export interface ProjectEntry {
  kind: 'file' | 'directory'
  path: string
}

/** One picker row with highlight indices. */
export interface ProjectFilePickerMatch {
  name: string
  nameMatchIndices: readonly number[]
  path: string
  pathMatchIndices: readonly number[]
}

/**
 * Trim, lowercase, and optionally strip a leading pattern from a search query.
 * @param input - raw query text.
 * @param options.trimLeadingPattern - removed from the trimmed query before lowercasing.
 * @returns the normalized query, or empty when input is blank.
 */
export function normalizeSearchQuery(
  input: string,
  options?: { trimLeadingPattern?: RegExp },
): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return options?.trimLeadingPattern
    ? trimmed.replace(options.trimLeadingPattern, '').toLowerCase()
    : trimmed.toLowerCase()
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * First ordered subsequence of `query` inside `value`, as highlight indices.
 * Returns null when `value` does not contain the subsequence.
 */
function findMatchIndices(value: string, query: string): number[] | null {
  if (!query) return []

  const normalizedValue = value.toLowerCase()
  const indices: number[] = []
  let queryIndex = 0

  for (let valueIndex = 0; valueIndex < normalizedValue.length; valueIndex += 1) {
    if (normalizedValue[valueIndex] !== query[queryIndex]) continue
    indices.push(valueIndex)
    queryIndex += 1
    if (queryIndex === query.length) return indices
  }

  return null
}

/**
 * Filter walked workspace files by name or path subsequence before limiting
 * the rows. Matching entries retain their original order and highlight indices.
 * @param entries - walked files and directories.
 * @param rawQuery - search field text.
 * @param limit - max rows; default 200.
 * @returns file rows with name/path highlight indices.
 */
export function getProjectFilePickerMatches(
  entries: readonly ProjectEntry[],
  rawQuery: string,
  limit = PROJECT_FILE_PICKER_RESULT_LIMIT,
): ProjectFilePickerMatch[] {
  if (limit <= 0) return []

  const query = normalizeSearchQuery(rawQuery, {
    trimLeadingPattern: /^[@./]+/,
  }).replaceAll(/\s/g, '')
  const matches: ProjectFilePickerMatch[] = []

  for (const entry of entries) {
    if (entry.kind !== 'file') continue

    const name = fileName(entry.path)
    const nameMatchIndices = findMatchIndices(name, query)
    const pathMatchIndices = findMatchIndices(entry.path, query)
    if (nameMatchIndices === null && pathMatchIndices === null) continue
    matches.push({
      name,
      nameMatchIndices: nameMatchIndices ?? [],
      path: entry.path,
      pathMatchIndices: pathMatchIndices ?? [],
    })
    if (matches.length >= limit) break
  }

  return matches
}
