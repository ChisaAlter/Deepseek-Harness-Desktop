/**
 * MCP management RPC domain over createApiProxy: describe (live server
 * statuses) and probe (one-shot draft connection) against the host
 * mcp-manager service, including the absent-service mapping.
 */

import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import McpManagerService from '@deepseek-ai/dsh-mcp-manager'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const DEFAULTS = { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }
const NS = settingsNamespace('mcp')

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`mcp-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectErr<T>(response: RpcResponse<T>): { code: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return response.result.error
}

/** In-memory settings provider backing the manager's settings section. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const fixtureServer = fileURLToPath(new URL('../../../mcp/mcp-client/tests/fixture-server.ts', import.meta.url))
const fixtureCwd = fileURLToPath(new URL('../../../mcp/mcp-client', import.meta.url))

describe('mcp management RPC', () => {
  it('answers mcp-manager-absent when the composition mounts no manager', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const api = createApiProxy(ctx, DEFAULTS)
    const refused = expectErr(await api.mcp.describe(request({})))
    expect(refused.code).toBe('mcp-manager-absent')
    const probeRefused = expectErr(await api.mcp.probe(request({
      serverName: 'x', transport: 'stdio', command: 'whatever',
    })))
    expect(probeRefused.code).toBe('mcp-manager-absent')
  })

  it('describes live servers and probes drafts through the manager', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MemorySettings, { doc: { [NS]: { servers: {
      fs: {
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        cwd: fixtureCwd,
        toolCallTimeoutMs: 15_000,
      },
    } } } })
    await ctx.plugin(McpManagerService)
    await ctx.plugin(UserQuestionService)
    const api = createApiProxy(ctx, DEFAULTS)

    const probe = expectOk(await api.mcp.probe(request({
      serverName: 'probe-me',
      transport: 'stdio',
      command: process.execPath,
      args: [fixtureServer],
    })))
    expect(probe.ok).toBe(true)
    if (!probe.ok) throw new Error(probe.message)
    expect(probe.tools.map(tool => tool.name)).toContain('add')

    const refused = expectOk(await api.mcp.probe(request({
      serverName: 'ghost',
      transport: 'stdio',
      command: 'definitely-missing-mcp-command',
    })))
    expect(refused.ok).toBe(false)

    // The live server reports a connected status.
    await vi.waitFor(async () => {
      const described = expectOk(await api.mcp.describe(request({})))
      const fs = described.servers.find(view => view.serverName === 'fs')
      expect(fs?.status.phase).toBe('connected')
      expect(fs?.transport).toBe('stdio')
    })

    await ctx.fiber.dispose()
  })
})
