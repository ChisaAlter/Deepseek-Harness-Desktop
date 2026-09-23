/**
 * Final ⑧ design probe: precompiled pattern table + cache pre-population +
 * sliced pre-execution + budgeted per-grammar tokenize. Reports every task the
 * warm-up runs and the residual cost of a never-seen fence afterwards.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const slice = Number(process.argv[2] ?? 24)
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const ORDER = ['typescript', 'shellscript', 'json']
const SAMPLES = {
  typescript: Array.from({ length: 8 }, (_, i) => `const value${String(i)}: number = ${String(i)} + 1`).join('\n'),
  shellscript: Array.from({ length: 8 }, (_, i) => `echo "line ${String(i)}" | grep line`).join('\n'),
  json: Array.from({ length: 8 }, (_, i) => `{"key${String(i)}":${String(i)},"ok":true}`).join('\n'),
}

const tasks = []
const cache = new Map()
const entries = [...table.entries()]

// Phase 1: build and pre-compile the RegExp objects in slices.
for (let index = 0; index < entries.length; index += slice) {
  const at = performance.now()
  for (const [pattern, [source, flags]] of entries.slice(index, index + slice)) {
    const regex = new RegExp(source, flags)
    regex.lastIndex = 0
    regex.exec('')
    cache.set(pattern, regex)
  }
  tasks.push({ label: `precompile${String(index / slice)}`, ms: Number((performance.now() - at).toFixed(2)) })
}

// Phase 2: per grammar, tokenize with a small budget until it converges.
const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

for (const lang of ORDER) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const at = performance.now()
    instance.codeToTokens(SAMPLES[lang], { lang, theme: 'css-variables', tokenizeTimeLimit: 12 })
    const ms = performance.now() - at
    tasks.push({ label: `${lang}#${String(attempt)}`, ms: Number(ms.toFixed(2)) })
    if (ms < 2) break
  }
}

// Residual: structurally different, never tokenized fences.
const fences = [
  ['typescript', 'export function greet(name: string): string { return `hi ${name}` }'],
  ['typescript', 'interface User { id: number; tags: string[] }\nclass Box<T> { #v: T }'],
  ['shellscript', 'find . -name "*.ts" -print0 | xargs -0 wc -l'],
  ['json', '{"users":[{"id":1,"name":"a"},{"id":2}],"ok":false}'],
]
const residual = []
for (const [lang, code] of fences) {
  const at = performance.now()
  instance.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  residual.push({ lang, ms: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  slice,
  taskCount: tasks.length,
  maxTaskMs: Number(Math.max(...tasks.map(task => task.ms)).toFixed(2)),
  warmTotalMs: Number(tasks.reduce((sum, task) => sum + task.ms, 0).toFixed(2)),
  topTasks: [...tasks].sort((a, b) => b.ms - a.ms).slice(0, 4),
  residual,
  maxResidualMs: Number(Math.max(...residual.map(entry => entry.ms)).toFixed(2)),
}, null, 2))
