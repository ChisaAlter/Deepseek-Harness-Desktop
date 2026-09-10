/** MCP wire fixture returning a repeated discovery cursor over empty pages. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new McpServer(
  { name: 'repeated-cursor', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
let requests = 0
server.server.setRequestHandler(ListToolsRequestSchema, () => {
  // Bound the broken-client path without relying on a test timeout to kill it.
  if (++requests > 2) throw new Error('pagination continued after the repeated cursor')
  return { tools: [], nextCursor: 'same-cursor' }
})

await server.connect(new StdioServerTransport())
