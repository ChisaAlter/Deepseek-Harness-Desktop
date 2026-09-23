/**
 * Same as the coverage probe, but pre-exec each cached RegExp before the fence.
 * If V8's lazy compile is the cost, the fence should collapse to a few ms.
 * argv[2] = "noexec" | "exec"
 */
import { performance } from 'node:perf_hooks'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const mode = process.argv[2] ?? 'noexec'
const cache = new Map()
let execMs = 0
for (const [pattern, [source, flags]] of HIGHLIGHT_PATTERN_TABLE) {
  const regex = new RegExp(source, flags)
  if (mode === 'exec') {
    const at = performance.now()
    regex.lastIndex = 0
    regex.exec('const answer: number = 42')
    execMs += performance.now() - at
  }
  cache.set(pattern, regex)
}

const misses = []
const inner = createJavaScriptRegexEngine({
  forgiving: true,
  cache,
  regexConstructor(pattern) {
    misses.push(pattern.slice(0, 40))
    return defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY })
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine: inner })

const fences = [
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }',
]
const out = []
for (const code of fences) {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  out.push(Number((performance.now() - at).toFixed(2)))
}

console.log(JSON.stringify({ mode, execMs: Number(execMs.toFixed(2)), misses: misses.length, fences: out }))
