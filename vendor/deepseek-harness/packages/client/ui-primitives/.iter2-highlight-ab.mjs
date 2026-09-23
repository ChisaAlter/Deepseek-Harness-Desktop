/**
 * One file, one variable: does pre-executing the seeded RegExp objects remove
 * the first-tokenize long task? argv[2] = "seed" | "preexec"
 */
import { performance } from 'node:perf_hooks'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const preexec = process.argv[2] === 'preexec'
const cache = new Map()
for (const [pattern, [source, flags]] of HIGHLIGHT_PATTERN_TABLE) {
  const regex = new RegExp(source, flags)
  if (preexec) {
    regex.lastIndex = 0
    regex.exec('let a: number = 1')
    regex.lastIndex = 0
    regex.exec('')
  }
  cache.set(pattern, regex)
}

const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const measure = (lang, code) => {
  const at = performance.now()
  instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  return Number((performance.now() - at).toFixed(2))
}

const result = {
  preexec,
  warmTs: measure('typescript', 'let a: number = 1'),
  fence1: measure('typescript', 'export function greet(name: string): string { return `hi ${name}` }'),
  fence2: measure('typescript', 'interface User { id: number; tags: string[] }'),
  fence3: measure('typescript', 'class Box<T> { read(): T { return this.value } }'),
  shell: measure('shellscript', 'echo hi'),
  json: measure('json', '{"a":1}'),
}
console.log(JSON.stringify(result))
