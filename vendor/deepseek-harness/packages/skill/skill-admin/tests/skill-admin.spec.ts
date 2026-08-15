import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SkillRegistry, {
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import SkillAdminService, { SkillAdminError } from '../src/index.ts'
import type { SkillSaveInput } from '../src/types.ts'

class MemoryProvider implements SkillProvider {
  readonly name = 'memory'

  constructor(private candidates: SkillCandidate[]) {}

  async list(): Promise<SkillCandidate[]> {
    return this.candidates
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    return { ...candidate, content: (candidate.locator as { content: string }).content }
  }
}

function memorySkill(name: string, description: string): SkillCandidate {
  return {
    name,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'memory',
    source: 'memory',
    rank: 10,
    locator: { content: 'Memory body.' },
  }
}

async function mounted(home: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillAdminService, { dshHome: home })
  return ctx
}

function saveInput(name: string, overrides: Partial<SkillSaveInput> = {}): SkillSaveInput {
  return {
    name,
    description: 'A test skill',
    content: '# Body\n\nTest content.',
    modelInvocable: true,
    userInvocable: true,
    ...overrides,
  }
}

async function tempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'skill-admin-'))
}

async function cleanup(home: string): Promise<void> {
  await rm(home, { recursive: true, force: true })
}

describe('skill-admin', () => {
  it('saves canonical frontmatter and body, and lists the entry immediately', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      await ctx.skillAdmin.save(saveInput('demo', {
        whenToUse: 'when demoing',
        content: '# Demo\n\nBody.',
      }))

      const raw = await readFile(join(home, 'skills', 'demo', 'SKILL.md'), 'utf8')
      expect(raw.startsWith('---\n')).toBe(true)
      expect(raw).toContain('name: demo')
      expect(raw).toContain('description: A test skill')
      expect(raw).toContain('whenToUse: when demoing')
      // Defaults are omitted, not written.
      expect(raw).not.toContain('disable-model-invocation')
      expect(raw).not.toContain('user-invocable')
      expect(raw).toContain('# Demo\n\nBody.')

      const listed = await ctx.skillAdmin.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        name: 'demo',
        description: 'A test skill',
        whenToUse: 'when demoing',
        source: 'user-dsh',
        owned: true,
      })
      expect(listed[0]?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    } finally {
      await cleanup(home)
    }
  })

  it('writes invocation switches only when they differ from the defaults', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      await ctx.skillAdmin.save(saveInput('quiet', { modelInvocable: false, userInvocable: false }))
      const raw = await readFile(join(home, 'skills', 'quiet', 'SKILL.md'), 'utf8')
      expect(raw).toContain('disable-model-invocation: true')
      expect(raw).toContain('user-invocable: false')
      expect((await ctx.skillAdmin.list())[0]?.invocation)
        .toEqual({ modelInvocable: false, userInvocable: false })
    } finally {
      await cleanup(home)
    }
  })

  it('refuses invalid names and empty descriptions', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      for (const bad of ['Demo', 'demo_skill', '../evil', 'demo skill', 'demo/../x', '']) {
        await expect(ctx.skillAdmin.save(saveInput(bad)))
          .rejects.toThrow(SkillAdminError)
      }
      await expect(ctx.skillAdmin.save(saveInput('ok-name', { description: '' })))
        .rejects.toThrow(SkillAdminError)
      // Nothing was written.
      expect(await ctx.skillAdmin.list()).toEqual([])
    } finally {
      await cleanup(home)
    }
  })

  it('refuses a name shadowed by another source and names that source', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('taken', 'Already here')]))
      await expect(ctx.skillAdmin.save(saveInput('taken')))
        .rejects.toThrow(/source "memory"/)
      const failure = await ctx.skillAdmin.save(saveInput('taken')).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SkillAdminError)
      expect((failure as SkillAdminError).code).toBe('shadowed')
    } finally {
      await cleanup(home)
    }
  })

  it('lists foreign registry sources read-only alongside owned disk skills', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one', 'From memory')]))
      await ctx.skillAdmin.save(saveInput('disk-one'))

      const listed = await ctx.skillAdmin.list()
      const byName = new Map(listed.map(entry => [entry.name, entry]))
      expect(byName.get('memory-one')).toMatchObject({ owned: false, source: 'memory', provider: 'memory' })
      expect(byName.get('disk-one')).toMatchObject({ owned: true, source: 'user-dsh' })
    } finally {
      await cleanup(home)
    }
  })

  it('discovers flat Markdown skills already present in the user root', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      await mkdir(join(home, 'skills'), { recursive: true })
      await writeFile(
        join(home, 'skills', 'flat-one.md'),
        '---\nname: flat-one\ndescription: A flat skill\n---\n\nFlat body.',
        'utf8',
      )
      const listed = await ctx.skillAdmin.list()
      expect(listed[0]).toMatchObject({ name: 'flat-one', owned: true })
      expect(await ctx.skillAdmin.read('flat-one')).toMatchObject({ content: 'Flat body.' })
    } finally {
      await cleanup(home)
    }
  })

  it('reads owned bodies and refuses reads of unowned or unknown skills', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one', 'From memory')]))
      await ctx.skillAdmin.save(saveInput('demo', { content: 'Body text.' }))
      expect(await ctx.skillAdmin.read('demo')).toEqual({
        entry: expect.objectContaining({ name: 'demo', owned: true }),
        content: 'Body text.',
      })
      expect(await ctx.skillAdmin.read('memory-one')).toBeUndefined()
      expect(await ctx.skillAdmin.read('nope')).toBeUndefined()
    } finally {
      await cleanup(home)
    }
  })

  it('updates an existing owned skill in place', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      await ctx.skillAdmin.save(saveInput('demo', { description: 'First' }))
      await ctx.skillAdmin.save(saveInput('demo', {
        description: 'Second',
        whenToUse: 'after the update',
        content: 'Updated body.',
        userInvocable: false,
      }))
      const listed = await ctx.skillAdmin.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ description: 'Second', whenToUse: 'after the update' })
      expect(await ctx.skillAdmin.read('demo')).toMatchObject({ content: 'Updated body.' })
    } finally {
      await cleanup(home)
    }
  })

  it('removes an owned skill directory recursively', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      await ctx.skillAdmin.save(saveInput('demo'))
      await writeFile(join(home, 'skills', 'demo', 'extra.txt'), 'resource', 'utf8')
      await ctx.skillAdmin.remove('demo')
      expect(await ctx.skillAdmin.list()).toEqual([])
      await expect(readFile(join(home, 'skills', 'demo', 'SKILL.md'), 'utf8')).rejects.toThrow()
    } finally {
      await cleanup(home)
    }
  })

  it('refuses removals of unowned or unknown skills', async () => {
    const home = await tempHome()
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one', 'From memory')]))
      const shadowed = await ctx.skillAdmin.remove('memory-one').catch((error: unknown) => error)
      expect(shadowed).toBeInstanceOf(SkillAdminError)
      expect((shadowed as SkillAdminError).code).toBe('not-owned')
      const missing = await ctx.skillAdmin.remove('nope').catch((error: unknown) => error)
      expect(missing).toBeInstanceOf(SkillAdminError)
      expect((missing as SkillAdminError).code).toBe('not-found')
    } finally {
      await cleanup(home)
    }
  })
})
