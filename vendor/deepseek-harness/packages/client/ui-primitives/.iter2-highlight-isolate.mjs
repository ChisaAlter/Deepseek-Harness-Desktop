/**
 * One configuration per process: isolate the boot-grammar first-tokenize cost
 * so JIT/compile warm-up from another arm cannot leak into the measurement.
 * argv[2] = "infinity" | "default" | "table"
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
const warmups = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

let translationMs = 0
let patterns = 0
const table = mode === 'table'
  ? new Map(Object.entries(JSON.parse(readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'))))
  : undefined

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    patterns += 1
    if (table !== undefined) {
      const entry = table.get(pattern)
      if (entry === undefined) throw new Error(`no precompiled pattern for ${pattern.slice(0, 40)}`)
      return new RegExp(entry[0], entry[1])
    }
    const at = performance.now()
    const regex = defaultJavaScriptRegexConstructor(pattern, mode === 'infinity'
      ? { lazyCompileLength: Number.POSITIVE_INFINITY }
      : undefined)
    translationMs += performance.now() - at
    return regex
  },
})

const at = performance.now()
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })
const constructMs = performance.now() - at

const perGrammar = []
for (const sample of warmups) {
  const start = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  perGrammar.push({ lang: sample.lang, ms: Number((performance.now() - start).toFixed(2)) })
}

console.log(JSON.stringify({
  mode,
  patterns,
  translationMs: Number(translationMs.toFixed(2)),
  constructMs: Number(constructMs.toFixed(2)),
  perGrammar,
  totalFirstUseMs: Number((constructMs + perGrammar.reduce((sum, entry) => sum + entry.ms, 0)).toFixed(2)),
  maxTaskMs: Number(Math.max(constructMs, ...perGrammar.map(entry => entry.ms)).toFixed(2)),
}))
