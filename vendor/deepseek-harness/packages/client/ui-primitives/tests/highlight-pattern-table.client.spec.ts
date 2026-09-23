import { describe, expect, it } from 'vitest'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import { HIGHLIGHT_PATTERN_TABLE } from '../src/markdown/highlight-pattern-table.generated.ts'

/**
 * The precompiled pattern table is a build artifact: it mirrors what shiki's
 * JavaScript engine derived from the installed `@shikijs/langs` grammars. If a
 * dependency upgrade changes a grammar's patterns, the table silently stops
 * covering the boot grammars and the client pays the old on-main-thread
 * translation cost again — so this spec fails instead.
 */

/**
 * The samples must match `scripts/generate-highlight-pattern-table.mjs` and the
 * warm-up list in `src/markdown/highlight.ts`: the table is only required to
 * cover the patterns the client's own warm-up requests, and the runtime
 * fallback covers every other pattern of the same grammar.
 */
const SAMPLES: Record<string, { grammar: typeof langTs; codes: readonly string[] }> = {
  typescript: {
    grammar: langTs,
    codes: [
      'const answer: number = 42',
      'export function greet(name: string): string { return `hi ${name}` }',
      'interface User { id: number; tags: string[] }',
      'class Box<T> { constructor(private readonly value: T) {} }',
      '// comment\n/* block */\nimport { a } from "mod"',
      'enum E { A = 1 }\ntype R = Record<string, () => Promise<void>>',
      'const re = /ab+c/gi\nconst n = 1_000n\nlabel: for (;;) break label',
    ],
  },
  shellscript: {
    grammar: langBash,
    codes: [
      'printf \'%s\\n\' "$HOME"',
      'for file in *.txt; do wc -l "$file"; done',
      'find . -name "*.ts" -print0 | xargs -0 wc -l',
      'case "$1" in a) echo a;; *) exit 1;; esac',
      '# comment\nVAR=${OTHER:-default}\necho $(date)',
    ],
  },
  json: {
    grammar: langJson,
    codes: [
      '{"ready":true}',
      '{"users":[{"id":1,"name":"a"},{"id":2}],"ok":false,"n":null}',
      '[1, 2.5, -3e4, "text\\n", true]',
    ],
  },
}

describe('highlight pattern table', () => {
  it('covers every pattern the boot grammars request', () => {
    const table = new Map(HIGHLIGHT_PATTERN_TABLE.map(([pattern, value]) => [pattern, value]))
    const missing = new Set<string>()
    const theme = createCssVariablesTheme({
      name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true,
    })

    for (const [name, { grammar, codes }] of Object.entries(SAMPLES)) {
      const engine = createJavaScriptRegexEngine({
        forgiving: true,
        cache: new Map(),
        regexConstructor(pattern) {
          if (!table.has(pattern)) missing.add(pattern)
          return defaultJavaScriptRegexConstructor(pattern)
        },
      })
      const instance = createHighlighterCoreSync({ themes: [theme], langs: [grammar], engine })
      for (const code of codes) {
        instance.codeToTokens(code, { lang: name, theme: 'css-variables', tokenizeTimeLimit: 0 })
      }
    }

    expect([...missing]).toEqual([])
  })

  it('carries translated sources the JavaScript engine accepts', () => {
    // Every entry must compile: a stale flag or a source edited by hand would
    // otherwise throw inside the engine's scanner construction.
    for (const [pattern, [source, flags]] of HIGHLIGHT_PATTERN_TABLE) {
      expect(() => new RegExp(source, flags), `pattern ${pattern.slice(0, 40)}`).not.toThrow()
    }
  })
})
