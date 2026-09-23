/**
 * End-to-end check of the proposed design: precompiled pattern table + bounded
 * pre-execution of every RegExp, then measure the residual first-tokenize long
 * task per boot grammar. argv[2] = "table" | "tablepre" | "infinity"
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const mode = process.argv[2]
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const samples = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

const table = mode === 'infinity'
  ? undefined
  : new Map(Object.entries(JSON.parse(readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'))))

const built = []
let translationMs = 0
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    if (table === undefined) {
      const at = performance.now()
      const regex = defaultJavaScriptRegexConstructor(pattern, {
        lazyCompileLength: Number.POSITIVE_INFINITY,
      })
      translationMs += performance.now() - at
      return regex
    }
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    const regex = new RegExp(entry[0], entry[1])
    built.push(regex)
    return regex
  },
})

const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

// Warm each grammar the way a page load would: build every scanner, then pay
// V8's lazy compile before user content arrives. This is what a bounded,
// yielding warm-up can do off the render path.
let warmMs = 0
if (mode === 'tablepre') {
  const at = performance.now()
  for (const sample of samples) {
    instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  }
  for (const regex of built) { regex.lastIndex = 0; regex.exec('') }
  warmMs = performance.now() - at
}

// A *fresh* highlighter over the same engine cache is what a later fence pays.
const perSample = []
for (const sample of samples) {
  const at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  perSample.push({ lang: sample.lang, ms: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  mode,
  patterns: table === undefined ? 'translated' : table.size,
  translationMs: Number(translationMs.toFixed(2)),
  warmCoversAllBootGrammarsMs: Number(warmMs.toFixed(2)),
  perSample,
  maxTaskMs: Number(Math.max(...perSample.map(entry => entry.ms)).toFixed(2)),
}))
