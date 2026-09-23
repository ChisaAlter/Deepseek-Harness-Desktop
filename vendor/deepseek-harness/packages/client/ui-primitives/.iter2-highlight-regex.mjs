/**
 * Split the post-table TS first-tokenize cost: `new RegExp` construction vs.
 * V8's lazily triggered compile at first `exec`. If first-exec dominates, the
 * cost can be paid in bounded chunks ahead of the fence instead of inside one
 * long task.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'

const table = new Map(Object.entries(JSON.parse(
  readFileSync(new URL('./.iter2-pattern-table.json', import.meta.url), 'utf8'),
)))

const sample = 'const answer: number = 42'
const construct = []
const firstExec = []
const regexes = []

let at = performance.now()
for (const [pattern, [source, flags]] of table) {
  const start = performance.now()
  const regex = new RegExp(source, flags)
  construct.push({ patternLength: pattern.length, ms: performance.now() - start })
  regexes.push([pattern, regex])
}
const constructTotal = performance.now() - at

at = performance.now()
for (const [pattern, regex] of regexes) {
  const start = performance.now()
  regex.lastIndex = 0
  regex.exec(sample)
  firstExec.push({ patternLength: pattern.length, ms: performance.now() - start })
}
const firstExecTotal = performance.now() - at

const top = (list, key) => [...list].sort((left, right) => right.ms - left.ms).slice(0, 5)
  .map(entry => ({ [key]: entry.patternLength, ms: Number(entry.ms.toFixed(2)) }))

console.log(JSON.stringify({
  patterns: table.size,
  constructTotalMs: Number(constructTotal.toFixed(2)),
  constructMaxMs: Number(Math.max(...construct.map(entry => entry.ms)).toFixed(2)),
  firstExecTotalMs: Number(firstExecTotal.toFixed(2)),
  firstExecMaxMs: Number(Math.max(...firstExec.map(entry => entry.ms)).toFixed(2)),
  firstExecTop: top(firstExec, 'patternLength'),
  constructTop: top(construct, 'patternLength'),
}, null, 2))
