/** Focused tests for the isolated MCP Settings connection probe. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'

const {
  clients,
  mockConnect,
  mockRequest,
  MockClient,
  MockHttpTransport,
  MockStdioTransport,
  transports,
} = vi.hoisted(() => {
  type Request = { method: string; params?: Record<string, unknown> }
  type Transport = { close: () => Promise<void> }

  const clients: MockClient[] = []
  const transports: Transport[] = []
  const mockConnect = vi.fn(async (_transport: Transport, _options?: unknown): Promise<void> => {})
  const mockRequest = vi.fn(async (_request: Request, _schema: unknown, _options?: unknown): Promise<unknown> => undefined)

  class MockClient {
    transport: Transport | undefined
    connect = vi.fn(async (transport: Transport, options?: unknown) => {
      this.transport = transport
      await mockConnect(transport, options)
    })
    request = vi.fn(async (request: Request, schema: unknown, options?: unknown) => mockRequest(request, schema, options))
    close = vi.fn(async () => {
      await this.transport?.close()
    })

    constructor() {
      clients.push(this)
    }
  }

  class MockStdioTransport {
    readonly options: unknown
    readonly close = vi.fn(async () => {})

    constructor(options: unknown) {
      this.options = options
      transports.push(this)
    }
  }

  class MockHttpTransport {
    readonly url: URL
    readonly options: unknown
    readonly close = vi.fn(async () => {})

    constructor(url: URL, options: unknown) {
      this.url = url
      this.options = options
      transports.push(this)
    }
  }

  return { clients, mockConnect, mockRequest, MockClient, MockHttpTransport, MockStdioTransport, transports }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: MockStdioTransport }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: MockHttpTransport }))
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({ ListToolsResultSchema: Symbol('ListToolsResultSchema') }))

import { MCP_TEST_TIMEOUT_MS, testMcpServer } from '../src/test-connection.ts'

const stdioRecord: McpServerRecord = {
  id: 'github',
  enabled: true,
  transport: 'stdio',
  serverName: 'github',
  command: 'node',
  args: ['fixture.mjs'],
  env: { API_TOKEN: 'explicit-token' },
  cwd: 'C:/workspace',
}

const httpRecord: McpServerRecord = {
  id: 'remote',
  enabled: true,
  transport: 'streamable-http',
  serverName: 'remote',
  url: 'https://mcp.example.test/mcp',
  headers: { Authorization: 'Bearer explicit-token', 'X-Test': 'yes' },
}

beforeEach(() => {
  clients.length = 0
  transports.length = 0
  mockConnect.mockReset().mockResolvedValue(undefined)
  mockRequest.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('testMcpServer', () => {
  it('initializes, drains paginated tools/list, and closes a stdio probe', async () => {
    mockRequest
      .mockResolvedValueOnce({ tools: [{ name: 'search' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ tools: [{ name: 'open' }] })

    await expect(testMcpServer(stdioRecord, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      serverName: 'github',
      transport: 'stdio',
      toolNames: ['search', 'open'],
      toolCount: 2,
    })
    expect(mockConnect).toHaveBeenCalledWith(expect.any(MockStdioTransport), expect.objectContaining({
      signal: expect.any(AbortSignal),
      timeout: MCP_TEST_TIMEOUT_MS,
    }))
    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[0]?.[0]).toEqual({ method: 'tools/list' })
    expect(mockRequest.mock.calls[1]?.[0]).toEqual({ method: 'tools/list', params: { cursor: 'page-2' } })
    expect((transports[0] as InstanceType<typeof MockStdioTransport>).options).toMatchObject({
      command: 'node',
      args: ['fixture.mjs'],
      cwd: 'C:/workspace',
      env: expect.objectContaining({ API_TOKEN: 'explicit-token' }),
    })
    expect(clients[0]?.close).toHaveBeenCalledTimes(1)
    expect(transports[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('uses the configured HTTP endpoint and reports the discovered tools', async () => {
    mockRequest.mockResolvedValue({ tools: [{ name: 'fetch' }, { name: 'store' }] })

    await expect(testMcpServer(httpRecord, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      serverName: 'remote',
      transport: 'streamable-http',
      toolNames: ['fetch', 'store'],
      toolCount: 2,
    })
    const transport = transports[0] as InstanceType<typeof MockHttpTransport>
    expect(transport.url.href).toBe('https://mcp.example.test/mcp')
    expect(transport.options).toEqual({ requestInit: { headers: httpRecord.headers } })
    expect(clients[0]?.close).toHaveBeenCalledTimes(1)
    expect(transport.close).toHaveBeenCalledTimes(1)
  })

  it('returns an actionable connection error and still closes the transport', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'))

    await expect(testMcpServer(httpRecord, new AbortController().signal))
      .rejects.toThrow('MCP test failed for "remote" over streamable-http: connection refused')
    expect(clients[0]?.close).toHaveBeenCalledTimes(1)
    expect(transports[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung initialize and closes the temporary stdio transport', async () => {
    vi.useFakeTimers()
    mockConnect.mockImplementation(() => new Promise(() => {}))

    const pending = testMcpServer(stdioRecord, new AbortController().signal)
    const assertion = expect(pending).rejects.toThrow(`MCP test timed out after ${String(MCP_TEST_TIMEOUT_MS)}ms`)
    await vi.advanceTimersByTimeAsync(MCP_TEST_TIMEOUT_MS)

    await assertion
    expect(clients[0]?.close).toHaveBeenCalledTimes(1)
    expect(transports[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation and closes the temporary HTTP transport', async () => {
    mockConnect.mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const pending = testMcpServer(httpRecord, controller.signal)
    const reason = new Error('settings view closed')
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(clients[0]?.close).toHaveBeenCalledTimes(1)
    expect(transports[0]?.close).toHaveBeenCalledTimes(1)
  })
})
