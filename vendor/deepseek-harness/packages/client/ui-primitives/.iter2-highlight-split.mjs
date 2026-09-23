/**
 * Can the TypeScript warm-up be split into sub-50 ms tasks? Measure:
 *  - first tokenize cost vs. text length (is it scan-bound or setup-bound?)
 *  - whether a cheap warm (tiny text, then progressively longer) leaves the
 *    scanners warm enough that a real fence tokenizes quickly
 *  - whether repeated tokenize calls resume cheaply
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const cache = new Map()
for (const [pattern, [source, flags]] of table) cache.set(pattern, new RegExp(source, flags))
const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine })

const texts = [
  ['x', 'x'],
  ['identifier', 'answer'],
  ['letDecl', 'let x = 1'],
  ['funcDecl', 'function f(a) { return a }'],
  ['typeAnn', 'const answer: number = 42'],
  ['string', 'const s = `hi ${name}`'],
  ['real', 'export function greet(name: string): string { return `hi ${name}` }'],
]

const steps = []
for (const [label, code] of texts) {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  steps.push({ label, chars: code.length, ms: Number((performance.now() - at).toFixed(2)) })
}

const fresh = 'export function greet(name: string): string { return `hi ${name}` }'
const at = performance.now()
instance.codeToTokens(fresh, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const afterWarmMs = Number((performance.now() - at).toFixed(2))

// Multiline: costs per line or once?
const lines = Array.from({ length: 50 }, (_, index) => `const value${index}: number = ${index}`).join('\n')
const at2 = performance.now()
instance.codeToTokens(lines, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const fiftyLinesMs = Number((performance.now() - at2).toFixed(2))

console.log(JSON.stringify({ steps, afterWarmMs, fiftyLinesMs }, null, 2))
