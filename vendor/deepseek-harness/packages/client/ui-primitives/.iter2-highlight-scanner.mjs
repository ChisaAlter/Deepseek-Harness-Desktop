/**
 * Time each `createScanner` call and each `findNextMatchSync` call inside the
 * first TypeScript tokenize, with the precompiled table. This shows the atomic
 * chunk sizes a scheduler could yield between.
 * argv[2] = "translated" | "table"
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const mode = process.argv[2]
const table = mode === 'table'
  ? new Map(Object.entries(JSON.parse(readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'))))
  : undefined

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    if (table === undefined) {
      return defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY })
    }
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    return new RegExp(entry[0], entry[1])
  },
})

const scanners = []
const matches = []
const wrapped = {
  createString: value => engine.createString(value),
  createScanner(patterns) {
    const at = performance.now()
    const scanner = engine.createScanner(patterns)
    scanners.push({ count: patterns.length, ms: Number((performance.now() - at).toFixed(2)) })
    return {
      findNextMatchSync(string, startPosition, options) {
        const start = performance.now()
        const result = scanner.findNextMatchSync(string, startPosition, options)
        matches.push(Number((performance.now() - start).toFixed(3)))
        return result
      },
    }
  },
}

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine: wrapped })

const at = performance.now()
instance.codeToTokens('const answer: number = 42', {
  lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
})
const totalMs = performance.now() - at

console.log(JSON.stringify({
  mode,
  totalMs: Number(totalMs.toFixed(2)),
  scannerCount: scanners.length,
  scannerTotalMs: Number(scanners.reduce((sum, e) => sum + e.ms, 0).toFixed(2)),
  scannerMaxMs: Number(Math.max(...scanners.map(e => e.ms)).toFixed(2)),
  scannersTop: [...scanners].sort((a, b) => b.ms - a.ms).slice(0, 5),
  matchCount: matches.length,
  matchTotalMs: Number(matches.reduce((sum, ms) => sum + ms, 0).toFixed(2)),
  matchMaxMs: Number(Math.max(...matches).toFixed(2)),
}, null, 2))
