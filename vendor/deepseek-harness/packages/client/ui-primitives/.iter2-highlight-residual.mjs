/**
 * Where does the residual ~46 ms sit once pattern translation is removed?
 *
 * Wraps the precompiled engine so each scanner construction and each
 * `tokenizeLine` call is timed separately. If the time is spread across many
 * small calls, the main thread can yield between them; if one call owns it,
 * that call is the indivisible task the plan's <50 ms budget applies to.
 */
import { performance } from 'node:perf_hooks'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const table = new Map()
const collect = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const regex = defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    })
    table.set(pattern, { source: regex.source, flags: regex.flags })
    return regex
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const warmups = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]
const seed = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine: collect })
for (const sample of warmups) {
  seed.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
}

let scannerMs = 0
let tokenizeMs = 0
let tokenizeCalls = 0
let slowestTokenize = 0

const inner = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const entry = table.get(pattern)
    return entry === undefined
      ? defaultJavaScriptRegexConstructor(pattern)
      : new RegExp(entry.source, entry.flags)
  },
})
const instrumented = {
  createString: value => inner.createString(value),
  createScanner(patterns) {
    const at = performance.now()
    const scanner = inner.createScanner(patterns)
    scannerMs += performance.now() - at
    const find = scanner.findNextMatchSync.bind(scanner)
    scanner.findNextMatchSync = (...args) => {
      const started = performance.now()
      const result = find(...args)
      const elapsed = performance.now() - started
      tokenizeMs += elapsed
      tokenizeCalls += 1
      slowestTokenize = Math.max(slowestTokenize, elapsed)
      return result
    }
    return scanner
  },
}

const started = performance.now()
const instance = createHighlighterCoreSync({
  themes: [theme],
  langs: [langTs, langBash, langJson],
  engine: instrumented,
})
const constructMs = performance.now() - started

const perGrammar = []
for (const sample of warmups) {
  const at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  perGrammar.push({ lang: sample.lang, totalMs: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  constructMs: Number(constructMs.toFixed(2)),
  perGrammar,
  scannerConstructionMs: Number(scannerMs.toFixed(2)),
  findNextMatchTotalMs: Number(tokenizeMs.toFixed(2)),
  findNextMatchCalls: tokenizeCalls,
  slowestFindNextMatchMs: Number(slowestTokenize.toFixed(2)),
}, null, 2))
