/**
 * Skills management RPC domain over createApiProxy: catalog, read, save, and
 * remove against the host skill-admin service, including the wire error
 * mapping (invalid-name / shadowed / not-owned / not-found / admin-absent).
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, {
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import SkillAdminService from '@deepseek-ai/dsh-skill-admin'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`skill-admin-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr<T>(response: RpcResponse<T>): { code: string; message: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return response.result.error
}

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

function memorySkill(name: string): SkillCandidate {
  return {
    name,
    description: 'From memory',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'memory',
    source: 'memory',
    rank: 10,
    locator: { content: 'Memory body.' },
  }
}

async function mounted(home: string, withRegistry = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  if (withRegistry) await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillAdminService, { dshHome: home })
  return ctx
}

const savePayload = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  description: 'A gateway-tested skill',
  content: 'Body.',
  modelInvocable: true,
  userInvocable: true,
  ...overrides,
})

describe('skills management RPC', () => {
  it('catalog merges owned disk skills and foreign registry sources', async () => {
    const home = await mkdtemp(join(tmpdir(), 'skill-admin-gateway-'))
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one')]))
      const api = createApiProxy(ctx, DEFAULTS)
      const saved = await api.skills.save(request(savePayload('disk-one')))
      expectOk(saved)

      const catalog = expectOk(await api.skills.catalog(request({})))
      const byName = new Map(catalog.skills.map(entry => [entry.name, entry]))
      expect(byName.get('memory-one')).toMatchObject({ owned: false, source: 'memory', provider: 'memory' })
      expect(byName.get('disk-one')).toMatchObject({ owned: true, source: 'user-dsh', provider: 'filesystem' })
      expect(byName.get('disk-one')).toMatchObject({ modelInvocable: true, userInvocable: true })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('save persists the skill and maps refusals to named codes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'skill-admin-gateway-'))
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('taken')]))
      const api = createApiProxy(ctx, DEFAULTS)

      const invalid = expectErr(await api.skills.save(request(savePayload('Bad_Name'))))
      expect(invalid.code).toBe('skill-invalid-name')

      const shadowed = expectErr(await api.skills.save(request(savePayload('taken'))))
      expect(shadowed.code).toBe('skill-shadowed')
      expect(shadowed.message).toContain('memory')

      const saved = expectOk(await api.skills.save(request(savePayload('good-one', { userInvocable: false }))))
      expect(saved.entry).toMatchObject({ name: 'good-one', owned: true, userInvocable: false })
      await expect(stat(join(home, 'skills', 'good-one', 'SKILL.md'))).resolves.toBeDefined()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('read returns an owned body and answers not-found for others', async () => {
    const home = await mkdtemp(join(tmpdir(), 'skill-admin-gateway-'))
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one')]))
      const api = createApiProxy(ctx, DEFAULTS)
      expectOk(await api.skills.save(request(savePayload('mine'))))

      const read = expectOk(await api.skills.read(request({ name: 'mine' })))
      expect(read.entry).toMatchObject({ name: 'mine', owned: true })
      expect(read.content).toBe('Body.')

      const foreign = expectErr(await api.skills.read(request({ name: 'memory-one' })))
      expect(foreign.code).toBe('skill-not-found')

      const missing = expectErr(await api.skills.read(request({ name: 'nope' })))
      expect(missing.code).toBe('skill-not-found')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('remove deletes owned skills and refuses foreign ones', async () => {
    const home = await mkdtemp(join(tmpdir(), 'skill-admin-gateway-'))
    const ctx = await mounted(home)
    try {
      ctx.skills.registerProvider(() => new MemoryProvider([memorySkill('memory-one')]))
      const api = createApiProxy(ctx, DEFAULTS)
      expectOk(await api.skills.save(request(savePayload('mine'))))

      expectOk(await api.skills.remove(request({ name: 'mine' })))
      await expect(stat(join(home, 'skills', 'mine'))).rejects.toThrow()

      const foreign = expectErr(await api.skills.remove(request({ name: 'memory-one' })))
      expect(foreign.code).toBe('skill-not-owned')

      const missing = expectErr(await api.skills.remove(request({ name: 'nope' })))
      expect(missing.code).toBe('skill-not-found')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('answers skill-admin-absent when the composition mounts no service', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const api = createApiProxy(ctx, DEFAULTS)
    const refused = expectErr(await api.skills.catalog(request({})))
    expect(refused.code).toBe('skill-admin-absent')
    const refusedSave = expectErr(await api.skills.save(request(savePayload('x'))))
    expect(refusedSave.code).toBe('skill-admin-absent')
  })
})
