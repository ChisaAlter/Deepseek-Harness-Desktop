import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('ui-titlebar host', () => {
  it('defaults and validates panel-toggle visibility preferences', () => {
    const defaults = Config({})
    expect([defaults.terminalToggle.get(), defaults.surfacesToggle.get()]).toEqual([true, true])
    const disabled = Config({ terminalToggle: false, surfacesToggle: false })
    expect([disabled.terminalToggle.get(), disabled.surfacesToggle.get()]).toEqual([false, false])
    expect(() => Config({ terminalToggle: 'no' as never })).toThrow()
    expect(() => Config({ surfacesToggle: 'no' as never })).toThrow()
  })
})
