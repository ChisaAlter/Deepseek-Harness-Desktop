/**
 * Decisive comparison for the on-demand warm-up design. Each arm builds the
 * boot grammars the way the app would and reports the largest main-thread task
 * a scheduler has to live with.
 *
 *   cold      - first real fence renders with no warm-up at all
 *   budget    - repeated `codeToTokens` at a 20 ms tokenize budget until the
 *               work converges (runtime Oniguruma translation left in place)
 *   table     - one unbudgeted build from the precompiled pattern table
 *   tablebudget - table + budgeted warm-up
 *
 * argv[2] = arm
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const arm = process.argv[2]
const budget = 20
const useTable = arm === 'table' || arm === 'tablebudget'
const useBudget = arm === 'budget' || arm === 'tablebudget'

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

const warmSamples = [
  { lang: 'typescript', code: 'const x: number = 1' },
  { lang: 'shellscript', code: 'echo "$HOME"' },
  { lang: 'json', code: '{"a":1}' },
]

const tasks = []
if (arm === 'cold') {
  const at = performance.now()
  instance.codeToTokens('const answer: number = 42', {
    lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
  })
  tasks.push({ label: 'firstFence', ms: Number((performance.now() - at).toFixed(2)) })
} else if (useBudget) {
  for (const sample of warmSamples) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const at = performance.now()
      instance.codeToTokens(sample.code, {
        lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: budget,
      })
      const ms = Number((performance.now() - at).toFixed(2))
      tasks.push({ label: `${sample.lang}#${attempt}`, ms })
      if (ms < 2) break
    }
  }
  if (arm === 'tablebudget') {
    // Table arms never call translation, so the first real fence is a pure
    // measure of the residual work the warm-up did not absorb.
    const at = performance.now()
    instance.codeToTokens('const answer: number = 42', {
      lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
    })
    tasks.push({ label: 'firstFenceAfterWarm', ms: Number((performance.now() - at).toFixed(2)) })
  }
} else {
  const at = performance.now()
  for (const sample of warmSamples) {
    instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  }
  tasks.push({ label: 'unbudgetedWarm', ms: Number((performance.now() - at).toFixed(2)) })
}

// A fence with content the caller has never tokenized in this process.
const fence = 'export function greet(name: string): string { return `hi ${name}` }'
const fenceAt = performance.now()
instance.codeToTokens(fence, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const fenceMs = Number((performance.now() - fenceAt).toFixed(2))

console.log(JSON.stringify({
  arm,
  tasks,
  maxTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  laterFenceMs: fenceMs,
}, null, 2))
