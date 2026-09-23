/**
 * Is the highlighter's one-off cost *translation* (Oniguruma → JS source,
 * precomputable at build time) or *RegExp construction* (only payable in the
 * browser)?
 *
 * If translation dominates, the fix is a generated table of translated
 * pattern sources: the client then builds the same regexes from strings with
 * no long task, and no Worker, CSP, or packaging change is needed.
 */
import { performance } from 'node:perf_hooks'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

/** Collect every pattern the boot grammars ask for, with translation timings. */
const translated = new Map()
let translateMs = 0
const base = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const started = performance.now()
    const regex = defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    })
    translateMs += performance.now() - started
    translated.set(pattern, { source: regex.source, flags: regex.flags })
    return regex
  },
})

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const warmups = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

const cold = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine: base })
for (const sample of warmups) {
  cold.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
}

/** Now build the same regexes straight from the precomputed sources. */
let constructMs = 0
let mismatches = 0
for (const [pattern, { source, flags }] of translated) {
  const started = performance.now()
  const regex = new RegExp(source, flags)
  constructMs += performance.now() - started
  if (regex.source !== source) mismatches += 1
  if (!translated.has(pattern)) mismatches += 1
}

const replayEngine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const entry = translated.get(pattern)
    if (entry === undefined) return defaultJavaScriptRegexConstructor(pattern)
    return new RegExp(entry.source, entry.flags)
  },
})
const replayStart = performance.now()
const replay = createHighlighterCoreSync({
  themes: [theme],
  langs: [langTs, langBash, langJson],
  engine: replayEngine,
})
for (const sample of warmups) {
  replay.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
}
const replayMs = performance.now() - replayStart

console.log(JSON.stringify({
  patterns: translated.size,
  translateMs: Number(translateMs.toFixed(1)),
  constructAllMs: Number(constructMs.toFixed(1)),
  mismatches,
  // The number that matters: first tokenization with a precomputed source table.
  replayFirstTokenizeMs: Number(replayMs.toFixed(1)),
}, null, 2))
