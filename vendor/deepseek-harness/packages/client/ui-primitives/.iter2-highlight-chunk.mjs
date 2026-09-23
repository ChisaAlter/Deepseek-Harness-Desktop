/**
 * Can the warm-up be decomposed into bounded tasks? With the precompiled
 * table, measure per grammar: scanner construction (empty-string tokenize),
 * the capture of each RegExp, the largest single pre-exec, and the residual
 * real tokenize afterwards.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const captured = []
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    const regex = new RegExp(entry[0], entry[1])
    captured.push(regex)
    return regex
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const samples = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

const perGrammar = []
for (const sample of samples) {
  const before = captured.length
  let at = performance.now()
  instance.codeToTokens('', { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  const constructMs = performance.now() - at
  const mine = captured.slice(before)

  const execMs = []
  at = performance.now()
  for (const regex of mine) {
    regex.lastIndex = 0
    const start = performance.now()
    regex.exec(sample.code)
    execMs.push(performance.now() - start)
  }
  const execTotalMs = performance.now() - at

  at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  const residualMs = performance.now() - at

  perGrammar.push({
    lang: sample.lang,
    regexes: mine.length,
    constructMs: Number(constructMs.toFixed(2)),
    execTotalMs: Number(execTotalMs.toFixed(2)),
    execMaxMs: Number(Math.max(...execMs).toFixed(2)),
    residualTokenizeMs: Number(residualMs.toFixed(2)),
  })
}

console.log(JSON.stringify(perGrammar, null, 2))
