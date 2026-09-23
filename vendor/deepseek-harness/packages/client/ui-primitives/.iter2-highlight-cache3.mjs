/**
 * The scanner reuses RegExp instances from the engine's cache Map. Pre-populate
 * that Map, warm the instances in bounded chunks, then measure the residual
 * first tokenize of a *fresh* sample per grammar.
 * argv[2] = "nowarm" | "warmempty" | "warmsample"
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

const mode = process.argv[2]
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

// Grammar boundaries inside the shared table, for chunked warm-up.
const boundaries = JSON.parse(readFileSync(
  new URL('./.iter2-pattern-boundaries.json', import.meta.url), 'utf8',
))

const cache = new Map()
for (const [pattern, [source, flags]] of table) cache.set(pattern, new RegExp(source, flags))

const chunkTimes = []
if (mode !== 'nowarm') {
  const warmText = mode === 'warmsample'
    ? { typescript: 'let total: number = items.length + 1', shellscript: 'echo "$PATH" | grep bin', json: '{"a":[1,2]}' }
    : { typescript: '', shellscript: '', json: '' }
  for (const [lang, patterns] of Object.entries(boundaries)) {
    const text = warmText[lang]
    const size = 40
    for (let index = 0; index < patterns.length; index += size) {
      const at = performance.now()
      for (const pattern of patterns.slice(index, index + size)) {
        const regex = cache.get(pattern)
        regex.lastIndex = 0
        regex.exec(text)
      }
      chunkTimes.push({ lang, size: Math.min(size, patterns.length - index), ms: Number((performance.now() - at).toFixed(2)) })
    }
  }
}

const engine = createJavaScriptRegexEngine({ forgiving: true, cache })
const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const instance = createHighlighterCoreSync({ themes: [theme], langs: [langTs, langBash, langJson], engine })

// Fresh samples: never tokenized before in this process.
const fresh = [
  { lang: 'typescript', code: 'export function greet(name: string): string { return `hi ${name}` }' },
  { lang: 'shellscript', code: 'for file in *.txt; do wc -l "$file"; done' },
  { lang: 'json', code: '{"nested":{"ok":true,"items":[1,2,3]}}' },
]

const out = []
for (const sample of fresh) {
  const at = performance.now()
  instance.codeToTokens(sample.code, { lang: sample.lang, theme: 'css-variables', tokenizeTimeLimit: 0 })
  out.push({ lang: sample.lang, firstTokenizeMs: Number((performance.now() - at).toFixed(2)) })
}

console.log(JSON.stringify({
  mode,
  totalWarmMs: Number(chunkTimes.reduce((sum, entry) => sum + entry.ms, 0).toFixed(2)),
  maxChunkMs: Number((chunkTimes.length ? Math.max(...chunkTimes.map(e => e.ms)) : 0).toFixed(2)),
  chunks: chunkTimes.length,
  freshTokenize: out,
  maxFreshTaskMs: Number(Math.max(...out.map(entry => entry.firstTokenizeMs)).toFixed(2)),
}))
