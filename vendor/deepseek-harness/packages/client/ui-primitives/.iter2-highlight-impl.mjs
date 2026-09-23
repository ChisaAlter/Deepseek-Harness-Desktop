/**
 * Measure the shipped warm-up: import the real module, call warmHighlighter(),
 * and time every task it schedules plus the first real fence afterwards.
 */
import { performance } from 'node:perf_hooks'
import { warmHighlighter } from './src/markdown/highlight.ts'

const tasks = []
const originalSetTimeout = globalThis.setTimeout

// The module falls back to setTimeout where the Scheduler API is absent; wrap it
// to attribute each scheduled task.
globalThis.setTimeout = (callback, delay, ...args) => {
  const wrapped = typeof callback === 'function'
    ? () => {
      const at = performance.now()
      callback(...args)
      tasks.push(Number((performance.now() - at).toFixed(2)))
    }
    : callback
  return originalSetTimeout(wrapped, delay)
}

const at = performance.now()
warmHighlighter()
const importAndScheduleMs = Number((performance.now() - at).toFixed(2))

await new Promise(resolve => originalSetTimeout(resolve, 500))

globalThis.setTimeout = originalSetTimeout

console.log(JSON.stringify({
  importAndScheduleMs,
  tasks,
  maxTaskMs: Number(Math.max(...tasks).toFixed(2)),
  totalWarmMs: Number(tasks.reduce((sum, ms) => sum + ms, 0).toFixed(2)),
}))
