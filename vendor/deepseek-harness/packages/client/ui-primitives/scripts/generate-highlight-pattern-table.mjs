/**
 * Regenerate `src/markdown/highlight-pattern-table.generated.ts`.
 *
 * The client's shiki regex engine translates each TextMate pattern from
 * Oniguruma to JavaScript on first use. For the three grammars loaded at boot
 * that translation is ~145 ms of synchronous main-thread work, which lands
 * inside the first code fence's render. Translating the same patterns here, at
 * build time, lets the client construct the engine from plain `RegExp` sources
 * instead — the published table is ~86 KB of JSON-shaped data.
 *
 * The table is versioned with the shiki dependency: `highlight-pattern-table`
 * tests fail when the installed grammars ask for a pattern the table does not
 * carry, so a shiki upgrade cannot silently fall back to runtime translation.
 *
 * Run from this package directory:
 *   node scripts/generate-highlight-pattern-table.mjs
 */
import { writeFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

/**
 * Samples that reach the rule sets ordinary fences of each boot language use.
 * A TextMate grammar builds each rule's scanner only when tokenizing text
 * descends into that rule, so the table has to cover the constructs a real
 * fence reaches — a single declaration line leaves `function`, `interface`, or
 * `class` rule sets uncovered, and the first fence using one then pays the
 * full runtime translation. These mirror `BOOT_GRAMMAR_WARMUPS` in
 * `src/markdown/highlight.ts`.
 */
const SAMPLES = {
  typescript: [
    'const answer: number = 42',
    'export function greet(name: string): string { return `hi ${name}` }',
    'interface User { id: number; tags: string[] }',
    'class Box<T> { constructor(private readonly value: T) {} }',
    '// comment\n/* block */\nimport { a } from "mod"',
    'enum E { A = 1 }\ntype R = Record<string, () => Promise<void>>',
    'const re = /ab+c/gi\nconst n = 1_000n\nlabel: for (;;) break label',
  ],
  shellscript: [
    'printf \'%s\\n\' "$HOME"',
    'for file in *.txt; do wc -l "$file"; done',
    'find . -name "*.ts" -print0 | xargs -0 wc -l',
    'case "$1" in a) echo a;; *) exit 1;; esac',
    '# comment\nVAR=${OTHER:-default}\necho $(date)',
  ],
  json: [
    '{"ready":true}',
    '{"users":[{"id":1,"name":"a"},{"id":2}],"ok":false,"n":null}',
    '[1, 2.5, -3e4, "text\\n", true]',
  ],
}

const table = new Map()
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const regex = defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    })
    table.set(pattern, [regex.source, regex.flags])
    return regex
  },
})

const theme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

for (const [name, grammar] of [['typescript', langTs], ['shellscript', langBash], ['json', langJson]]) {
  const instance = createHighlighterCoreSync({ themes: [theme], langs: [grammar], engine })
  for (const code of SAMPLES[name]) {
    instance.codeToTokens(code, { lang: name, theme: 'css-variables', tokenizeTimeLimit: 0 })
  }
}

const entries = [...table.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([pattern, [source, flags]]) => `  [${JSON.stringify(pattern)}, [${JSON.stringify(source)}, ${JSON.stringify(flags)}]],`)
  .join('\n')

const contents = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with \`node scripts/generate-highlight-pattern-table.mjs\` after
 * upgrading shiki or \`@shikijs/langs\`.
 *
 * Maps every TextMate pattern the three boot grammars (TypeScript, shell, JSON)
 * request into the JavaScript \`RegExp\` source and flags that shiki's
 * JavaScript engine would otherwise compute on the main thread during the first
 * code fence. Entries are \`[pattern, [source, flags]]\` in sorted pattern order;
 * \`highlight-pattern-table.client.spec.ts\` fails when the installed grammars
 * ask for a pattern this table does not carry.
 */

/** Precompiled \`RegExp\` sources for shiki's boot grammars, keyed by TextMate pattern. */
export const HIGHLIGHT_PATTERN_TABLE: readonly (readonly [string, readonly [string, string]])[] = [
${entries}
]
`

const target = new URL('../src/markdown/highlight-pattern-table.generated.ts', import.meta.url)
writeFileSync(target, contents)
console.log(JSON.stringify({
  patterns: table.size,
  bytes: Buffer.byteLength(contents),
  longestSource: Math.max(...[...table.values()].map(([source]) => source.length)),
}))
