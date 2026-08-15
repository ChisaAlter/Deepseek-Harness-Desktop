/**
 * mcp-manager REAL-composition test: boots a test cordis.yml through the real
 * Loader, then drives the `mcp` settings section through the settings seam
 * and asserts the live mount lifecycle end to end (mount → connected tools →
 * unmount), exactly as the product-visible surface would.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as McpManager from '@deepseek-ai/dsh-mcp-manager'

const NS = settingsNamespace('mcp')
const fixtureServer = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const fixtureCwd = fileURLToPath(new URL('../..', import.meta.url))

/** In-memory settings provider backing the real settings service in the composition. */
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

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

describe('mcp-manager real Loader composition through cordis.yml', () => {
  it('mounts and unmounts a server live from the settings section', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-mcp-manager-loader-'))
    vi.stubEnv('DSH_HOME', root)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@test/memory-settings'",
      "- name: '@deepseek-ai/dsh-mcp-manager'",
      '',
    ].join('\n'))

    context = new Context()
    const ctx = context
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@test/memory-settings', MemorySettings],
      ['@deepseek-ai/dsh-mcp-manager', McpManager],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    expect(ctx.get('mcpManager')).toBeDefined()

    // A committed section mounts the server live, without any restart.
    await ctx.settings.mutate(NS, [{
      op: 'set',
      path: ['servers', 'fs'],
      value: {
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        cwd: fixtureCwd,
        toolCallTimeoutMs: 15_000,
      },
    }])
    await vi.waitFor(() => {
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__fs__add')
    })
    await vi.waitFor(async () => {
      expect((await ctx.mcpManager.describe())[0]?.status.phase).toBe('connected')
    })

    // Removing the server unmounts it.
    await ctx.settings.mutate(NS, [{ op: 'unset', path: ['servers', 'fs'] }])
    await vi.waitFor(() => {
      expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('mcp__fs__add')
    })
    await vi.waitFor(async () => {
      expect(await ctx.mcpManager.describe()).toEqual([])
    })
  })
})
