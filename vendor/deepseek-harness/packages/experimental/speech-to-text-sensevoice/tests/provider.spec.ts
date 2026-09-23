/** Provider activation remains lazy and rejects relative deployment paths. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { SenseVoiceWorker } from '../src/recognizer.ts'

afterEach(() => { vi.restoreAllMocks() })

it.each(['int8', 'fp32'] as const)('registers %s lazily and joins inference before withdrawal completes', async (precision) => {
  const ctx = new Context()
  try {
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(SpeechToText, { defaultProvider: 'sensevoice-local', language: 'auto' })
    const transcribe = vi.spyOn(SenseVoiceWorker.prototype, 'transcribe')
    const fiber = ctx.plugin(Provider, { dataRoot: process.cwd(), precision })
    await fiber
    expect(transcribe).not.toHaveBeenCalled()
    const speech = ctx.get('speechToText')!
    expect(speech.listProviders()).toMatchObject([{ id: 'sensevoice-local', location: 'host-local', languages: ['auto', 'zh', 'en', 'yue', 'ja', 'ko'] }])
    expect(speech.listProviders()[0]?.setupEstimate).toEqual({
      recommendedDiskBytes: precision === 'int8' ? 1e9 : 2e9, expectedMemoryBytes: precision === 'int8' ? 1e9 : 2e9,
      minimumMinutes: 1, maximumMinutes: 10,
    })
    await expect(speech.transcribe(speech.resolve({ audio: new Uint8Array() }), new AbortController().signal)).rejects.toThrow('Prepare')
    transcribe.mockResolvedValue({ text: 'hello', audioSeconds: 1, inferenceSeconds: 0.1 })
    expect((await speech.transcribe(speech.resolve({ audio: new Uint8Array() }), new AbortController().signal)).text).toBe('hello')
    await fiber.dispose()
    expect(speech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('refuses relative runtime, model and cache paths before registration', () => {
  for (const field of ['dataRoot', 'modelDirectory', 'vadModelPath']) {
    expect(() => { Provider.apply(new Context(), Provider.Config({ dataRoot: process.cwd(), [field]: 'relative' })) })
      .toThrow('absolute')
  }
  expect(() => Provider.Config({ dataRoot: process.cwd(), threads: 0 })).toThrow()
})
