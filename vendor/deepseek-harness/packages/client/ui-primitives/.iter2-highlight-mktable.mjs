/**
 * Build the precompiled pattern table (Oniguruma pattern -> JS RegExp source +
 * flags) for the three boot grammars. This is the shape a build-time generator
 * would ship next to the client bundle.
 */
import { writeFileSync } from 'node:fs'
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

const object = Object.fromEntries(table)
const json = JSON.stringify(object)
writeFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), json)
console.log(JSON.stringify({
  patterns: table.size,
  jsonBytes: Buffer.byteLength(json),
  longestSource: Math.max(...[...table.values()].map(([source]) => source.length)),
  flagsUsed: [...new Set([...table.values()].map(([, flags]) => flags))],
}))
