/** How large is the precomputed pattern table, and is it stable across runs? */
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const table = new Map()
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const regex = defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    })
    table.set(pattern, [regex.source, regex.flags])
    return regex
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })
for (const sample of [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]) {
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
}

const entries = [...table.entries()]
const sources = entries.map(([pattern, [source]]) => ({ pattern, source }))
const totalPattern = entries.reduce((sum, [pattern]) => sum + pattern.length, 0)
const totalSource = entries.reduce((sum, [, [source]]) => sum + source.length, 0)
console.log(JSON.stringify({
  entries: entries.length,
  patternChars: totalPattern,
  sourceChars: totalSource,
  jsonBytes: Buffer.byteLength(JSON.stringify(sources)),
  longestSource: Math.max(...entries.map(([, [source]]) => source.length)),
  largestBuckets: [...entries]
    .sort((left, right) => right[1][0].length - left[1][0].length)
    .slice(0, 3)
    .map(([pattern, [source]]) => ({ patternChars: pattern.length, sourceChars: source.length })),
}, null, 2))
