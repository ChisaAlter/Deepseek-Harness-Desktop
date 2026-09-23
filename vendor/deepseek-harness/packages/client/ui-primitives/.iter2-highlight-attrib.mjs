/**
 * Attribute the highlighter's first-tokenize cost precisely: translation time
 * inside the regex constructor vs. regeneration (V8 compile) at first exec.
 */
import { performance } from 'node:perf_hooks'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })

function run(label, factory) {
  const timings = []
  const engine = createJavaScriptRegexEngine({
    forgiving: true,
    cache: new Map(),
    regexConstructor(pattern) {
      const at = performance.now()
      const regex = factory(pattern)
      timings.push({ pattern, ms: performance.now() - at, regex })
      return regex
    },
  })
  const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })
  const constructTotal = timings.reduce((sum, entry) => sum + entry.ms, 0)
  const before = timings.length
  const at = performance.now()
  instance.codeToTokens('const answer: number = 42', {
    lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0,
  })
  const tokenizeMs = performance.now() - at
  console.log(JSON.stringify({
    label,
    totalPatterns: timings.length,
    patternsAtConstruct: before,
    translationMs: Number(constructTotal.toFixed(2)),
    maxTranslationMs: Number(Math.max(...timings.map(entry => entry.ms)).toFixed(2)),
    firstTokenizeMs: Number(tokenizeMs.toFixed(2)),
  }))
  return timings
}

const eager = run('lazyCompileLength=Infinity', pattern => defaultJavaScriptRegexConstructor(pattern, {
  lazyCompileLength: Number.POSITIVE_INFINITY,
}))
const defaults = run('shiki default', pattern => defaultJavaScriptRegexConstructor(pattern))

// Does pre-executing the compiled regexes move the cost out of tokenize?
const at = performance.now()
for (const entry of eager) entry.regex.exec('')
console.log(JSON.stringify({
  label: 'preExecAll',
  ms: Number((performance.now() - at).toFixed(2)),
}))
const at2 = performance.now()
for (const entry of defaults) entry.regex.exec('')
console.log(JSON.stringify({
  label: 'preExecAll_default',
  ms: Number((performance.now() - at2).toFixed(2)),
}))
