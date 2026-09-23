/**
 * Does V8 reuse compiled RegExp code across instances built from the same
 * source+flags? If yes, a bounded pre-exec warm-up pays the per-pattern compile
 * ahead of the fence, and the highlighter's own instances hit that cache.
 * argv[2] = "cold" | "warmed"
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'

const mode = process.argv[2]
const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))
const sample = 'const answer: number = 42'

let warmMs = 0
if (mode === 'warmed') {
  const at = performance.now()
  for (const [, [source, flags]] of table) {
    const regex = new RegExp(source, flags)
    regex.exec(sample)
  }
  warmMs = performance.now() - at
}

const perPattern = []
for (const [, [source, flags]] of table) {
  const regex = new RegExp(source, flags)
  regex.lastIndex = 0
  const at = performance.now()
  regex.exec(sample)
  perPattern.push(performance.now() - at)
}

const total = perPattern.reduce((sum, ms) => sum + ms, 0)
console.log(JSON.stringify({
  mode,
  warmMs: Number(warmMs.toFixed(2)),
  firstExecTotalMs: Number(total.toFixed(2)),
  firstExecMaxMs: Number(Math.max(...perPattern).toFixed(2)),
  over5ms: perPattern.filter(ms => ms > 5).length,
}))
