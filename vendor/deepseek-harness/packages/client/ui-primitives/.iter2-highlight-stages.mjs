/**
 * Attribution of the first-highlighter long task into individually timed stages.
 *
 * Run from the Harness root so the shiki imports resolve:
 *   node <this file>
 * The harness re-imports shiki directly rather than the client module so it can
 * instrument `createJavaScriptRegexEngine`'s regex constructor per pattern.
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

const MODE = process.argv[2] ?? 'eager'

/** Per-pattern compile samples collected through the engine's constructor hook. */
const compileSamples = []
let compileTotal = 0

function constructorFor(pattern) {
  const started = performance.now()
  const regex = defaultJavaScriptRegexConstructor(pattern, {
    ...(MODE === 'eager' ? { lazyCompileLength: Number.POSITIVE_INFINITY } : {}),
  })
  const elapsed = performance.now() - started
  compileTotal += elapsed
  compileSamples.push({ length: pattern.length, elapsed })
  return regex
}

const stages = []
function stage(label, run) {
  const started = performance.now()
  const value = run()
  stages.push({ label, elapsed: performance.now() - started })
  return value
}

const theme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

const engine = stage('engine', () => createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: constructorFor,
}))

const instance = stage('highlighterCoreSync', () => createHighlighterCoreSync({
  themes: [theme],
  langs: [langTs, langBash, langJson],
  engine,
}))

const warmups = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
]

for (const sample of warmups) {
  stage(`warmup:${sample.lang}`, () => instance.codeToTokens(sample.code, {
    lang: sample.lang,
    theme: 'css-variables',
    tokenizeTimeLimit: 0,
  }))
}

compileSamples.sort((left, right) => right.elapsed - left.elapsed)
const report = {
  mode: MODE,
  stages: stages.map(entry => ({ label: entry.label, elapsedMs: Number(entry.elapsed.toFixed(2)) })),
  // `stages` overlaps `compileTotal` inside the engine/warmup stages; publish both
  // so the summary never adds them together by mistake.
  regexCompile: {
    patterns: compileSamples.length,
    totalMs: Number(compileTotal.toFixed(2)),
    slowest: compileSamples.slice(0, 5).map(entry => ({
      patternLength: entry.length,
      elapsedMs: Number(entry.elapsed.toFixed(2)),
    })),
  },
  stageSumMs: Number(stages.reduce((sum, entry) => sum + entry.elapsed, 0).toFixed(2)),
}
console.log(JSON.stringify(report, null, 2))
