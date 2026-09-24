import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import VisionFallback from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

it('applies the Models vision route through live configuration without remounting', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const live = await liveConfig(ctx, VisionFallback, { maxOutputTokens: 128, timeoutMs: 1000 })
  const fiber = live.fiber
  expect(ctx.visionFallback.selection()).toBeUndefined()

  await live.update({ provider: 'mock', model: 'vision' })
  expect(live.entry.fiber).toBe(fiber)
  expect(ctx.visionFallback.selection()).toEqual({ provider: 'mock', model: 'vision' })

  await live.replace({ maxOutputTokens: 128, timeoutMs: 1000 })
  expect(live.entry.fiber).toBe(fiber)
  expect(ctx.visionFallback.configured()).toBe(false)
})
