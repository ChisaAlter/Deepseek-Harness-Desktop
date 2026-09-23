/** Public questionnaire options are emitted in the page bootstrap. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config } from '../src/index.ts'
import { CONTACT_CONFIG_GLOBAL } from '../src/contact-config.ts'

it('injects configured contact options and removes the listener on disposal', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const config = Config({ contactSource: 'harness' })
  apply(ctx, config)
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  expect(table).toEqual([{ kind: 'global', name: CONTACT_CONFIG_GLOBAL, value: config }])
  await ctx.fiber.dispose()
  table.length = 0
  ctx.emit('webserver/index-inject', table)
  expect(table).toEqual([])
})
