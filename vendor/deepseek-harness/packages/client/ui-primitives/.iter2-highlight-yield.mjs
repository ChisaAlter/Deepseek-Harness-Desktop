/**
 * Choose the warm-up shape. `tokenizeTimeLimit` is checked between lines, so a
 * multi-line warm sample lets a small budget break the cold build into several
 * tasks. Report every task the warm-up would run and the largest one.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const useTable = process.argv[2] !== 'notable'
const budget = Number(process.argv[3] ?? 16)
const table = useTable
  ? new Map(Object.entries(JSON.parse(readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'))))
  : undefined

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    if (table !== undefined) {
      const entry = table.get(pattern)
      if (entry !== undefined) return new RegExp(entry[0], entry[1])
    }
    return defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    })
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const samples = {
  typescript: Array.from({ length: 24 }, (_, index) => `const value${String(index)}: number = ${String(index)} + 1`).join('\n'),
  shellscript: Array.from({ length: 24 }, (_, index) => `echo "line ${String(index)}" | grep line`).join('\n'),
  json: Array.from({ length: 24 }, (_, index) => `{"key${String(index)}":${String(index)},"ok":true}`).join('\n'),
}

const tasks = []
for (const lang of ['typescript', 'shellscript', 'json']) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const at = performance.now()
    const result = instance.codeToTokens(samples[lang], {
      lang, theme: 'css-variables', tokenizeTimeLimit: budget,
    })
    const ms = performance.now() - at
    tasks.push({ label: `${lang}#${String(attempt)}`, ms: Number(ms.toFixed(2)), lines: result.tokens.length })
    if (ms < 2) break
  }
}

// Residual: the first real fence after this warm-up.
const fence = 'export function greet(name: string): string { return `hi ${name}` }'
const at = performance.now()
instance.codeToTokens(fence, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const fenceMs = Number((performance.now() - at).toFixed(2))

console.log(JSON.stringify({
  useTable,
  budget,
  tasks,
  taskCount: tasks.length,
  maxTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  totalMs: Number(tasks.reduce((sum, task) => sum + task.ms, 0).toFixed(2)),
  firstFenceMs: fenceMs,
}, null, 2))
