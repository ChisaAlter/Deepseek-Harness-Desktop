/**
 * relativeTo: POSIX and Windows prefixes, case-insensitive.
 */
import { describe, expect, it } from 'vitest'
import { relativeTo } from '../src/client/paths.ts'

describe('relativeTo', () => {
  it('returns a slash-separated path under a POSIX cwd', () => {
    expect(relativeTo('/tmp/proj', '/tmp/proj/src/app.ts')).toBe('src/app.ts')
    expect(relativeTo('/tmp/proj/', '/tmp/proj/README.md')).toBe('README.md')
    expect(relativeTo('/tmp/proj', '/tmp/proj')).toBe('')
    expect(relativeTo('/tmp/proj', '/tmp/proj/.')).toBe('')
  })

  it('matches a Windows cwd case-insensitively and emits forward slashes', () => {
    expect(relativeTo('C:\\Work\\app', 'c:\\work\\app\\src\\main.ts')).toBe('src/main.ts')
    expect(relativeTo('C:/Work/app', 'C:/Work/other/file.ts')).toBeUndefined()
  })

  it('rejects a path outside cwd', () => {
    expect(relativeTo('/tmp/proj', '/tmp/other/a.ts')).toBeUndefined()
    expect(relativeTo('/tmp/proj', '/tmp/proj-extra/a.ts')).toBeUndefined()
    expect(relativeTo('', '/tmp/proj/a.ts')).toBeUndefined()
    expect(relativeTo('/tmp/proj', '')).toBeUndefined()
  })
})
