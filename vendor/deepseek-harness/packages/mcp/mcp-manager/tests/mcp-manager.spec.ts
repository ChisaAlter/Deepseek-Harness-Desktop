/**
 * mcp-manager tests: the settings-driven supervisor reconciles live
 * connections against the `mcp` settings namespace — mount, remount,
 * unmount, status, and probe — against the real fixture server over stdio.
 */

import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import McpManagerService from '../src/index.ts'
import type { McpServerProfile, McpServerStatusView } from '../src/types.ts'

const NS = settingsNamespace('mcp')

/** In-memory settings provider: the Service Definition base class owns all tested behavior. */
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

/** The fixture server this test mounts, resolved as a plain file path. */
const fixtureServer = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
/** The mcp-client package directory, the fixture's cwd. */
const fixtureCwd = fileURLToPath(new URL('../..', import.meta.url))

function stdioProfile(overrides: Partial<McpServerProfile> = {}): McpServerProfile {
  const profile: McpServerProfile = {
    transport: 'stdio',
    command: process.execPath,
    args: [fixtureServer],
    cwd: fixtureCwd,
    toolCallTimeoutMs: 15_000,
  }
  return { ...profile, ...overrides } as McpServerProfile
}

async function harness(servers: Record<string, McpServerProfile> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemorySettings, { doc: { [NS]: { servers } } })
  await ctx.plugin(McpManagerService)
  return ctx
}

async function statusOf(ctx: Context, name: string): Promise<McpServerStatusView | undefined> {
  return (await ctx.mcpManager.describe()).find(view => view.serverName === name)
}

async function waitForPhase(ctx: Context, name: string, phase: string): Promise<void> {
  await vi.waitFor(async () => {
    expect((await statusOf(ctx, name))?.status.phase).toBe(phase)
  })
}

async function waitForTool(ctx: Context, tool: string, present: boolean): Promise<void> {
  await vi.waitFor(() => {
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names.includes(tool)).toBe(present)
  })
}

describe('mcp-manager', () => {
  it('mounts nothing for an empty section', async () => {
    const ctx = await harness()
    try {
      expect(await ctx.mcpManager.describe()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('mounts a stdio server from the section and registers its tools', async () => {
    const ctx = await harness({ fs: stdioProfile() })
    try {
      await waitForPhase(ctx, 'fs', 'connected')
      await waitForTool(ctx, 'mcp__fs__add', true)
      expect((await statusOf(ctx, 'fs'))?.transport).toBe('stdio')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('remounts a changed server and drops the old tools', async () => {
    const ctx = await harness({ fs: stdioProfile() })
    try {
      await waitForTool(ctx, 'mcp__fs__add', true)
      await ctx.settings.mutate(NS, [{
        op: 'set',
        path: ['servers', 'fs'],
        value: stdioProfile({ command: 'definitely-missing-mcp-command', reconnect: { enabled: false } }),
      }])
      await waitForTool(ctx, 'mcp__fs__add', false)
      await waitForPhase(ctx, 'fs', 'error')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('unmounts a removed server', async () => {
    const ctx = await harness({ fs: stdioProfile() })
    try {
      await waitForTool(ctx, 'mcp__fs__add', true)
      await ctx.settings.mutate(NS, [{ op: 'unset', path: ['servers', 'fs'] }])
      await waitForTool(ctx, 'mcp__fs__add', false)
      await vi.waitFor(async () => { expect(await ctx.mcpManager.describe()).toEqual([]) })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses an invalid serverName key at the settings seam', async () => {
    const ctx = await harness()
    try {
      await expect(ctx.settings.mutate(NS, [{
        op: 'set',
        path: ['servers', 'Bad Name!'],
        value: stdioProfile(),
      }])).rejects.toThrow(/serverName/)
      expect(await ctx.mcpManager.describe()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports an error phase for an unstartable server without crashing', async () => {
    const ctx = await harness({
      ghost: stdioProfile({ command: 'definitely-missing-mcp-command', reconnect: { enabled: false } }),
    })
    try {
      await waitForPhase(ctx, 'ghost', 'error')
      const status = await statusOf(ctx, 'ghost')
      expect(status?.status.error).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('probes a draft server profile and lists its tools', async () => {
    const ctx = await harness()
    try {
      const result = await ctx.mcpManager.probe({
        serverName: 'probe-me',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.message)
      expect(result.tools.map(tool => tool.name)).toContain('add')
      // A probe never mounts anything.
      expect(await ctx.mcpManager.describe()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('answers a refusal when the probed server cannot start', async () => {
    const ctx = await harness()
    try {
      const result = await ctx.mcpManager.probe({
        serverName: 'ghost',
        transport: 'stdio',
        command: 'definitely-missing-mcp-command',
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected the probe to fail')
      expect(result.message.length).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

