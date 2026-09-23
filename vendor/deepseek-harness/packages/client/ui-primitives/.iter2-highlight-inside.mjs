/**
 * Where exactly does the table-mode first tokenize spend its time? Instrument
 * regexConstructor (RegExp construction) and compare with the total tokenize
 * call, per boot grammar.
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

const perCall = []
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const at = performance.now()
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    const regex = new RegExp(entry[0], entry[1])
    perCall.push({ patternLength: pattern.length, ms: performance.now() - at })
    return regex
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const out = []
for (const sample of [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]) {
  perCall.length = 0
  const at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  const tokenizeMs = performance.now() - at
  const constructorMs = perCall.reduce((sum, entry) => sum + entry.ms, 0)
  out.push({
    lang: sample.lang,
    tokenizeMs: Number(tokenizeMs.toFixed(2)),
    constructorCalls: perCall.length,
    constructorMs: Number(constructorMs.toFixed(2)),
    constructorMaxMs: Number((perCall.length ? Math.max(...perCall.map(e => e.ms)) : 0).toFixed(2)),
    scanningMs: Number((tokenizeMs - constructorMs).toFixed(2)),
  })
}
console.log(JSON.stringify(out, null, 2))
