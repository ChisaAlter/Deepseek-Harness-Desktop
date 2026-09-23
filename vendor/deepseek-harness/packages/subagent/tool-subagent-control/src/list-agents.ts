/**
 * The globally named `list_agents` tool: a thin model-facing adapter over
 * the continuable projection of `ctx.subagents.listChildren()` and, for the
 * `descendants` scope, `ctx.subagents.listDescendants()`. It stays separately
 * loadable from the root `send_message` plugin so a deployment can register
 * continuation delivery without exposing discovery.
 * @module @deepseek-ai/dsh-tool-subagent-control/list-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentCatalogEntry, SubagentDescendantListEntry, SubagentListEntry,
} from '@deepseek-ai/dsh-subagent'
import { assertNever } from '@deepseek-ai/dsh-util-values'

export const name = 'tool-subagent-list-agents'
export const inject = ['tools', 'subagents', 'agents']

type ListAgentsScope = 'children' | 'descendants'

interface ListAgentsRequest {
  readonly scope?: ListAgentsScope
}

interface ListAgentsSpec {
  readonly scope: ListAgentsScope
}

type ListAgentsEntry =
  | {
    readonly kind: 'child'
    readonly id: SessionId
    readonly label: string
    readonly status: 'running' | 'inactive'
    readonly parent?: SessionId
    readonly depth?: number
  }
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
    readonly parent?: SessionId
    readonly depth?: number
  }

/** Resolve the optional model request into an internal required-scope spec. */
function resolveListAgentsRequest(request: ListAgentsRequest): ListAgentsSpec {
  return { scope: request.scope ?? 'children' }
}

/** Report turn activity without exposing whether the child is loaded. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'inactive' {
  return agents.get(id)?.status === 'running' ? 'running' : 'inactive'
}

/** Project one service row into the model-facing entry, or omit a one-shot child. */
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentCatalogEntry | SubagentListEntry,
  position?: Pick<SubagentDescendantListEntry, 'parentId' | 'depth'>,
): ListAgentsEntry | undefined {
  const at = position === undefined ? {} : { parent: position.parentId, depth: position.depth }
  if ('kind' in entry && entry.kind === 'diagnostic') {
    return { kind: 'diagnostic', id: entry.id, reason: entry.reason, ...at }
  }
  // One-shot children cannot be continued by send_message, so the model
  // never selects them; discovery still traversed them for descendants.
  if (entry.mode !== 'continuable') return undefined
  return {
    kind: 'child',
    id: entry.id,
    label: entry.label,
    status: statusOf(agents, entry.id),
    ...at,
  }
}

/**
 * Register the `list_agents` tool.
 * @param ctx - context carrying the tool registry, subagent service, and live Agent registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_agents',
    description:
      'List your continuable background subagents by durable id and label. Use it to recall which ones '
      + 'you started, not to poll for completion — you are told when one finishes. Status comes from the live '
      + 'registry: running means the agent is working right now; inactive means no turn is executing, whether '
      + 'the child is loaded or must be resumed. inactive does not describe task completion, success, failure, '
      + 'or waiting for other agents. A `send_message` steers a running child at its nearest step boundary '
      + 'or starts or resumes a turn for an inactive child, and a direct child remains a `send_message` '
      + 'candidate in every status. The snapshot is not a delivery '
      + 'promise — `send_message` performs the authoritative check and may still fail. Children that could '
      + 'not be read are reported as diagnostics only in `descendants` scope. Scope `descendants` '
      + 'walks the whole tree below you in stable pre-order, annotating each entry with its durable direct-parent '
      + 'session id and depth. You may use `send_message` only for depth-1 entries; deeper entries are '
      + 'candidates for `interrupt_agent` only.',
    parameters: {
      scope: {
        type: 'string',
        enum: ['children', 'descendants'],
        description: 'children (default) lists direct children only; descendants walks the complete tree below you.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['child'] },
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['running', 'inactive'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['diagnostic'] },
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true, enum: ['corrupt', 'unsupported', 'unavailable'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
          ],
        },
      },
      render: (args, entries) => {
        const request = resolveListAgentsRequest(args)
        return [{
          type: 'text',
          text: entries.length === 0
            ? '(no subagents)'
            : entries.map((entry) => {
              // A descendants row always carries its position; children rows
              // never render it. String() spans the schema-optional shape
              // without a dead fallback branch.
              const at = request.scope === 'descendants'
                ? ` parent=${String(entry.parent)} depth=${String(entry.depth)}`
                : ''
              return entry.kind === 'child'
                ? `${entry.id} [${entry.status}]${at} — ${entry.label}`
                : `${entry.id} [diagnostic: ${entry.reason}]${at}`
            }).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const request = resolveListAgentsRequest(args)
      switch (request.scope) {
        case 'children': {
          const entries = await ctx.subagents.listChildren(parent.id, exec.signal)
          return entries
            .map(entry => project(ctx.agents, entry))
            .filter(entry => entry !== undefined)
        }
        case 'descendants': {
          // Complete-corpus reads can await storage, so they observe tool cancellation.
          const entries = await ctx.subagents.listDescendants(parent.id, exec.signal)
          return entries
            .map(entry => project(ctx.agents, entry, entry))
            .filter(entry => entry !== undefined)
        }
        /* v8 ignore next 2 -- the resolver normalizes the schema-validated closed scope before dispatch. */
        default:
          return assertNever(request.scope, 'list_agents scope')
      }
    },
  }))
}
