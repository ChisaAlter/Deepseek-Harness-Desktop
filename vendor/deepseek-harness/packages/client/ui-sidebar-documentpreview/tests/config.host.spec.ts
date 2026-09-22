/** Host configuration supplies bounded Office reuse settings to browser pages. */
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { expect, it, onTestFinished } from 'vitest'
import { Config } from '../src/config.ts'
import * as host from '../src/index.ts'

it('exposes only Client reuse limits on the Host entry', () => {
  expect(host.Config).toBe(Config)
  expect(Config({})).toEqual({ office: {
    maxCachedEntries: 8, maxCachedBytes: 64 * 1024 * 1024, maxPending: 8, maxReaders: 32,
  } })
  for (const key of ['maxCachedEntries', 'maxCachedBytes']) expect(() => Config({ office: { [key]: 0 } })).toThrow()
})

it('embeds YAML cache settings in browser pages and withdraws them on disposal', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const config = Config({ office: { maxCachedEntries: 2 } })
  const fiber = ctx.plugin(host, config)
  await fiber.await()
  const rows: IndexInjection[] = []
  ctx.emit('webserver/index-inject', rows)
  expect(rows).toEqual([{ kind: 'global', name: '__DSH_DOCUMENT_PREVIEW_CONFIG__', value: config }])
  await fiber.dispose()
  const after: IndexInjection[] = []
  ctx.emit('webserver/index-inject', after)
  expect(after).toEqual([])
})
