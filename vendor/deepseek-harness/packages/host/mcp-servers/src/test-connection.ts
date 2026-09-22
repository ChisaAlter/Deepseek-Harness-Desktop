/** One-shot MCP connection probe used by the Settings test action. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerRecord } from '@deepseek-ai/dsh-mcp-servers-file'
import type { McpServerTestResult } from './types.ts'

/** Maximum time allowed for initialize plus the complete tools/list walk. */
export const MCP_TEST_TIMEOUT_MS = 10_000

/** Maximum time allowed for the SDK's transport close operation. */
const MCP_TEST_CLOSE_TIMEOUT_MS = 5_000

type ProbeTransport = Transport & { close: () => Promise<void> }

/**
 * Connect to one MCP record, discover every advertised tool, and close the
 * temporary transport before resolving or rejecting.
 * @param record - raw managed or composition record to probe.
 * @param signal - Remote invocation cancellation signal.
 * @returns the server identity, transport, discovered names, and elapsed time.
 */
export async function testMcpServer(record: McpServerRecord, signal: AbortSignal): Promise<McpServerTestResult> {
  const startedAt = Date.now()
  const timeoutController = new AbortController()
  const operationSignal = AbortSignal.any([signal, timeoutController.signal])
  const timeoutError = new Error(`MCP test timed out after ${String(MCP_TEST_TIMEOUT_MS)}ms`)
  const timeout = setTimeout(() => timeoutController.abort(timeoutError), MCP_TEST_TIMEOUT_MS)
  timeout.unref()

  const transport = createTransport(record)
  const client = new Client(
    { name: 'dsh-mcp-settings-test', version: '0.0.1' },
    { capabilities: {} },
  )
  let failure: unknown
  try {
    const operation = probe(client, transport, operationSignal, record.serverName)
    const result = await raceWithAbort(operation, operationSignal)
    return {
      ok: true,
      serverName: record.serverName,
      transport: record.transport,
      toolNames: result,
      toolCount: result.length,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }
  } catch (error) {
    failure = error
    if (signal.aborted) throw signal.reason ?? error
    if (timeoutController.signal.aborted) throw timeoutError
    throw new Error(
      `MCP test failed for "${record.serverName}" over ${record.transport}: ${errorMessage(error)}`,
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
    try {
      await closeWithTimeout(client, transport)
    } catch (closeError) {
      if (failure === undefined) {
        throw new Error(
          `MCP test connected to "${record.serverName}" but cleanup failed: ${errorMessage(closeError)}`,
          { cause: closeError },
        )
      }
    }
  }
}

async function probe(
  client: Client,
  transport: ProbeTransport,
  signal: AbortSignal,
  serverName: string,
): Promise<string[]> {
  await client.connect(transport, { signal, timeout: MCP_TEST_TIMEOUT_MS })
  const names: string[] = []
  let cursor: string | undefined
  do {
    const page = await client.request(
      { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
      ListToolsResultSchema,
      { signal, timeout: MCP_TEST_TIMEOUT_MS },
    )
    names.push(...page.tools.map(tool => tool.name))
    cursor = page.nextCursor
  } while (cursor !== undefined)
  if (signal.aborted) throw signal.reason ?? new Error(`MCP test for "${serverName}" was cancelled`)
  return names
}

function createTransport(record: McpServerRecord): ProbeTransport {
  if (record.transport === 'stdio') {
    return new StdioClientTransport({
      command: record.command,
      args: [...(record.args ?? [])],
      env: { ...scrubbedParentEnv(), ...(record.env ?? {}) },
      ...(record.cwd === undefined || record.cwd === '' ? {} : { cwd: record.cwd }),
    })
  }
  return new StreamableHTTPClientTransport(
    new URL(record.url),
    { requestInit: record.headers === undefined ? {} : { headers: { ...record.headers } } },
  ) as ProbeTransport
}

function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !key.toUpperCase().startsWith('DSH_')) {
      env[key] = value
    }
  }
  return env
}

async function closeWithTimeout(client: Client, transport: ProbeTransport): Promise<void> {
  try {
    await boundedClose(() => client.close())
  } catch (error: unknown) {
    try {
      await boundedClose(() => transport.close())
    } catch (fallbackError) {
      throw new Error(`${errorMessage(error)}; direct transport close failed: ${errorMessage(fallbackError)}`, { cause: error })
    }
    throw error
  }
}

async function boundedClose(close: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`transport close exceeded ${String(MCP_TEST_CLOSE_TIMEOUT_MS)}ms`)), MCP_TEST_CLOSE_TIMEOUT_MS)
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {})
    throw signal.reason ?? new Error('MCP test was cancelled')
  }
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(signal.reason ?? new Error('MCP test was cancelled')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    void operation.catch(() => {})
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
