import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SkillRegistry, { type SkillDefinition, type SkillSummary } from '@deepseek-ai/dsh-skill'
import { remoteMethods, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import SkillInventoryGateway, { parseSkillMarkdown } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function summary(partial: Partial<SkillSummary> & Pick<SkillSummary, 'name'>): SkillSummary {
  return {
    description: partial.description ?? 'desc',
    invocation: partial.invocation ?? { modelInvocable: true, userInvocable: true },
    source: partial.source ?? 'user-dsh',
    provider: partial.provider ?? 'filesystem',
    ...partial,
  }
}

function provideAgents(ctx: Context, entries: ReadonlyMap<string, object> = new Map()): void {
  ctx.provide('agents', {
    get: (id: string) => entries.get(id),
  } as never)
}

describe('SkillInventoryGateway', () => {
  it('publishes catalog and mutation remotes', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    ctx.provide('skills', {
      list: async () => [],
      get: async () => undefined,
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    expect(remoteMethods(gateway).map(item => item.method).sort()).toEqual([
      'create', 'delete', 'get', 'list', 'setInvocation', 'update',
    ])
  })

  it('creates a user-dsh bundle and rejects a non-kebab name', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-inv-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    const catalog: SkillDefinition[] = []
    ctx.provide('skills', {
      list: async () => catalog.map(item => summary(item)),
      get: async (name: string) => catalog.find(item => item.name === name),
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await expect(gateway.create({
      name: 'Not Valid',
      description: 'x',
      content: 'body',
      root: 'user-dsh',
      modelInvocable: true,
      userInvocable: true,
    })).rejects.toThrow(/kebab-case/)
    await gateway.create({
      name: 'demo-skill',
      description: 'A demo',
      content: 'Do it',
      root: 'user-dsh',
      modelInvocable: false,
      userInvocable: false,
    })
    const written = await readFile(join(home, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')
    expect(written).toContain('name: demo-skill')
    expect(written).toContain('disable-model-invocation: true')
    expect(written).toContain('user-invocable: false')
    expect(written).toContain('Do it')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  it('invalidates the registry cache after every successful write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-inv-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    const catalog: SkillDefinition[] = []
    const invalidate = vi.fn()
    ctx.provide('skills', {
      list: async () => catalog.map(item => summary(item)),
      get: async (name: string) => catalog.find(item => item.name === name),
      invalidate,
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await gateway.create({
      name: 'demo-skill',
      description: 'A demo',
      content: 'Do it',
      root: 'user-dsh',
      modelInvocable: true,
      userInvocable: true,
    })
    catalog.push({
      name: 'demo-skill',
      description: 'A demo',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      provider: 'filesystem',
      path: join(home, 'skills', 'demo-skill', 'SKILL.md'),
      content: 'Do it',
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    await gateway.update({
      name: 'demo-skill',
      description: 'Updated',
      content: 'New body',
      modelInvocable: true,
      userInvocable: true,
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
    await gateway.setInvocation({ name: 'demo-skill', modelInvocable: false, userInvocable: true })
    expect(invalidate).toHaveBeenCalledTimes(3)
    await gateway.delete({ name: 'demo-skill' })
    expect(invalidate).toHaveBeenCalledTimes(4)
    // A rejected write must not invalidate: kebab-case guard fires first.
    await expect(gateway.create({
      name: 'Bad Name',
      description: 'x',
      content: 'body',
      root: 'user-dsh',
      modelInvocable: true,
      userInvocable: true,
    })).rejects.toThrow(/kebab-case/)
    expect(invalidate).toHaveBeenCalledTimes(4)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  it('lists, updates, and toggles a writable skill', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-inv-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    const catalog: SkillDefinition[] = []
    ctx.provide('skills', {
      list: async () => catalog.map(item => summary(item)),
      get: async (name: string) => catalog.find(item => item.name === name),
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await gateway.create({
      name: 'demo-skill',
      description: 'A demo',
      whenToUse: 'When testing',
      content: 'Do it',
      root: 'user-dsh',
      modelInvocable: true,
      userInvocable: true,
    })
    catalog.push({
      name: 'demo-skill',
      description: 'A demo',
      whenToUse: 'When testing',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      provider: 'filesystem',
      path: join(home, 'skills', 'demo-skill', 'SKILL.md'),
      content: 'Do it',
    })
    const path = join(home, 'skills', 'demo-skill', 'SKILL.md')
    await writeFile(path, '---\nname: demo-skill\ndescription: A demo\nwhenToUse: When testing\nmetadata:\n  owner: custom-provider\ncustomFlag: retained\n---\n\nDo it\n', 'utf8')
    const listed = await gateway.list({})
    expect(listed.skills[0]).toMatchObject({ name: 'demo-skill', writable: true })
    const detail = await gateway.get({ name: 'demo-skill' })
    expect(detail.content).toContain('Do it')
    await gateway.update({
      name: 'demo-skill',
      description: 'Updated',
      whenToUse: 'Updated hint',
      content: 'New body',
      modelInvocable: false,
      userInvocable: false,
    })
    let written = parseSkillMarkdown(await readFile(path, 'utf8'))
    expect(written.data).toMatchObject({
      name: 'demo-skill',
      description: 'Updated',
      whenToUse: 'Updated hint',
      'disable-model-invocation': true,
      'user-invocable': false,
      metadata: { owner: 'custom-provider' },
      customFlag: 'retained',
    })
    await gateway.setInvocation({
      name: 'demo-skill',
      modelInvocable: true,
      userInvocable: false,
    })
    written = parseSkillMarkdown(await readFile(path, 'utf8'))
    expect(written.data).toMatchObject({
      name: 'demo-skill',
      description: 'Updated',
      whenToUse: 'Updated hint',
      'user-invocable': false,
      metadata: { owner: 'custom-provider' },
      customFlag: 'retained',
    })
    expect(written.data).not.toHaveProperty('disable-model-invocation')
    await gateway.delete({ name: 'demo-skill' })
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  it('round-trips group labels and the skill directory through the catalog', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-group-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    const catalog: SkillDefinition[] = []
    ctx.provide('skills', {
      list: async () => catalog.map(item => summary(item)),
      get: async (name: string) => catalog.find(item => item.name === name),
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await gateway.create({
      name: 'grouped-skill',
      description: 'Grouped',
      groups: ['review'],
      content: 'Do it',
      root: 'user-dsh',
      modelInvocable: true,
      userInvocable: true,
    })
    const path = join(home, 'skills', 'grouped-skill', 'SKILL.md')
    expect(parseSkillMarkdown(await readFile(path, 'utf8')).data).toMatchObject({
      metadata: { group: ['review'] },
    })
    // A scalar `metadata.group` (hand-edited or written by an older build) reads as one label.
    catalog.push({
      name: 'grouped-skill',
      description: 'Grouped',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      provider: 'filesystem',
      path,
      metadata: { group: 'review' },
      content: 'Do it',
    })
    expect((await gateway.list({})).skills[0]).toMatchObject({
      name: 'grouped-skill',
      groups: ['review'],
      directory: dirname(path),
    })
    expect(await gateway.get({ name: 'grouped-skill' })).toMatchObject({ groups: ['review'] })

    await gateway.update({
      name: 'grouped-skill',
      description: 'Grouped',
      groups: ['workflows', 'docs', ' workflows '],
      content: 'Do it',
      modelInvocable: true,
      userInvocable: true,
    })
    expect(parseSkillMarkdown(await readFile(path, 'utf8')).data).toMatchObject({
      metadata: { group: ['workflows', 'docs'] },
    })

    await gateway.setInvocation({ name: 'grouped-skill', modelInvocable: false, userInvocable: true })
    expect(parseSkillMarkdown(await readFile(path, 'utf8')).data).toMatchObject({
      metadata: { group: ['workflows', 'docs'] },
    })

    await gateway.update({
      name: 'grouped-skill',
      description: 'Grouped',
      groups: [],
      content: 'Do it',
      modelInvocable: false,
      userInvocable: true,
    })
    const cleared = parseSkillMarkdown(await readFile(path, 'utf8')).data
    expect(cleared.metadata).toBeUndefined()

    const current = catalog[0]!
    catalog[0] = {
      name: current.name,
      description: current.description,
      invocation: current.invocation,
      source: current.source,
      provider: current.provider,
      ...current.path === undefined ? {} : { path: current.path },
      content: current.content,
    }
    expect((await gateway.list({})).skills[0]).not.toHaveProperty('groups')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  it('creates a project skill and refuses create without cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-skill-proj-'))
    await mkdir(join(cwd, '.git'))
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    ctx.provide('skills', {
      list: async () => [],
      get: async () => undefined,
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await expect(gateway.create({
      name: 'proj-skill',
      description: 'P',
      content: 'body',
      root: 'project-dsh',
      modelInvocable: true,
      userInvocable: true,
    })).rejects.toThrow(/requires cwd/)
    await gateway.create({
      name: 'proj-skill',
      description: 'P',
      content: 'body',
      root: 'project-dsh',
      modelInvocable: true,
      userInvocable: true,
      cwd,
    })
    expect(await readFile(join(cwd, '.dsh', 'skills', 'proj-skill', 'SKILL.md'), 'utf8')).toContain('name: proj-skill')
  })

  it('creates a project skill at the nearest git root for a nested cwd', async () => {
    const project = await mkdtemp(join(tmpdir(), 'dsh-skill-proj-root-'))
    const cwd = join(project, 'packages', 'app')
    await mkdir(join(project, '.git'))
    await mkdir(cwd, { recursive: true })
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    ctx.provide('skills', {
      list: async () => [],
      get: async () => undefined,
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await gateway.create({
      name: 'nested-project-skill',
      description: 'Nested project skill',
      content: 'body',
      root: 'project-dsh',
      modelInvocable: true,
      userInvocable: true,
      cwd,
    })
    expect(await readFile(
      join(project, '.dsh', 'skills', 'nested-project-skill', 'SKILL.md'),
      'utf8',
    )).toContain('name: nested-project-skill')
  })

  it('lists preset-scoped skills through the requested live session', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SkillRegistry)
    const preset = createScope(ctx, { preset: 'standard' })
    const presetSkills = preset.ctx.get('skills')
    if (presetSkills === undefined) throw new Error('skills service missing')
    presetSkills.register({
      name: 'preset-only',
      description: 'Scoped to the standard preset',
      source: 'bundled',
      content: 'Preset body.',
    })
    const sessionId = 'settings-live-session'
    const agent = { id: sessionId }
    const presetScope = scopeOf(preset.ctx)
    if (presetScope === undefined) throw new Error('preset scope missing')
    bindScopeParent(agent, presetScope)
    provideAgents(ctx, new Map([[sessionId, agent]]))
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway

    expect((await gateway.list({})).skills).toEqual([])
    await expect(gateway.list({ sessionId })).resolves.toMatchObject({
      skills: [{ name: 'preset-only', source: 'bundled', writable: false }],
    })
    await expect(gateway.get({ name: 'preset-only', sessionId })).resolves.toMatchObject({
      name: 'preset-only',
      content: 'Preset body.',
    })
  })

  it('uses a live preset realm skill registry when the host registry cannot see it', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const agent = { id: 'realm-session' }
    const realmSkill = summary({ name: 'realm-only', source: 'bundled', provider: 'preset-filesystem' })
    const definition: SkillDefinition = {
      ...realmSkill,
      content: 'Realm body.',
    }
    provideAgents(ctx, new Map([[agent.id, agent]]))
    ctx.provide('skills', {
      list: async () => [],
      get: async () => undefined,
      invalidate: () => {},
    } as never)
    const realmRegistry = {
      list: async () => [realmSkill],
      get: async (name: string) => name === realmSkill.name ? definition : undefined,
    }
    const serviceFor = vi.fn((requestedAgent: object, name: string) => {
      expect(requestedAgent).toBe(agent)
      return name === 'skills' ? realmRegistry : undefined
    })
    ctx.provide('agentPresets', { serviceFor } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway

    await expect(gateway.list({ sessionId: agent.id })).resolves.toMatchObject({
      skills: [{ name: 'realm-only', provider: 'preset-filesystem', writable: false }],
    })
    await expect(gateway.get({ name: 'realm-only', sessionId: agent.id })).resolves.toMatchObject({
      content: 'Realm body.',
    })
    expect(serviceFor).toHaveBeenCalledTimes(2)
  })

  it('rejects a supplied session id when no live agent exists', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    ctx.provide('skills', {
      list: async () => [],
      get: async () => undefined,
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    const sessionId = 'missing-live-session'

    const failure = await gateway.list({ sessionId }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({
      code: 'session/not-found',
      message: `session "${sessionId}" not found (not attached)`,
      details: { sessionId },
    })
  })

  it('refuses to mutate a bundled skill', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    provideAgents(ctx)
    ctx.provide('skills', {
      list: async () => [],
      get: async (name: string) => name === 'bundled-one'
        ? ({
          name: 'bundled-one',
          description: 'shipped',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'bundled',
          provider: 'filesystem',
          path: '/app/skills/bundled-one/SKILL.md',
          content: 'shipped',
        } satisfies SkillDefinition)
        : undefined,
      invalidate: () => {},
    } as never)
    await ctx.plugin(SkillInventoryGateway)
    const gateway = ctx.get('skillInventory') as SkillInventoryGateway
    await expect(gateway.delete({ name: 'bundled-one' })).rejects.toThrow(/read-only/)
    await expect(gateway.get({ name: 'Not Valid' })).rejects.toThrow(/kebab-case/)
    await expect(gateway.get({ name: 'missing-skill' })).rejects.toThrow(/was not found/)
  })
})
