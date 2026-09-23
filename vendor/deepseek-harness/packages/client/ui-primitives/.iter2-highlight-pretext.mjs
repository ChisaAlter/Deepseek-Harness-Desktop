/**
 * Does the pre-exec text matter? Build every table RegExp, pre-execute it
 * against the chosen text, then measure the first tokenize of a never-seen
 * TypeScript fence. argv[2] = "" | "sample" | "generic"
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const mode = process.argv[2] ?? 'none'
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const texts = {
  none: '',
  sample: 'export function greet(name: string): string { return `hi ${name}` }',
  generic: [
    'const value: number = 42',
    'function f(a) { return a }',
    'interface Box<T> { readonly value: T }',
    'import { x } from "mod"',
    'echo "hello" | grep h',
    '{"key":1,"ok":true}',
    '/* comment */ // line',
  ].join('\n'),
}
const text = texts[mode]

const cache = new Map()
for (const [pattern, [source, flags]] of table) {
  const regex = new RegExp(source, flags)
  regex.lastIndex = 0
  regex.exec(text)
  cache.set(pattern, regex)
}

const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const fences = [
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }\nclass Box<T> { read(): T { return this.#v } }',
  'const xs = [1, 2, 3].map(x => x * 2)\nfor (const x of xs) console.log(x)',
  'async function load(): Promise<void> { await fetch("/api") }',
]

const out = []
for (const code of fences) {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  out.push(Number((performance.now() - at).toFixed(2)))
}

console.log(JSON.stringify({
  mode,
  textChars: text.length,
  fences: out,
  maxMs: Math.max(...out),
}))
