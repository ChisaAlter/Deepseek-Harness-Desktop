import { describe, expect, it } from 'vitest'
import { fileBreadcrumbs } from '../src/client/filePath.ts'

describe('fileBreadcrumbs', () => {
  it('builds project, directory, and file crumbs', () => {
    expect(fileBreadcrumbs('dshd', 'apps/web/src/main.tsx')).toEqual([
      { label: 'dshd', path: '', kind: 'project' },
      { label: 'apps', path: 'apps', kind: 'directory' },
      { label: 'web', path: 'apps/web', kind: 'directory' },
      { label: 'src', path: 'apps/web/src', kind: 'directory' },
      { label: 'main.tsx', path: 'apps/web/src/main.tsx', kind: 'file' },
    ])
  })

  it('normalizes repeated separators', () => {
    expect(fileBreadcrumbs('workspace', '/src//index.ts').map((crumb) => crumb.label)).toEqual([
      'workspace',
      'src',
      'index.ts',
    ])
  })
})
