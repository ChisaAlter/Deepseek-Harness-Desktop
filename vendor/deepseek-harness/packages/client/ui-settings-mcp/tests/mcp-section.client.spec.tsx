// @vitest-environment jsdom
/** MCP servers settings section: stored servers with live status, create/edit/delete, and probes. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionInjected, McpSectionProps } from '../src/client/McpSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: McpSectionInjected['t'] = key => en[key]

const MCP_NS: SettingsNamespaceView = {
  ns: 'mcp',
  schema: {},
  value: { servers: { fs: { transport: 'stdio', command: 'npx' } } },
  user: { servers: { fs: { transport: 'stdio', command: 'npx' } } },
  applies: 'live',
  secrets: [],
  revision: 1,
}

function sectionApi(overrides: {
  settings?: Record<string, ReturnType<typeof vi.fn>>
  mcp?: Record<string, ReturnType<typeof vi.fn>>
} = {}) {
  const settingsDescribe = vi.fn(async () => ({
    result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [MCP_NS] } },
  }))
  const settingsMutate = vi.fn(async () => ({ result: { ok: true as const, value: MCP_NS } }))
  const mcpDescribe = vi.fn(async () => ({
    result: { ok: true as const, value: { servers: [{ serverName: 'fs', transport: 'stdio', status: { phase: 'connected' } }] } },
  }))
  const mcpProbe = vi.fn(async () => ({
    result: { ok: true as const, value: { ok: true, tools: [{ name: 'add', description: 'Adds numbers' }] } },
  }))
  return {
    api: {
      settings: { describe: settingsDescribe, mutate: settingsMutate, ...overrides.settings },
      mcp: { describe: mcpDescribe, probe: mcpProbe, ...overrides.mcp },
    },
    settingsDescribe,
    settingsMutate,
    mcpDescribe,
    mcpProbe,
  }
}

function renderSection(overrides: Partial<McpSectionInjected> = {}) {
  const harness = sectionApi()
  const injected: McpSectionInjected = {
    api: harness.api as unknown as Pick<IApiClient, 'settings' | 'mcp'>,
    t,
    ...overrides,
  }
  render(<McpSection {...injected} />)
  return harness
}

describe('McpSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as McpSectionProps
    render(<McpSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders stored servers with transport badges and live statuses', async () => {
    renderSection()
    expect(await screen.findByText('fs')).toBeTruthy()
    expect(screen.getByText(en.transportStdio)).toBeTruthy()
    expect(await screen.findByText(en.statusConnected)).toBeTruthy()
  })

  it('creates a server through the form and saves via mutate', async () => {
    const { settingsMutate, settingsDescribe } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    const name = await screen.findByRole('textbox', { name: en.name })
    fireEvent.change(name, { target: { value: 'new-srv' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.command }), { target: { value: 'node' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(settingsMutate).toHaveBeenCalledWith(expect.objectContaining({
        ops: [{ op: 'set', path: ['servers', 'new-srv'], value: expect.objectContaining({ command: 'node' }) }],
      }))
    })
    // The settings describe is refetched after a commit.
    await waitFor(() => { expect(settingsDescribe).toHaveBeenCalledTimes(2) })
  })

  it('deletes a server only after confirmation', async () => {
    const { settingsMutate } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    expect(await screen.findByText(en.deleteDescription)).toBeTruthy()
    expect(settingsMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await waitFor(() => {
      expect(settingsMutate).toHaveBeenCalledWith(expect.objectContaining({
        ops: [{ op: 'unset', path: ['servers', 'fs'] }],
      }))
    })
  })

  it('probes a stored server and lists its tools in the result dialog', async () => {
    const { mcpProbe } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.probe }))
    await waitFor(() => {
      expect(mcpProbe).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'fs', command: 'npx' }))
    })
    expect(await screen.findByText(en.probeTools.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText('add')).toBeTruthy()
  })

  it('polls statuses while mounted', async () => {
    const { mcpDescribe } = renderSection()
    await screen.findByText('fs')
    const initial = mcpDescribe.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 3400))
    expect(mcpDescribe.mock.calls.length).toBeGreaterThan(initial)
  })

  it('shows the load failure when the settings seam rejects', async () => {
    const describe = vi.fn(async () => ({
      result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } },
    }))
    const failing = sectionApi({ settings: { describe } })
    renderSection({ api: failing.api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
    expect(describe).toHaveBeenCalled()
  })
})
