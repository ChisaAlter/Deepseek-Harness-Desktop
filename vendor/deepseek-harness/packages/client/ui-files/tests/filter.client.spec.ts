import { describe, expect, it } from 'vitest'
import { filterEntries } from '../src/client/filter.ts'

describe('filterEntries', () => {
  it('keeps matching files and ancestor directories', () => {
    const children = {
      src: [
        { name: 'a.ts', kind: 'file' as const, path: 'src/a.ts' },
        { name: 'b.md', kind: 'file' as const, path: 'src/b.md' },
      ],
    }
    const root = [
      { name: 'src', kind: 'directory' as const, path: 'src' },
      { name: 'README.md', kind: 'file' as const, path: 'README.md' },
    ]
    expect(filterEntries(root, 'a.ts', children).map(e => e.path)).toEqual(['src'])
    expect(filterEntries(root, 'README', children).map(e => e.path)).toEqual(['README.md'])
    expect(filterEntries(root, '', children)).toEqual(root)
  })
})
