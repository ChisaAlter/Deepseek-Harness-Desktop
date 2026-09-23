/**
 * Does seeding shiki's cache with pre-built RegExp objects (in slices) reduce
 * the first-tokenize task? Compares not-seeded vs seeded, both using the table.
 * argv[2] = "noseed" | "seed"
 */
import { performance } from 'node:perf_hooks'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'

const mode = process.argv[2] ?? 'noseed'
const table = HIGHLIGHT_PATTERN_TABLE
const lookup = new Map(table)

const patternCache = new Map()
const seedTasks = []
if (mode === 'seed') {
  const entries = table
  for (let index = 0; index < entries.length; index += 40) {
    const at = performance.now()
    for (const [pattern, [source, flags]] of entries.slice(index, index + 40)) {
      patternCache.set(pattern, new RegExp(source, flags))
    }
    seedTasks.push(Number((performance.now() - at).toFixed(2)))
  }
}

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: patternCache,
  regexConstructor(pattern) {
    const precompiled = lookup.get(pattern)
    return precompiled === undefined
      ? new RegExp('', 'd')
      : new RegExp(precompiled[0], precompiled[1])
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const tasks = []
for (const [lang, code] of [['typescript', 'let a: number = 1'], ['shellscript', 'echo hi'], ['json', '{"a":1}']]) {
  const at = performance.now()
  instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  tasks.push({ lang, ms: Number((performance.now() - at).toFixed(2)) })
}

const fenceAt = performance.now()
instance.codeToTokens('export function greet(name: string): string { return `hi ${name}` }', {
  lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
})
const fenceMs = Number((performance.now() - fenceAt).toFixed(2))

console.log(JSON.stringify({
  mode,
  seedTasks,
  maxSeedMs: Number((seedTasks.length ? Math.max(...seedTasks) : 0).toFixed(2)),
  tasks,
  maxGrammarTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  fenceMs,
}))
