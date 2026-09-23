/**
 * Is the first TypeScript fence ~70 ms because shiki builds each grammar rule's
 * scanner lazily as the grammar descends into it? Warm with increasingly varied
 * TypeScript and watch the cost of never-seen fences.
 * argv[2] = "tiny" | "corpus"
 */
import { performance } from 'node:perf_hooks'
import { HIGHLIGHT_PATTERN_TABLE } from './src/markdown/highlight-pattern-table.generated.ts'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'

const mode = process.argv[2] ?? 'tiny'
const cache = new Map()
for (const [pattern, [source, flags]] of HIGHLIGHT_PATTERN_TABLE) {
  const regex = new RegExp(source, flags)
  regex.lastIndex = 0
  regex.exec('let a: number = 1')
  cache.set(pattern, regex)
}

const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs], engine })

const CORPUS = [
  'const answer: number = 42',
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }',
  'class Box<T> { constructor(private readonly value: T) {} get(): T { return this.value } }',
  '// comment\n/* block */\nimport { a, b as c } from "mod"',
  'enum E { A = 1, B }\ntype R = Record<string, () => Promise<void>>',
  'const re = /ab+c/gi\nconst n = 1_000n\nlabel: for (;;) break label',
  'async function load<T>(url: string): Promise<T | null> { await fetch(url); return null }',
  'export default class Service extends Base implements Api { #v = 0; static readonly s = 1 }',
  'switch (x) { case 1: break; default: throw new Error("x") }',
  'try { await go() } catch (error) { console.error(error) } finally { done() }',
  'const obj = { a: 1, b: [2, 3], c: { d: true } } as const satisfies Shape',
  '@decorator()\nexport class D { @prop value!: string }',
  'declare module "x" { export type T = string }',
  'if (a && b || !c) { x ??= y; z ||= w }',
]

const warmTasks = []
if (mode === 'corpus') {
  for (const code of CORPUS) {
    const at = performance.now()
    instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
    warmTasks.push({ code: code.slice(0, 28), ms: Number((performance.now() - at).toFixed(2)) })
  }
} else {
  const at = performance.now()
  instance.codeToTokens('let a: number = 1', { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  warmTasks.push({ code: 'tiny', ms: Number((performance.now() - at).toFixed(2)) })
}

const FENCES = [
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }',
  'const xs = [1, 2, 3].map(x => x * 2)\nfor (const x of xs) console.log(x)',
  'function outer() { return function inner() { return 1 } }',
  'const m = new Map<string, number>([["a", 1]])',
  'export type Handler = (event: Event) => void',
]
const fences = []
for (const code of FENCES) {
  const at = performance.now()
  instance.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  fences.push({ code: code.slice(0, 28), ms: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  mode,
  warmTasks,
  warmMaxMs: Number(Math.max(...warmTasks.map(task => task.ms)).toFixed(2)),
  warmTotalMs: Number(warmTasks.reduce((sum, task) => sum + task.ms, 0).toFixed(2)),
  fences,
  fenceMaxMs: Number(Math.max(...fences.map(fence => fence.ms)).toFixed(2)),
}, null, 2))
