/**
 * File-backed MCP server catalog: watches `$DSH_HOME/mcp-servers.yaml` and
 * mounts one `@deepseek-ai/dsh-mcp-client` instance per enabled record.
 * @module @deepseek-ai/dsh-mcp-servers-file
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { McpServersFile, type McpServersFileOptions } from './service.ts'

/** Plugin configuration. Merges with the Zod `Config` schema below. */
export interface Config extends McpServersFileOptions {}
export type { ChildHandle, McpClientMounter, ResolvedSpec } from './service.ts'
export { McpServersFile, defaultMounter, resolveSpec } from './service.ts'
export type { McpOAuthListener, McpOAuthRuntime, McpOAuthTokens } from './oauth.ts'
export { authorizeMcpHttp, defaultOAuthRuntime } from './oauth.ts'
export type {
  ChildFiberPhase,
  McpHttpServerRecord,
  McpReconnectRecord,
  McpServerRecord,
  McpServerRecordBase,
  McpServersDocument,
  McpServerUpsert,
  McpStdioServerRecord,
} from './types.ts'
export {
  EMPTY_DOCUMENT,
  MCP_NAME_PATTERN,
  SECRET_MASK,
  isSecretKey,
  maskRecordSecrets,
  parseDocument,
  removeRecord,
  serializeDocument,
  setRecordEnabled,
  toClientConfig,
  upsertRecord,
} from './document.ts'

/** Cordis plugin name. */
export const name = 'mcp-servers-file'

/** Plugin configuration schema. */
export const Config: z<Config> = z.object({
  path: z.string(),
  dshHome: z.string(),
  watch: z.boolean().default(true),
  debounceMs: z.number().min(0).default(100),
})

/**
 * Register the file service and reconcile child mcp-client instances.
 * @param ctx - root context.
 * @param config - document path and watch policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const service = new McpServersFile(ctx, config)
  ctx.effect(() => service.start(), 'mcp-servers-file.lifecycle')
}
