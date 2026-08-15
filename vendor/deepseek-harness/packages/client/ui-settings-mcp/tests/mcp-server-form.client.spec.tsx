// @vitest-environment jsdom
/** The create/edit MCP server form: gates, per-transport fields, save, and test connection. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { McpServerForm } from '../src/client/McpServerForm.tsx'
import type { McpServerFormProps } from '../src/client/McpServerForm.tsx'
import { en, type McpKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: McpKey): string => en[key]) as McpServerFormProps['t']

function namespace(servers: Record<string, unknown> = {}): SettingsNamespaceView {
  return {
    ns: 'mcp',
    schema: {},
    value: { servers },
    user: { servers },
    applies: 'live',
    secrets: [],
    revision: 1,
  }
}

function formApi(overrides: {
  settings?: Record<string, ReturnType<typeof vi.fn>>
  mcp?: Record<string, ReturnType<typeof vi.fn>>
} = {}) {
  return {
    settings: {
      describe: vi.fn(async () => ({ result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } } })),
      mutate: vi.fn(async () => ({ result: { ok: true as const, value: namespace() } })),
      ...overrides.settings,
    },
    mcp: {
      describe: vi.fn(async () => ({ result: { ok: true as const, value: { servers: [] } } })),
      probe: vi.fn(async () => ({ result: { ok: true as const, value: { ok: true, tools: [{ name: 'add' }] } } })),
      ...overrides.mcp,
    },
  }
}

function renderForm(overrides: Partial<McpServerFormProps> = {}) {
  const props: McpServerFormProps = {
    mode: 'create',
    api: formApi() as unknown as Pick<IApiClient, 'settings' | 'mcp'>,
    namespace: namespace(),
    t,
    onClose: vi.fn(),
    ...overrides,
  }
  render(<McpServerForm {...props} />)
  return props
}

function fillStdio(name: string, command: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: name } })
  fireEvent.change(screen.getByRole('textbox', { name: en.command }), { target: { value: command } })
}

describe('McpServerForm', () => {
  it('requires a valid name and a command for stdio', async () => {
    renderForm()
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'Bad Name!' } })
    expect(await screen.findByText(en.nameInvalid)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'ok-name' } })
    expect(await screen.findByText(en.commandRequired)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: en.command }), { target: { value: 'npx' } })
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves a stdio profile through settings.mutate path ops', async () => {
    const props = renderForm()
    fillStdio('fs', 'npx')
    fireEvent.change(screen.getByRole('textbox', { name: en.args }), { target: { value: '-y\nserver-fs' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.env }), { target: { value: 'A=1' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.cwd }), { target: { value: '/tmp' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.timeout }), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => {
      expect(props.api.settings.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ns: 'mcp',
        ops: [{ op: 'set', path: ['servers', 'fs'], value: {
          serverName: 'fs',
          toolCallTimeoutMs: 5000,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'server-fs'],
          env: { A: '1' },
          cwd: '/tmp',
        } }],
      }))
    })
    expect(props.onClose).toHaveBeenCalledWith(true)
  })

  it('switches to streamable-http fields and requires a URL', async () => {
    renderForm()
    fireEvent.change(screen.getByRole('combobox', { name: en.transport }), { target: { value: 'streamable-http' } })
    expect(await screen.findByRole('textbox', { name: en.url })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'http-srv' } })
    expect(await screen.findByText(en.urlRequired)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: en.url }), { target: { value: 'https://mcp.example.com/sse' } })
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('tests the connection with the draft and shows the tools', async () => {
    const api = formApi({
      mcp: {
        probe: vi.fn(async () => ({
          result: { ok: true as const, value: { ok: true, tools: [{ name: 'add', description: 'Adds' }] } },
        })),
      },
    })
    const props = renderForm({ api: api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    fillStdio('fs', 'npx')
    fireEvent.click(screen.getByRole('button', { name: en.probe }))
    await vi.waitFor(() => {
      expect(api.mcp.probe).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'fs', command: 'npx' }))
    })
    expect(await screen.findByText(en.probeTools.replace('{count}', '1'))).toBeTruthy()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows the refusal message when the probe fails', async () => {
    const api = formApi({
      mcp: {
        probe: vi.fn(async () => ({ result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } })),
      },
    })
    renderForm({ api: api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    fillStdio('fs', 'npx')
    fireEvent.click(screen.getByRole('button', { name: en.probe }))
    expect(await screen.findByText(`${en.probeFailed}: boom`)).toBeTruthy()
  })

  it('prefills an edit and locks the name', async () => {
    renderForm({
      mode: 'edit',
      initialName: 'existing',
      initial: { transport: 'stdio', command: 'node', args: ['a'], cwd: '/x', toolCallTimeoutMs: 9000 },
    })
    expect((screen.getByRole('textbox', { name: en.name }) as HTMLInputElement).value).toBe('existing')
    expect((screen.getByRole('textbox', { name: en.name }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('textbox', { name: en.command }) as HTMLInputElement).value).toBe('node')
    expect((screen.getByRole('textbox', { name: en.args }) as HTMLTextAreaElement).value).toBe('a')
    expect((screen.getByRole('textbox', { name: en.timeout }) as HTMLInputElement).value).toBe('9000')
  })

  it('shows the conflict copy when settings.conflict is refused', async () => {
    const api = formApi({
      settings: {
        mutate: vi.fn(async () => ({
          result: { ok: false as const, error: { code: 'settings-conflict', message: 'conflict', details: { ns: 'mcp', expected: 1, actual: 2 } } },
        })),
      },
    })
    const props = renderForm({ api: api as unknown as Pick<IApiClient, 'settings' | 'mcp'> })
    fillStdio('fs', 'npx')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText(en.conflict)).toBeTruthy()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
