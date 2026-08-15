/**
 * mcp domain zod schemas (names derived from map keys: mcpDescribeRequestSchema /
 * mcpDescribeValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { McpProbeResultView, McpServerStatusView } from './mcp.ts'

/** McpServerStatusView row of mcp.describe. */
export const mcpServerStatusViewSchema = z.object({
  serverName: z.string(),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]),
  status: z.object({
    phase: z.union([
      z.literal('connecting'),
      z.literal('connected'),
      z.literal('reconnecting'),
      z.literal('error'),
      z.literal('disposed'),
    ]),
    error: z.string().optional(),
  }),
}) satisfies z.ZodType<Wire<McpServerStatusView>>

/** mcp.describe request payload. */
export const mcpDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'mcp.describe'>>>

/** mcp.describe response value. */
export const mcpDescribeValueSchema = z.object({
  servers: z.array(mcpServerStatusViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.describe'>>>

/** mcp.probe request payload. */
export const mcpProbeRequestSchema = z.union([
  z.object({
    serverName: z.string(),
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  }),
  z.object({
    serverName: z.string(),
    transport: z.literal('streamable-http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]) satisfies z.ZodType<Wire<RequestPayload<'mcp.probe'>>>

/** mcp.probe response value. */
export const mcpProbeValueSchema = z.union([
  z.object({ ok: z.literal(true), tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
  })) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]) satisfies z.ZodType<Wire<McpProbeResultView>>
