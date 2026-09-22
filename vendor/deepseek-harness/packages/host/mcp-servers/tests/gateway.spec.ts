import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'
import McpServersGateway from '../src/index.ts'

const { mockTestMcpServer } = vi.hoisted(() => ({ mockTestMcpServer: vi.fn() }))

vi.mock('../src/test-connection.ts', () => ({ testMcpServer: mockTestMcpServer }))

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const mcpPlugin = { name: 'mcp-client', apply() {} }

type TestHealth = {
  health: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  lastError?: string
  tools?: readonly string[]
}

async function harness(managed: McpServerRecord[] = [], health: {
  managed?: TestHealth
  composition?: TestHealth
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins['mcp-client'] = mcpPlugin
  const remounted: string[] = []
  const authorized: string[] = []
  ctx.provide('mcpServersFile', {
    listManaged: () => managed,
    listManagedRaw: () => managed,
    childPhase: () => 'active' as const,
    childHealth: () => health.managed,
    connectionStatus: () => health.composition,
    upsert: async (spec: McpServerRecord) => { managed.splice(0, managed.length, spec) },
    remove: async (id: string) => {
      const index = managed.findIndex(item => item.id === id)
      if (index !== -1) managed.splice(index, 1)
    },
    setEnabled: async (id: string, enabled: boolean) => {
      const index = managed.findIndex(item => item.id === id)
      if (index !== -1) managed[index] = { ...managed[index]!, enabled }
    },
    remount: async (id: string) => { remounted.push(id) },
    authorize: async (id: string) => { authorized.push(id) },
  } as never)
  await ctx.plugin(McpServersGateway)
  return { ctx, gateway: ctx.get('mcpServers') as McpServersGateway, managed, remounted, authorized }
}

describe('McpServersGateway', () => {
  afterEach(() => { mockTestMcpServer.mockReset() })

  it('publishes list, upsert, delete, retry, authorize, and setEnabled remotes', async () => {
    const { gateway } = await harness()
    expect(remoteMethods(gateway).map(item => item.method).sort()).toEqual([
      'authorize', 'delete', 'list', 'retry', 'setEnabled', 'test', 'upsert',
    ])
  })

  it('lists managed rows and composition-owned mcp-client entries', async () => {
    const { ctx, gateway } = await harness([{
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    }])
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: { serverName: 'memory', transport: 'stdio', command: 'mcp-server-memory' },
    })
    const snapshot = gateway.list()
    expect(snapshot.servers.map(entry => entry.origin)).toEqual(['managed', 'composition'])
    expect(snapshot.servers[1]?.writable).toBe(false)
  })

  it('writes managed upsert and enablement', async () => {
    const { gateway, managed } = await harness()
    await gateway.upsert({
      spec: {
        id: 'github',
        enabled: true,
        transport: 'stdio',
        serverName: 'github',
        command: 'npx',
      },
    })
    expect(managed[0]?.id).toBe('github')
    await gateway.setEnabled({ id: 'github', enabled: false })
    expect(managed[0]?.enabled).toBe(false)
    await gateway.delete({ id: 'github' })
    expect(managed).toEqual([])
  })

  it('projects an http composition row and skips unnamed or grouped entries', async () => {
    const { ctx, gateway } = await harness()
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: {
        serverName: 'remote',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:9/mcp',
        headers: { Accept: 'application/json' },
      },
    })
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: { command: 'npx' },
    })
    const snapshot = gateway.list()
    expect(snapshot.servers).toHaveLength(1)
    expect(snapshot.servers[0]).toMatchObject({
      origin: 'composition',
      writable: false,
      spec: { transport: 'streamable-http', url: 'http://127.0.0.1:9/mcp' },
    })
  })

  it('masks secret env and headers on composition rows', async () => {
    const { ctx, gateway } = await harness()
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: {
        serverName: 'memory',
        transport: 'stdio',
        command: 'mcp-server-memory',
        env: { API_TOKEN: 'plain-token', PATH: '/bin' },
      },
    })
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: {
        serverName: 'remote',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:9/mcp',
        headers: { Authorization: 'Bearer token', Accept: 'application/json' },
      },
    })
    const snapshot = gateway.list()
    const stdio = snapshot.servers.find(entry => entry.spec.serverName === 'memory')?.spec
    expect(stdio?.transport === 'stdio' && stdio.env?.API_TOKEN).toBe('********')
    expect(stdio?.transport === 'stdio' && stdio.env?.PATH).toBe('/bin')
    const http = snapshot.servers.find(entry => entry.spec.serverName === 'remote')?.spec
    expect(http?.transport === 'streamable-http' && http.headers?.Authorization).toBe('********')
    expect(http?.transport === 'streamable-http' && http.headers?.Accept).toBe('application/json')
  })

  it('carries live connection health on managed and composition rows', async () => {
    const { ctx, gateway } = await harness([{
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    }], {
      managed: { health: 'connected', tools: ['mcp__github__create_issue'] },
      composition: { health: 'failed', lastError: 'connection refused' },
    })
    await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: { serverName: 'memory', transport: 'stdio', command: 'mcp-server-memory' },
    })
    const snapshot = gateway.list()
    expect(snapshot.servers.find(entry => entry.id === 'github')?.connection)
      .toMatchObject({ health: 'connected', tools: ['mcp__github__create_issue'] })
    expect(snapshot.servers.find(entry => entry.spec.serverName === 'memory')?.connection)
      .toMatchObject({ health: 'failed', lastError: 'connection refused' })
  })

  it('rejects mutations against a composition-owned id', async () => {
    const { ctx, gateway } = await harness()
    const entryId = await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: { serverName: 'memory', command: 'mcp-server-memory' },
    })
    await expect(gateway.delete({ id: entryId })).rejects.toThrow(/read-only/)
    await expect(gateway.retry({ id: entryId })).rejects.toThrow(/read-only/)
    await expect(gateway.authorize({ id: entryId })).rejects.toThrow(/read-only/)
  })

  it('retries a managed row by remounting its child', async () => {
    const { gateway, remounted } = await harness([{
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    }])
    await gateway.retry({ id: 'github' })
    expect(remounted).toEqual(['github'])
  })

  it('tests a managed row without remounting, writing, or registering tools', async () => {
    const result = {
      ok: true as const,
      serverName: 'github',
      transport: 'stdio' as const,
      toolNames: ['search', 'open'],
      toolCount: 2,
      elapsedMs: 4,
    }
    mockTestMcpServer.mockResolvedValue(result)
    const { gateway, remounted, managed } = await harness([{
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    }])
    const before = structuredClone(managed)
    await expect(gateway.test({ id: 'github' }, new AbortController().signal)).resolves.toEqual(result)
    expect(mockTestMcpServer).toHaveBeenCalledWith(managed[0], expect.any(AbortSignal))
    expect(remounted).toEqual([])
    expect(managed).toEqual(before)
  })

  it('tests a composition row in isolation and rejects unknown ids', async () => {
    const result = {
      ok: true as const,
      serverName: 'remote',
      transport: 'streamable-http' as const,
      toolNames: ['fetch'],
      toolCount: 1,
      elapsedMs: 3,
    }
    mockTestMcpServer.mockResolvedValue(result)
    const { ctx, gateway } = await harness()
    const entryId = await ctx.loader.create({
      name: 'cordis:mcp-client',
      config: { serverName: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp' },
    })
    await expect(gateway.test({ id: entryId }, new AbortController().signal)).resolves.toEqual(result)
    expect(mockTestMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      id: entryId,
      serverName: 'remote',
      transport: 'streamable-http',
    }), expect.any(AbortSignal))
    await expect(gateway.test({ id: 'missing' }, new AbortController().signal)).rejects.toThrow(/not present/)
  })

  it('authorizes a managed HTTP row through the file service', async () => {
    const { gateway, authorized } = await harness([{
      id: 'remote',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'https://mcp.example.test/mcp',
    }])
    await gateway.authorize({ id: 'remote' })
    expect(authorized).toEqual(['remote'])
  })
})
