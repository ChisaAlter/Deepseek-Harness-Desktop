/**
 * The scanner reuses the exact RegExp objects held in the engine cache, so
 * pre-executing those same objects should pay V8's lazy compile ahead of the
 * scanner's first match. Compare seed-only against seed+pre-exec.
 * argv[2] = "seed" | "preexec"
 */
import { performance } from 'node:perf_hooks'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const mode = process.argv[2] ?? 'seed'
const lookup = new Map(HIGHLIGHT_PATTERN_TABLE)
const patternCache = new Map()
const seedTasks = []

const entries = [...lookup]
for (let index = 0; index < entries.length; index += 40) {
  const at = performance.now()
  for (const [pattern, [source, flags]] of entries.slice(index, index + 40)) {
    const regex = new RegExp(source, flags)
    if (mode === 'preexec') {
      regex.lastIndex = 0
      regex.exec('let a: number = 1')
      regex.lastIndex = 0
      regex.exec('')
    }
    patternCache.set(pattern, regex)
  }
  seedTasks.push(Number((performance.now() - at).toFixed(2)))
}

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: patternCache,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const tasks = []
for (const [lang, code] of [['typescript', 'let a: number = 1'], ['shellscript', 'echo hi'], ['json', '{"a":1}']]) {
  const at = performance.now()
  instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  tasks.push({ lang, ms: Number((performance.now() - at).toFixed(2)) })
}

const fences = []
for (const code of [
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }',
]) {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  fences.push(Number((performance.now() - at).toFixed(2)))
}

console.log(JSON.stringify({
  mode,
  seedMaxMs: Number(Math.max(...seedTasks).toFixed(2)),
  seedTotalMs: Number(seedTasks.reduce((sum, ms) => sum + ms, 0).toFixed(2)),
  tasks,
  maxTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  fences,
}))
