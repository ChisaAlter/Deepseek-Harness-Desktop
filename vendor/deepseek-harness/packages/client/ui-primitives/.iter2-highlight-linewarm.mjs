/**
 * Warm-up shape: precompiled table + one *tokenize call per line* so each task
 * stays small, then measure never-seen fences. Compares per-line warm-up
 * against a single unbudgeted tokenize of the same sample.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const mode = process.argv[2] ?? 'lines'
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const LINES = {
  typescript: [
    'const answer: number = 42',
    'export function greet(name: string): string { return `hi ${name}` }',
    'interface User { id: number; tags: string[] }',
    'class Box<T> { read(): T { return this.value } }',
    'import { x } from "mod" // comment',
    'const re = /ab+c/gi; const n = 100n;',
  ],
  shellscript: ['echo "$HOME"', 'for f in *.txt; do wc -l "$f"; done', 'find . -name "*.ts" | xargs wc -l'],
  json: ['{"ready":true}', '{"users":[{"id":1}],"ok":false}'],
}

const cache = new Map()
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache,
  regexConstructor(pattern) {
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    return new RegExp(entry[0], entry[1])
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const tasks = []
for (const [lang, lines] of Object.entries(LINES)) {
  const units = mode === 'lines' ? lines : [lines.join('\n')]
  for (const code of units) {
    const at = performance.now()
    instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
    tasks.push({ label: `${lang}:${code.slice(0, 18)}`, ms: Number((performance.now() - at).toFixed(2)) })
  }
}

const fences = [
  ['typescript', 'export default class Service { async run(): Promise<void> { await this.go() } }'],
  ['typescript', 'type M = Map<string, Array<number>>\nconst m: M = new Map()'],
  ['shellscript', 'while read -r line; do printf "%s\\n" "$line"; done < input.txt'],
  ['json', '{"nested":{"items":[1,2,{"deep":true}]}}'],
]
const residual = []
for (const [lang, code] of fences) {
  const at = performance.now()
  instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  residual.push({ lang, ms: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  mode,
  tasks,
  maxTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  warmTotalMs: Number(tasks.reduce((sum, task) => sum + task.ms, 0).toFixed(2)),
  residual,
  maxResidualMs: Number(Math.max(...residual.map(entry => entry.ms)).toFixed(2)),
}, null, 2))
