// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { CODE_HIGHLIGHT_EXTENSIONS, languageForPath, useCodeHighlighter } from '../src/code-highlighting.ts'
import { supportsHighlighting } from '../src/markdown/highlight.ts'

afterEach(cleanup)

describe('code highlighting', () => {
  it.each([
    ['component.TSX', 'typescript'], ['module.mts', 'typescript'], ['module.cts', 'typescript'],
    ['client.jsx', 'javascript'], ['module.mjs', 'javascript'], ['module.cjs', 'javascript'],
    ['script.sh', 'shellscript'], ['script.zsh', 'shellscript'], ['data.jsonc', 'json'],
    ['events.jsonl', 'json'], ['model.pyi', 'python'], ['task.rake', 'ruby'],
    ['main.go', 'go'], ['main.rs', 'rust'], ['Main.java', 'java'], ['main.c', 'c'],
    ['header.h', 'c'], ['header.hpp', 'cpp'], ['main.cxx', 'cpp'], ['Main.cs', 'csharp'],
    ['build.kts', 'kotlin'], ['main.swift', 'swift'], ['index.php', 'php'],
    ['config.yml', 'yaml'], ['config.toml', 'toml'], ['config.ini', 'ini'],
    ['README.md', 'markdown'], ['page.mdx', 'mdx'], ['index.HTML', 'html'],
    ['index.htm', 'html'], ['style.css', 'css'], ['style.scss', 'scss'],
    ['style.less', 'less'], ['query.sql', 'sql'], ['schema.xsd', 'xml'], ['init.lua', 'lua'],
  ])('uses the existing %s grammar hint %s', (path, language) => {
    expect(languageForPath(path)).toBe(language)
  })

  it('keeps every registered suffix highlightable by the shared primitive', () => {
    expect(new Set(CODE_HIGHLIGHT_EXTENSIONS).size).toBe(CODE_HIGHLIGHT_EXTENSIONS.length)
    for (const extension of CODE_HIGHLIGHT_EXTENSIONS) {
      expect(supportsHighlighting(languageForPath(`file.${extension}`)), extension).toBe(true)
    }
  })

  it('uses the filename suffix for both path separators', () => {
    expect(languageForPath('/project/archive.old/source.d.ts')).toBe('typescript')
    expect(languageForPath('C:\\project\\source.CPP')).toBe('cpp')
  })

  it.each(['README', 'dir.ts/README', 'notes.txt', 'main.ts.backup', 'file.unknown', 'file.constructor', 'file.__proto__'])('does not claim %s', (path) => {
    expect(languageForPath(path)).toBeUndefined()
  })

  it('returns plain text for an absent language and refreshes after a lazy grammar loads', async () => {
    const plain = renderHook(() => useCodeHighlighter(undefined))
    expect(plain.result.current('plain')).toBeUndefined()

    const lazy = renderHook(() => useCodeHighlighter('lua'))
    const loading = lazy.result.current
    expect(loading('local answer = 42')).toBeUndefined()
    await waitFor(() => { expect(lazy.result.current).not.toBe(loading) })
    expect(lazy.result.current('local answer = 42')).not.toBeUndefined()
  })
})
