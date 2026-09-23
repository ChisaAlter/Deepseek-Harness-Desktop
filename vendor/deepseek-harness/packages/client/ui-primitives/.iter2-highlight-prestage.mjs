/**
 * With pattern sources precomputed, what is the largest *indivisible* task
 * left? Measures each boot grammar's first tokenization separately on a fresh
 * highlighter that builds regexes from the precomputed table, so the answer is
 * directly comparable to the 50 ms long-task budget.
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

let fallbacks = 0
const precompiled = {
  createString: value => ({ content: value }),
  createScanner(patterns) {
    return createJavaScriptRegexEngine({
      forgiving: true,
      cache: new Map(),
      regexConstructor(pattern) {
        const entry = table.get(pattern)
        if (entry === undefined) {
          fallbacks += 1
          return defaultJavaScriptRegexConstructor(pattern)
        }
        return new RegExp(entry.source, entry.flags)
      },
    }).createScanner(patterns)
  },
}

const started = performance.now()
const instance = createHighlighterCoreSync({
  themes: [theme],
  langs: [langTs, langBash, langJson],
  engine: precompiled,
})
const constructMs = performance.now() - started

const perGrammar = []
for (const sample of warmups) {
  const at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  perGrammar.push({ lang: sample.lang, firstTokenizeMs: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  tablePatterns: table.size,
  fallbacks,
  constructMs: Number(constructMs.toFixed(2)),
  perGrammar,
  maxTaskMs: Math.max(constructMs, ...perGrammar.map(entry => entry.firstTokenizeMs)),
}, null, 2))
