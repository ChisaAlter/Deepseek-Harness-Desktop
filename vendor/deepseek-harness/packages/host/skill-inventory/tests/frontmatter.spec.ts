import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown, renderSkillMarkdown } from '../src/frontmatter.ts'

describe('skill inventory frontmatter', () => {
  it('round-trips name, description, and invocation flags', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      whenToUse: 'When testing',
      modelInvocable: false,
      userInvocable: false,
      content: 'Do the thing.\n',
    })
    expect(text).toContain('disable-model-invocation: true')
    expect(text).toContain('user-invocable: false')
    const parsed = parseSkillMarkdown(text)
    expect(parsed.data.name).toBe('demo-skill')
    expect(parsed.body.trim()).toBe('Do the thing.')
  })

  it('treats a file without a fence as body-only', () => {
    expect(parseSkillMarkdown('plain body\n')).toEqual({ data: {}, body: 'plain body\n' })
    expect(parseSkillMarkdown('---\n- just a list\n---\nBody\n')).toEqual({
      data: {},
      body: 'Body\n',
    })
  })

  it('omits permissive invocation flags', () => {
    const text = renderSkillMarkdown({
      name: 'open',
      description: 'Open',
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
    })
    expect(text).not.toContain('disable-model-invocation')
    expect(text).not.toContain('user-invocable')
  })

  it('preserves unknown frontmatter while replacing Settings-owned fields', () => {
    const text = renderSkillMarkdown({
      name: 'updated-skill',
      description: 'Updated',
      modelInvocable: true,
      userInvocable: false,
      content: 'Updated body',
      existingData: {
        name: 'old-skill',
        description: 'Old',
        whenToUse: 'Old hint',
        'disable-model-invocation': true,
        'user-invocable': true,
        metadata: { owner: 'custom-provider' },
        customFlag: 'retained',
      },
    })
    const parsed = parseSkillMarkdown(text)
    expect(parsed.data).toEqual({
      name: 'updated-skill',
      description: 'Updated',
      'user-invocable': false,
      metadata: { owner: 'custom-provider' },
      customFlag: 'retained',
    })
  })

  it('writes the group list under metadata', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: [' review '],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
    })
    expect(parseSkillMarkdown(text).data).toEqual({
      name: 'demo-skill',
      description: 'A demo',
      metadata: { group: ['review'] },
    })
  })

  it('trims, drops empties, and dedupes group labels in order', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: ['docs', ' review ', 'docs', '  ', 'review'],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
    })
    expect(parseSkillMarkdown(text).data).toMatchObject({
      metadata: { group: ['docs', 'review'] },
    })
  })

  it('merges the group list into existing metadata fields', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: ['review', 'docs'],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: { owner: 'custom-provider' } },
    })
    expect(parseSkillMarkdown(text).data).toEqual({
      name: 'demo-skill',
      description: 'A demo',
      metadata: { owner: 'custom-provider', group: ['review', 'docs'] },
    })
  })

  it('clears the group list while keeping sibling metadata fields', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: [],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: { owner: 'custom-provider', group: 'old' } },
    })
    expect(parseSkillMarkdown(text).data).toEqual({
      name: 'demo-skill',
      description: 'A demo',
      metadata: { owner: 'custom-provider' },
    })
  })

  it('drops the metadata key when clearing the last remaining field', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: [],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: { group: ['old'] } },
    })
    const parsed = parseSkillMarkdown(text)
    expect(parsed.data).toEqual({
      name: 'demo-skill',
      description: 'A demo',
    })
    expect(parsed.data).not.toHaveProperty('metadata')
  })

  it('leaves a non-object metadata value untouched when clearing the group', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: [],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: 'not-an-object' },
    })
    expect(parseSkillMarkdown(text).data).toMatchObject({ metadata: 'not-an-object' })
  })

  it('leaves the group untouched when the field is omitted from the write', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: { owner: 'custom-provider', group: 'review' } },
    })
    expect(parseSkillMarkdown(text).data).toMatchObject({
      metadata: { owner: 'custom-provider', group: 'review' },
    })
  })

  it('replaces a non-object metadata value when writing a group', () => {
    const text = renderSkillMarkdown({
      name: 'demo-skill',
      description: 'A demo',
      groups: ['review'],
      modelInvocable: true,
      userInvocable: true,
      content: 'Body',
      existingData: { metadata: 'not-an-object' },
    })
    expect(parseSkillMarkdown(text).data).toMatchObject({ metadata: { group: ['review'] } })
  })
})
