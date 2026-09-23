/**
 * Final design check. Precompile the pattern table, then warm in bounded
 * chunks: per grammar, tokenize a tiny sample (builds that grammar's scanners)
 * and pre-exec its RegExps in small slices. Afterwards measure structurally
 * different, never-seen fences -- the case a single warm sample does not cover.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))
const boundaries = JSON.parse(readFileSync(
  new URL('./.iter2-pattern-boundaries.json', import.meta.url), 'utf8',
))

const instances = []
const engine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: new Map(),
  regexConstructor(pattern) {
    const entry = table.get(pattern)
    if (entry === undefined) throw new Error(`missing table entry: ${pattern.slice(0, 32)}`)
    const regex = new RegExp(entry[0], entry[1])
    instances.push({ pattern, regex })
    return regex
  },
})
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const highlighter = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

const samples = {
  typescript: 'let a: number = 1',
  shellscript: 'echo hi',
  json: '{"a":1}',
}
const SLICE = Number(process.argv[2] ?? 40)
const chunks = []
for (const lang of ['typescript', 'shellscript', 'json']) {
  const before = instances.length
  const at = performance.now()
  highlighter.codeToTokens(samples[lang], { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  chunks.push({ label: `${lang}:scan`, ms: Number((performance.now() - at).toFixed(2)) })

  const mine = instances.slice(before)
  for (let index = 0; index < mine.length; index += SLICE) {
    const at2 = performance.now()
    for (const entry of mine.slice(index, index + SLICE)) {
      entry.regex.lastIndex = 0
      entry.regex.exec(samples[lang])
    }
    chunks.push({ label: `${lang}:exec${String(index / SLICE)}`, ms: Number((performance.now() - at2).toFixed(2)) })
  }
}

// Never-seen fences, structurally different from every warm sample.
const fences = [
  'export function greet(name: string): string { return `hi ${name}` }',
  'interface User { id: number; tags: string[] }\nconst u: User = { id: 1, tags: [] }',
  'class Box<T> { constructor(private readonly value: T) {} get(): T { return this.value } }',
  'type R = Record<string, () => Promise<void>>',
]
const fenceTimes = []
for (const code of fences) {
  const at = performance.now()
  highlighter.codeToTokens(code, { lang: 'typescript', theme: 'css-variables', tokenizeTimeLimit: 0 })
  fenceTimes.push(Number((performance.now() - at).toFixed(2)))
}

// Shell and JSON fences too, since both are boot grammars.
const other = []
for (const [lang, code] of [['shellscript', 'find . -name "*.ts" -print0 | xargs -0 wc -l'], ['json', '{"users":[{"id":1,"name":"a"},{"id":2}]}']]) {
  const at = performance.now()
  highlighter.codeToTokens(code, { lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  other.push({ lang, ms: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  chunks,
  warmChunks: chunks.length,
  maxWarmChunkMs: Number(Math.max(...chunks.map(chunk => chunk.ms)).toFixed(2)),
  warmTotalMs: Number(chunks.reduce((sum, chunk) => sum + chunk.ms, 0).toFixed(2)),
  patternCount: boundaries.typescript.length + boundaries.shellscript.length + boundaries.json.length,
  tsFences: fenceTimes,
  maxTsFenceMs: Math.max(...fenceTimes),
  other,
  maxTaskMs: Number(Math.max(
    ...chunks.map(chunk => chunk.ms), ...fenceTimes, ...other.map(entry => entry.ms),
  ).toFixed(2)),
}, null, 2))
