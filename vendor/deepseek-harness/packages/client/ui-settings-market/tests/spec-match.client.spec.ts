import { describe, expect, it } from 'vitest'
import { specMatchesOwnerRepo } from '../src/client/spec-match.ts'

describe('specMatchesOwnerRepo', () => {
  it('matches the plain github spec form', () => {
    expect(specMatchesOwnerRepo('github:acme/demo', 'acme', 'demo')).toBe(true)
  })

  it('matches when a fragment follows the repo segment', () => {
    expect(specMatchesOwnerRepo('github:acme/demo#path:/x', 'acme', 'demo')).toBe(true)
    expect(specMatchesOwnerRepo('github:acme/demo#v1.2.0', 'acme', 'demo')).toBe(true)
  })

  it('matches at the start of the spec and case-insensitively', () => {
    expect(specMatchesOwnerRepo('acme/demo', 'acme', 'demo')).toBe(true)
    expect(specMatchesOwnerRepo('github:Acme/Demo', 'acme', 'demo')).toBe(true)
  })

  it('does not match a longer repo name sharing the prefix', () => {
    expect(specMatchesOwnerRepo('github:acme/demo-extra', 'acme', 'demo')).toBe(false)
    expect(specMatchesOwnerRepo('github:acme/demo_extra', 'acme', 'demo')).toBe(false)
    expect(specMatchesOwnerRepo('github:acme/demo2', 'acme', 'demo')).toBe(false)
  })

  it('does not match a longer owner name sharing the suffix', () => {
    expect(specMatchesOwnerRepo('github:notacme/demo', 'acme', 'demo')).toBe(false)
  })

  it('does not match a repo that is only a prefix of the catalog repo', () => {
    expect(specMatchesOwnerRepo('github:acme/demo', 'acme', 'demo-extra')).toBe(false)
  })

  it('never matches empty owner or repo coordinates', () => {
    expect(specMatchesOwnerRepo('github:acme/demo', '', 'demo')).toBe(false)
    expect(specMatchesOwnerRepo('github:acme/demo', 'acme', '')).toBe(false)
    expect(specMatchesOwnerRepo('/demo', '', 'demo')).toBe(false)
  })

  it('treats regex metacharacters in coordinates as literals', () => {
    expect(specMatchesOwnerRepo('github:acme/demo.js', 'acme', 'demo.js')).toBe(true)
    expect(specMatchesOwnerRepo('github:acme/demoXjs', 'acme', 'demo.js')).toBe(false)
  })
})
