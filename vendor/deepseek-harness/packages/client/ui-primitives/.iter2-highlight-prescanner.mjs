/**
 * Capture the pattern list shiki hands its scanner, pre-execute those exact
 * RegExp instances in slices, then measure the first tokenize. This tests
 * whether the long task is V8 compiling the scanner's regexes at first match
 * (fixable by pre-warming) or the scan itself (not fixable this way).
 * argv[2] = "off" | number-of-patterns-per-slice
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const mode = process.argv[2] ?? 'off'
const slice = Number(mode)
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const cache = new Map()
for (const [pattern, [source, flags]] of table) cache.set(pattern, new RegExp(source, flags))

const inner = createJavaScriptRegexEngine({ forgiving: true, cache })
const scanners = []
const engine = {
  createString: value => inner.createString(value),
  createScanner(patterns) {
    const scanner = inner.createScanner(patterns)
    scanners.push({ patterns, scanner })
    return scanner
  },
}

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine })

// Force the grammar to build its scanners without matching anything costly.
const at = performance.now()
instance.codeToTokens('x', { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const firstMs = Number((performance.now() - at).toFixed(2))

const tasks = []
if (mode !== 'off') {
  const all = scanners.flatMap(entry => entry.patterns)
  const unique = [...new Set(all)]
  for (let index = 0; index < unique.length; index += slice) {
    const at2 = performance.now()
    for (const pattern of unique.slice(index, index + slice)) {
      const regex = cache.get(pattern)
      if (regex === undefined) continue
      regex.lastIndex = 0
      regex.exec('const value: number = 1')
      regex.lastIndex = 0
      regex.exec('')
    }
    tasks.push(Number((performance.now() - at2).toFixed(2)))
  }
}

// Second tokenize, same tiny text as the first: measures what a later fence pays.
const at3 = performance.now()
instance.codeToTokens('y', { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
const secondMs = Number((performance.now() - at3).toFixed(2))

const fenceAt = performance.now()
instance.codeToTokens('export function greet(name: string): string { return `hi ${name}` }', {
  lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
})
const fenceMs = Number((performance.now() - fenceAt).toFixed(2))

console.log(JSON.stringify({
  mode,
  scannerCount: scanners.length,
  scannerPatterns: scanners.map(entry => entry.patterns.length),
  firstMs,
  preExecTasks: tasks.length,
  preExecMaxMs: Number((tasks.length ? Math.max(...tasks) : 0).toFixed(2)),
  preExecTotalMs: Number(tasks.reduce((sum, ms) => sum + ms, 0).toFixed(2)),
  secondMs,
  fenceMs,
}))
