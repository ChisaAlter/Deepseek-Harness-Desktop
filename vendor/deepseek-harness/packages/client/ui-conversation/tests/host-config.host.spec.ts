import { describe, expect, it } from 'vitest'
import { isVolatilePath } from '../../../settings/settings/src/schema.ts'
import { Config } from '../src/index.ts'
import { ConversationSettingsFields } from '../src/submission-settings.ts'

describe('conversation Host configuration', () => {
  it('accepts live writes for every preference exposed by the browser form', () => {
    const fields = Object.keys(ConversationSettingsFields)
    expect(Object.keys(Config.dict ?? {})).toEqual(fields)
    for (const field of fields) expect(isVolatilePath(Config, [field])).toBe(true)
  })
})
