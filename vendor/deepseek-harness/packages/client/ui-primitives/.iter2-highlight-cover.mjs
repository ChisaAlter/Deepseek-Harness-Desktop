/**
 * With the current generated table seeded into the engine cache, does a real
 * fence still call `regexConstructor` (i.e. is the table missing patterns), and
 * where does its time actually go?
 */
import { performance } from 'node:perf_hooks'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const cache = new Map()
for (const [pattern, [source, flags]] of HIGHLIGHT_PATTERN_TABLE) cache.set(pattern, new RegExp(source, flags))

const misses = []
const scanners = []
const inner = createJavaScriptRegexEngine({
  forgiving: true,
  cache,
  regexConstructor(pattern) {
    misses.push({ patternLength: pattern.length, head: pattern.slice(0, 60) })
    return defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY })
  },
})

const engine = {
  createString: value => inner.createString(value),
  createScanner(patterns) {
    const at = performance.now()
    const scanner = inner.createScanner(patterns)
    scanners.push({ count: patterns.length, ms: Number((performance.now() - at).toFixed(2)) })
    return scanner
  },
}

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine })

const at = performance.now()
instance.codeToTokens('export function greet(name: string): string { return `hi ${name}` }', {
  lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
})
const totalMs = Number((performance.now() - at).toFixed(2))

console.log(JSON.stringify({
  totalMs,
  missCount: misses.length,
  misses: misses.slice(0, 8),
  scannerCount: scanners.length,
  scannerTotalMs: Number(scanners.reduce((sum, entry) => sum + entry.ms, 0).toFixed(2)),
  scannerTop: [...scanners].sort((a, b) => b.ms - a.ms).slice(0, 5),
}, null, 2))
