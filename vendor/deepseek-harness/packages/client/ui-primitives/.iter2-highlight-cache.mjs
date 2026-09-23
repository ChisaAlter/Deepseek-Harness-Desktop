/**
 * Split the first-use highlighter cost into "regex compilation" and
 * "everything else" by sharing one regex cache across two fresh highlighters.
 *
 * Instance A pays both parts once. Instance B is a brand-new highlighter
 * (new grammar registry, new scanners) but reuses A's compiled pattern cache,
 * so timing B's first tokenization isolates the non-compilation remainder. If
 * that remainder is inside the 50 ms budget, a worker that only ships compiled
 * patterns back to the main thread removes the long task; if it is not, the
 * worker must own tokenization itself.
 */
import { performance } from 'node:perf_hooks'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const sharedCache = new Map()

function engine() {
  return createJavaScriptRegexEngine({
    forgiving: true,
    cache: sharedCache,
    regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    }),
  })
}

const theme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

const warmups = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

function fresh(label) {
  const constructStart = performance.now()
  const instance = createHighlighterCoreSync({
    themes: [theme],
    langs: [langTs, langBash, langJson],
    engine: engine(),
  })
  const constructMs = performance.now() - constructStart
  const firstStart = performance.now()
  for (const sample of warmups) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: 'css-variables',
      tokenizeTimeLimit: 0,
    })
  }
  return {
    label,
    constructMs: Number(constructMs.toFixed(2)),
    firstTokenizeMs: Number((performance.now() - firstStart).toFixed(2)),
    cachedPatterns: sharedCache.size,
  }
}

const result = { runs: [fresh('cold-cache'), fresh('warm-cache')] }
console.log(JSON.stringify(result, null, 2))
