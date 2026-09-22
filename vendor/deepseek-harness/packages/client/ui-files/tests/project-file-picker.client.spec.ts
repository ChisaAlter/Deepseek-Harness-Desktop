import { describe, expect, it } from 'vitest'
import { getProjectFilePickerMatches } from '../src/client/projectFilePicker.ts'

function pathsForQuery(entries: Parameters<typeof getProjectFilePickerMatches>[0], query: string) {
  return getProjectFilePickerMatches(entries, query).map(({ name, path }) => ({ name, path }))
}

const entries = [
  { kind: 'directory', path: 'apps/web/src' },
  { kind: 'file', path: 'apps/web/src/index.ts' },
  { kind: 'file', path: 'packages/shared/src/index.ts' },
  { kind: 'file', path: 'README.md' },
  { kind: 'file', path: '.gitignore' },
] as const

describe('getProjectFilePickerMatches', () => {
  it('returns only files and keeps index order for an empty query', () => {
    expect(pathsForQuery(entries, '')).toEqual([
      { name: 'index.ts', path: 'apps/web/src/index.ts' },
      { name: 'index.ts', path: 'packages/shared/src/index.ts' },
      { name: 'README.md', path: 'README.md' },
      { name: '.gitignore', path: '.gitignore' },
    ])
  })

  it('filters local entries while preserving matching result order', () => {
    expect(pathsForQuery(entries, 'index')).toEqual([
      { name: 'index.ts', path: 'apps/web/src/index.ts' },
      { name: 'index.ts', path: 'packages/shared/src/index.ts' },
    ])
  })

  it('omits unrelated files and returns no rows for an unmatched query', () => {
    expect(pathsForQuery(entries, 'README')).toEqual([{ name: 'README.md', path: 'README.md' }])
    expect(pathsForQuery(entries, 'definitely-no-such-file')).toEqual([])
  })

  it('applies the limit after filtering and keeps path-only matches', () => {
    expect(getProjectFilePickerMatches(entries, 'README', 1).map(row => row.path)).toEqual(['README.md'])
    expect(getProjectFilePickerMatches(entries, 'shared', 1).map(row => row.path)).toEqual(['packages/shared/src/index.ts'])
    expect(getProjectFilePickerMatches(entries, 'README', 0)).toEqual([])
  })

  it('supports space-separated path tokens and a result limit', () => {
    expect(
      getProjectFilePickerMatches(entries, 'src index', 1).map(({ name, path }) => ({
        name,
        path,
      })),
    ).toEqual([{ name: 'index.ts', path: 'apps/web/src/index.ts' }])
  })

  it('matches ordered characters while allowing skipped characters', () => {
    const fuzzyEntries = [
      { kind: 'file', path: 'src/TestFlags.tsx' },
      { kind: 'file', path: 'src/SubtestFlow.tsx' },
      { kind: 'file', path: 'src/useSubtestFlags.ts' },
      { kind: 'file', path: 'src/useSubtestFlags/useTabActivity.ts' },
    ] as const

    expect(pathsForQuery(fuzzyEntries, 'testf').map(({ name }) => name)).toEqual([
      'TestFlags.tsx',
      'SubtestFlow.tsx',
      'useSubtestFlags.ts',
      'useTabActivity.ts',
    ])
    expect(getProjectFilePickerMatches(fuzzyEntries, 'tsfl')[0]).toEqual({
      name: 'TestFlags.tsx',
      nameMatchIndices: [0, 2, 4, 5],
      path: 'src/TestFlags.tsx',
      pathMatchIndices: [4, 6, 8, 9],
    })
  })

  it('uses the first ordered subsequence for highlighting', () => {
    expect(
      getProjectFilePickerMatches([{ kind: 'file', path: 'aabba' }], 'aba')[0]?.nameMatchIndices,
    ).toEqual([0, 2, 4])
  })

  it('normalizes path prefixes consistently with server search', () => {
    expect(
      getProjectFilePickerMatches([{ kind: 'file', path: 'src/index.ts' }], '@/src')[0]
        ?.pathMatchIndices,
    ).toEqual([0, 1, 2])
  })
})
