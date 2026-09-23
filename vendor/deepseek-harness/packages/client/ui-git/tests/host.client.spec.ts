import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('ui-git host', () => {
  it('defaults and validates the titlebar Git visibility preference', () => {
    expect(Config({}).titlebarGit.get()).toBe(true)
    expect(Config({ titlebarGit: false }).titlebarGit.get()).toBe(false)
    expect(() => Config({ titlebarGit: 'no' as never })).toThrow()
  })
})
