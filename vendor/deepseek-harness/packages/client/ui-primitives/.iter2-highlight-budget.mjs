/**
 * Can `tokenizeTimeLimit` turn the cold highlighter build into bounded chunks?
 * Each call aborts after the budget; repeated calls resume from the grammar
 * state shiki already cached (scanners stay built once created), so a sequence
 * of budgeted calls may converge on a fully warm highlighter without any single
 * task exceeding the budget.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const budget = Number(process.argv[2] ?? 40)
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))
const cache = new Map()
for (const [pattern, [source, flags]] of table) cache.set(pattern, new RegExp(source, flags))

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const probe = 'export function greet(name: string): string { return `hi ${name}` }'
const steps = []
for (let attempt = 0; attempt < 12; attempt += 1) {
  const at = performance.now()
  let outcome = 'ok'
  try {
    instance.codeToTokens(probe, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: budget })
  } catch (error) {
    outcome = error instanceof Error ? error.name : 'error'
  }
  steps.push({ attempt, ms: Number((performance.now() - at).toFixed(2)), outcome })
}

// After the budgeted sequence, how long does an unbudgeted real tokenize take?
const finalAt = performance.now()
instance.codeToTokens(probe, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const finalMs = Number((performance.now() - finalAt).toFixed(2))

console.log(JSON.stringify({
  budget,
  steps,
  maxStepMs: Math.max(...steps.map(step => step.ms)),
  finalUnbudgetedMs: finalMs,
}, null, 2))
