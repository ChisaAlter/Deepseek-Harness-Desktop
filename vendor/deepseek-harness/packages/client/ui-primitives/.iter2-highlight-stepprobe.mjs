/**
 * Is the post-warm first fence really ~70 ms of scanning, or does it shrink as
 * more distinct text is tokenized? Tokenize several never-seen fences in order
 * and report each.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const cache = new Map()
for (const [pattern, [source, flags]] of table) {
  const regex = new RegExp(source, flags)
  regex.lastIndex = 0
  regex.exec('let a: number = 1')
  regex.lastIndex = 0
  regex.exec('')
  cache.set(pattern, regex)
}

const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine })

const codes = [
  'let a: number = 1',
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }',
  'class Box<T> { read(): T { return this.value } }',
  'import { x } from "mod" // comment',
  'const re = /ab+c/gi; const n = 100n;',
  'type M = Map<string, Array<number>>',
  'enum Color { Red = 1, Blue }',
  'async function load(): Promise<void> { await fetch("/api") }',
  'export default class Service { async run(): Promise<void> {} }',
]

const out = codes.map((code) => {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  return { code: code.slice(0, 32), ms: Number((performance.now() - at).toFixed(2)) }
})

console.log(JSON.stringify(out, null, 2))
