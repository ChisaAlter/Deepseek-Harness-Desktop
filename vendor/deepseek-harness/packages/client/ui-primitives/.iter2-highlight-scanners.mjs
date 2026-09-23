/**
 * Break the first-highlighter long task down by *scanner* rather than by stage.
 *
 * vscode-textmate asks the engine for one scanner per rule set, and each
 * scanner compiles its whole pattern list in one synchronous `map`. This probe
 * wraps the real engine so it can report, per scanner, how many patterns were
 * compiled, how long that scanner took, and what the slowest single pattern
 * cost. The answer decides whether the boot warm-up can be split across tasks
 * at all, or whether an indivisible long task remains.
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

let compiling = 0
const scanners = []

function regexConstructor(pattern) {
  const started = performance.now()
  const regex = defaultJavaScriptRegexConstructor(pattern, {
    ...(MODE === 'eager' ? { lazyCompileLength: Number.POSITIVE_INFINITY } : {}),
  })
  const elapsed = performance.now() - started
  if (compiling !== 0) {
    const record = scanners[scanners.length - 1]
    record.regexCount += 1
    record.regexMs += elapsed
    record.slowest = Math.max(record.slowest, elapsed)
  }
  return regex
}

const base = createJavaScriptRegexEngine({ forgiving: true, regexConstructor })
const engine = {
  createString: value => base.createString(value),
  createScanner(patterns) {
    const record = { patterns: patterns.length, regexCount: 0, regexMs: 0, slowest: 0, totalMs: 0 }
    scanners.push(record)
    compiling += 1
    const started = performance.now()
    const scanner = base.createScanner(patterns)
    record.totalMs = performance.now() - started
    compiling -= 1
    return scanner
  },
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

const round = label => {
  const before = scanners.length
  const started = performance.now()
  for (const sample of warmups) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: 'css-variables',
      tokenizeTimeLimit: 0,
    })
  }
  return {
    label,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    newScanners: scanners.slice(before).map(entry => ({
      patterns: entry.patterns,
      regexCount: entry.regexCount,
      regexMs: Number(entry.regexMs.toFixed(2)),
      slowestPatternMs: Number(entry.slowest.toFixed(2)),
      scannerMs: Number(entry.totalMs.toFixed(2)),
    })),
  }
}

const start = performance.now()
const instance = createHighlighterCoreSync({
  themes: [theme],
  langs: [langTs, langBash, langJson],
  engine,
})
const constructMs = performance.now() - start

const result = {
  mode: MODE,
  constructMs: Number(constructMs.toFixed(2)),
  rounds: [round('first'), round('second')],
}

const all = result.rounds[0].newScanners
result.firstRoundScannerMs = Number(all.reduce((sum, entry) => sum + entry.scannerMs, 0).toFixed(2))
result.firstRoundMaxScannerMs = Number(Math.max(...all.map(entry => entry.scannerMs)).toFixed(2))
result.firstRoundMaxPatternMs = Number(Math.max(...all.map(entry => entry.slowestPatternMs)).toFixed(2))
result.firstRoundScannerCount = all.length
console.log(JSON.stringify(result, null, 2))
