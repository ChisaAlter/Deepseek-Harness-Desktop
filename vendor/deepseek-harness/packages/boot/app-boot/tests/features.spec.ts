/**
 * The host-baked feature registry: the supported feature list, the
 * parse/missing helpers behind the install-time and module-graph gates, and
 * the runtime `assertHostFeatures` face external plugins import from
 * `@deepseek-ai/dsh-app-boot/features`.
 */

import { describe, expect, it } from 'vitest'
import {
  assertHostFeatures,
  HOST_FEATURES,
  isHostFeature,
  missingHostFeatures,
  parseCompatibilityFeatures,
} from '../src/features.ts'

describe('HOST_FEATURES', () => {
  it('lists exactly the supported stable feature ids', () => {
    expect([...HOST_FEATURES]).toEqual([
      'conversation.chat.user-actions',
      'session.fork.beforeSeq',
      'session.fork.blank',
      'conversation.chat.user-editor',
    ])
  })
})

describe('isHostFeature', () => {
  it('accepts every registry id and rejects anything else', () => {
    for (const feature of HOST_FEATURES) expect(isHostFeature(feature)).toBe(true)
    expect(isHostFeature('editor.unsupported')).toBe(false)
    expect(isHostFeature('')).toBe(false)
  })
})

describe('missingHostFeatures', () => {
  it('returns nothing when every requirement is supported', () => {
    expect(missingHostFeatures(['conversation.chat.user-actions'])).toEqual([])
    expect(missingHostFeatures([...HOST_FEATURES])).toEqual([])
    expect(missingHostFeatures([])).toEqual([])
  })

  it('returns the unsupported requirements in declaration order, deduplicated', () => {
    expect(missingHostFeatures(['session.fork.blank', 'editor.unsupported', 'session.fork.blank']))
      .toEqual(['editor.unsupported'])
    expect(missingHostFeatures(['a.feature', 'conversation.chat.user-actions', 'b.feature']))
      .toEqual(['a.feature', 'b.feature'])
  })
})

describe('parseCompatibilityFeatures', () => {
  it('returns undefined for a package without a compatibility section', () => {
    expect(parseCompatibilityFeatures('pkg', undefined)).toBeUndefined()
  })

  it('accepts a string-array declaration and an empty section', () => {
    expect(parseCompatibilityFeatures('pkg', { features: ['session.fork.beforeSeq'] }))
      .toEqual(['session.fork.beforeSeq'])
    expect(parseCompatibilityFeatures('pkg', {})).toEqual([])
  })

  it('rejects a non-object section, naming the package', () => {
    for (const value of [null, 'features', 3, ['session.fork.blank']]) {
      expect(() => parseCompatibilityFeatures('bad-pkg', value))
        .toThrow('bad-pkg: dsh.compatibility must be an object')
    }
  })

  it('rejects a non-string-array features field, naming the package and field', () => {
    for (const value of [
      { features: 'session.fork.blank' },
      { features: [1] },
      { features: ['session.fork.blank', null] },
    ]) {
      expect(() => parseCompatibilityFeatures('bad-pkg', value))
        .toThrow('bad-pkg: dsh.compatibility.features must be a string array of feature ids')
    }
  })
})

describe('assertHostFeatures', () => {
  it('passes silently when every required feature is supported', () => {
    expect(() => { assertHostFeatures('pkg', ['conversation.chat.user-actions']) }).not.toThrow()
    expect(() => { assertHostFeatures('pkg', []) }).not.toThrow()
  })

  it('throws naming the plugin and the missing features', () => {
    expect(() => { assertHostFeatures('turtle-ui', ['session.fork.blank', 'editor.unsupported']) })
      .toThrow(/turtle-ui requires host features this dsh host does not support: editor\.unsupported/)
  })
})
