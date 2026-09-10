/** Host budget decisions use controlled clocks and ELU samples; worker execution and binding transport stay real. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkerThreadCodeRuntime } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import type { CodeRunResult } from '@deepseek-ai/dsh-code-runtime'

const meter = vi.hoisted(() => ({ sample: vi.fn() }))

vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>()
  return {
    ...original,
    Worker: class extends original.Worker {
      constructor(...args: ConstructorParameters<typeof original.Worker>) {
        super(...args)
        this.performance.eventLoopUtilization = meter.sample
      }
    },
  }
})

describe('worker budgets with controlled ELU samples and real binding transport', () => {
  let ctx: Context
  let controller: AbortController
  let run: Promise<CodeRunResult> | undefined
  let release: (() => void) | undefined

  beforeEach(() => {
    ctx = new Context()
    controller = new AbortController()
    run = undefined
    release = undefined
    meter.sample.mockReset().mockReturnValue({ active: 10, idle: 0, utilization: 1 })
    // Worker bootstrap and scheduling contribute to ELU active time; only the
    // measured input and host deadlines are controlled, not worker execution.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  })

  afterEach(async () => {
    const owned = { ctx, controller, run, release }
    try {
      owned.controller.abort('test cleanup')
      owned.release?.()
    } finally {
      vi.useRealTimers()
    }
    try {
      await owned.run
    } finally {
      await owned.ctx.fiber.dispose()
    }
  })

  async function pendingBinding(): Promise<void> {
    await ctx.plugin(WorkerThreadCodeRuntime, { computeMs: 1_000, maxWallMs: 30_000 })
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const binding = new Promise<string>((resolve) => { release = () => { resolve('slow-done') } })
    run = ctx.codeRuntime.run({
      program: 'return await tools.slow({})',
      bindings: [{ global: 'tools', functions: { slow: () => { entered(); return binding } } }],
      signal: controller.signal,
    })
    await Promise.race([
      ready,
      run.then((result) => { throw new Error('Worker settled before binding entry: ' + JSON.stringify(result)) }),
    ])
  }

  it('does not charge a binding wait longer than the compute budget', async () => {
    await pendingBinding()
    const settled = vi.fn()
    void run!.then(settled, settled)
    meter.sample.mockReturnValue({ active: 10, idle: 1_500, utilization: 10 / 1_510 })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(meter.sample).toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    release!()
    expect(await run).toEqual({ logs: [], value: 'slow-done' })
  })

  it('expires active time even while a binding is pending', async () => {
    await pendingBinding()
    meter.sample.mockReturnValue({ active: 1_001, idle: 1_500, utilization: 1_001 / 2_501 })
    await vi.advanceTimersByTimeAsync(25)
    expect(await run).toEqual({ logs: [], error: { kind: 'timeout', message: 'compute budget exhausted (1000ms busy)' } })
  })

  it('expires the wall ceiling while active time remains below the compute budget', async () => {
    await pendingBinding()
    meter.sample.mockReturnValue({ active: 10, idle: 30_000, utilization: 10 / 30_010 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await run).toEqual({ logs: [], error: { kind: 'timeout', message: 'wall-clock ceiling reached (30000ms)' } })
  })
})
