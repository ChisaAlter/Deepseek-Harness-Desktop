/** Shared filename-to-grammar selection and lazy line highlighter for source views. */
import { useCallback, useSyncExternalStore } from 'react'
import {
  grammarLoadCount, highlightLines, subscribeGrammarLoaded, type HighlightSpan,
} from './markdown/highlight.ts'

const LANGUAGE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  shellscript: ['sh', 'bash', 'zsh'],
  json: ['json', 'jsonc', 'jsonl', 'ndjson'],
  python: ['py', 'pyw', 'pyi'],
  ruby: ['rb', 'rake', 'gemspec'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'],
  csharp: ['cs'],
  kotlin: ['kt', 'kts'],
  swift: ['swift'],
  php: ['php'],
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  ini: ['ini'],
  markdown: ['md', 'markdown'],
  mdx: ['mdx'],
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  sql: ['sql'],
  xml: ['xml', 'xsd', 'xsl', 'xslt'],
  lua: ['lua'],
}

const LANGUAGES = new Map(Object.entries(LANGUAGE_EXTENSIONS)
  .flatMap(([language, extensions]) => extensions.map(extension => [extension, language] as const)))

/** Recognized filename suffixes whose source can use the shared syntax highlighter. */
export const CODE_HIGHLIGHT_EXTENSIONS: readonly string[] = [...LANGUAGES.keys()]

/**
 * Select the shared syntax highlighter's grammar from a filename.
 * @param path - decoded source filename or path.
 * @returns a supported grammar hint, or `undefined` for other suffixes.
 */
export function languageForPath(path: string): string | undefined {
  const extension = /\.([^./]+)$/u.exec(path.replaceAll('\\', '/'))?.[1]?.toLowerCase()
  return extension === undefined ? undefined : LANGUAGES.get(extension)
}

/** Highlight one source fragment into one token list per line. */
export type CodeHighlighter = (code: string) => HighlightSpan[][] | undefined

/**
 * Bind the shared lazy highlighter to one language and refresh after its grammar loads.
 * @param language - grammar hint selected from the source filename.
 * @returns a stable fragment highlighter; unknown and loading grammars return `undefined` for plain-text fallback.
 */
export function useCodeHighlighter(language: string | undefined): CodeHighlighter {
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  return useCallback(code => highlightLines(code, language), [language, loaded])
}

export type { HighlightSpan }
