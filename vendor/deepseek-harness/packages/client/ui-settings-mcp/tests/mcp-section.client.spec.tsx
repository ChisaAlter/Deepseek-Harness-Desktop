// @vitest-environment jsdom
/** MCP servers settings section: stored servers with live status, create/edit/delete, and probes. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionInjected } from '../src/client/McpSection.tsx'
import { en, type McpKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: McpKey): string => en[key]) as McpSectionInjected['t']

const MCP_NS: SettingsNamespaceView = {
  ns: 'mcp',
  schema: {},
  value: { servers: { fs: { transport: 'stdio', command: 'npx' } } },
  user: { servers: { fs: { transport: 'stdio', command: 'npx' } } },
  applies: 'live',
  secrets: [],
  revision: 1,
}

function sectionApi(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      describe: vi.fn(async () => ({
        result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [MCP_NS] } },
      })),
      mutate: vi.fn(async () => ({ result: { ok: true as const, value: MCP_NS } })),
      ...(overrides.settings as Record<string, unknown> | undefined),
    },
    mcp: {
      describe: vi.fn(async () => ({
        result: { ok: true as const, value: { servers: [{ serverName: 'fs', transport: 'stdio', status: { phase: 'connected' } }] } },
      })),
      probe: vi.fn(async () => ({
        result: { ok: true as const, value: { ok: true, tools: [{ name: 'add', description: 'Adds numbers' }] } },
      })),
      ...(overrides.mcp as Record<string, unknown> | undefined),
    },
  }
}

function renderSection(overrides: Partial<McpSectionInjected> = {}) {
  const injected: McpSectionInjected = {
    api: sectionApi() as unknown as Pick<IApiClient, 'settings' | 'mcp'>,
    t,
    ...overrides,
  }
  render(<McpSection {...injected} />)
  return injected
}

describe('McpSection', () => {
  it('renders stored servers with transport badges and live statuses', async () => {
    renderSection()
    expect(await screen.findByText('fs')).toBeTruthy()
    expect(screen.getByText(en.transportStdio)).toBeTruthy()
    expect(await screen.findByText(en.statusConnected)).toBeTruthy()
  })

  it('creates a server through the form and saves via mutate', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    const name = await screen.findByRole('textbox', { name: en.name })
    fireEvent.change(name, { target: { value: 'new-srv' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.command }), { target: { value: 'node' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(injected.api.settings.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ops: [{ op: 'set', path: ['servers', 'new-srv'], value: expect.objectContaining({ command: 'node' }) }],
      }))
    })
    // The settings describe is refetched after a commit.
    await waitFor(() => { expect(injected.api.settings.describe).toHaveBeenCalledTimes(2) })
  })

  it('deletes a server only after confirmation', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    expect(await screen.findByText(en.deleteDescription)).toBeTruthy()
    expect(injected.api.settings.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await waitFor(() => {
      expect(injected.api.settings.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ops: [{ op: 'unset', path: ['servers', 'fs'] }],
      }))
    })
  })

  it('probes a stored server and lists its tools in the result dialog', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.probe }))
    await waitFor(() => {
      expect(injected.api.mcp.probe).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'fs', command: 'npx' }))
    })
    expect(await screen.findByText(en.probeTools.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText('add')).toBeTruthy()
  })

  it('polls statuses while mounted', async () => {
    const api = sectionApi()
    renderSection({ api: api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    await screen.findByText('fs')
    const initial = (api.mcp.describe as ReturnType<typeof vi.fn>).mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 3400))
    expect((api.mcp.describe as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initial)
  })

  it('shows the load failure when the settings seam rejects', async () => {
    const api = sectionApi({
      settings: {
        describe: vi.fn(async () => ({
          result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } },
        })),
      },
    })
    renderSection({ api: api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
  })
})
