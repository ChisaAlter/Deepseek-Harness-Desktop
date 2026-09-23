/**
 * End state: let the real `warmHighlighter()` run to completion, then measure
 * never-seen fences through the real module. This is the number the decision
 * record reports for "first visible code after an on-demand warm-up".
 */
import { performance } from 'node:perf_hooks'
import { highlightToHtml } from './src/markdown/highlight.ts'
import { warmHighlighter } from './src/markdown/highlight.ts'

const started = performance.now()
warmHighlighter()
const callMs = Number((performance.now() - started).toFixed(2))

// Let every scheduled slice run. Node needs real macrotasks for the timers.
await new Promise(resolve => { setTimeout(resolve, 400) })

const FENCES = [
  ['typescript', 'export function greet(name: string): string { return `hi ${name}` }'],
  ['typescript', 'interface User { id: number; tags: string[] }'],
  ['typescript', 'const xs = [1, 2, 3].map(x => x * 2)\nfor (const x of xs) console.log(x)'],
  ['typescript', 'class Service extends Base implements Api { #v = 0 }'],
  ['typescript', 'async function load<T>(url: string): Promise<T | null> { await fetch(url); return null }'],
  ['shellscript', 'find . -name "*.ts" -print0 | xargs -0 wc -l'],
  ['json', '{"users":[{"id":1,"name":"a"},{"id":2}],"ok":false}'],
]

const results = FENCES.map(([lang, code]) => {
  const at = performance.now()
  const html = highlightToHtml(code, lang)
  return { lang, ms: Number((performance.now() - at).toFixed(2)), highlighted: html !== undefined }
})

console.log(JSON.stringify({
  warmCallMs: callMs,
  results,
  maxMs: Math.max(...results.map(entry => entry.ms)),
}, null, 2))
