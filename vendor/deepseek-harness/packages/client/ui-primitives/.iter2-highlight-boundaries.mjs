/**
 * Record which Oniguruma patterns each boot grammar's scanner asks its engine
 * for, so a warm-up can be split per grammar and bounded in size.
 */
import { writeFileSync } from 'node:fs'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const samples = {
  typescript: 'const answer: number = 42',
  shellscript: 'printf \'%s\\n\' "$HOME"',
  json: '{"ready":true}',
}
const boundaries = {}
for (const [name, grammar] of [['typescript', langTs], ['shellscript', langBash], ['json', langJson]]) {
  const order = []
  const engine = createJavaScriptRegexEngine({
    forgiving: true,
    cache: new Map(),
    regexConstructor(pattern) {
      order.push(pattern)
      return defaultJavaScriptRegexConstructor(pattern, {
        lazyCompileLength: Number.POSITIVE_INFINITY,
      })
    },
  })
  const instance = createHighlighterCoreSync({ themes: [theme], langs: [grammar], engine })
  instance.codeToTokens(samples[name], { lang: name, theme: 'css-variables', tokenizeTimeLimit: 0 })
  boundaries[name] = order
}
writeFileSync(new URL('./.iter2-pattern-boundaries.json', import.meta.url), JSON.stringify(boundaries))
console.log(JSON.stringify(Object.fromEntries(
  Object.entries(boundaries).map(([name, order]) => [name, order.length]),
)))
