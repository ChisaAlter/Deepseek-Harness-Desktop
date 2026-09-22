/** Read-only Host and Client runtime API discovery for plugin development. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { presentInspectListCall, presentInspectQueryCall } from './present.ts'
import { CORDIS_SYSTEM_PROMPT } from './prompt.ts'
import { hostInspectProviders } from './providers.ts'

export const name = 'tool-cordis'
export const inject = ['tools', 'systemPrompt', 'cordisInspect']

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error('Cordis inspection requires an Agent-backed session')
  return exec.agent
}

/** Register read-only runtime inspection tools.
 * @param ctx Agent-scoped registration context.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:cordis', order: ctx.systemPrompt.getSectionOrder('TOOL_CORDIS'), text: CORDIS_SYSTEM_PROMPT })
  for (const provider of hostInspectProviders(ctx)) {
    ctx.effect(() => ctx.cordisInspect.register(provider), `tool-cordis: inspect ${provider.manifest.id}`)
  }
  ctx.tools.register(defineTool({
    name: 'cordis_inspect_list',
    description:
      'List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest '
      + 'manifests synchronized from the Client. Each entry includes its platform, purpose, read-only methods, and '
      + 'input/output schemas. Call this Tool before writing or configuring a plugin, then select the provider and '
      + 'method for cordis_inspect_query from its result. Do not guess names or treat an Inspect method as a business '
      + 'Service that Plugin code can call.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(_args, _exec): Promise<JsonValue> {
      return Promise.resolve({ providers: ctx.cordisInspect.list() } as unknown as JsonValue)
    },
    presentCall: presentInspectListCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_inspect_query',
    description:
      'Run a read-only query explicitly declared by an Inspect Provider. platform, provider, and method must come '
      + 'from cordis_inspect_list, and input must satisfy that method\'s schema. Use this Tool before writing plugin code '
      + 'to read exact Service methods, Event modes, Builtin signatures, Tool schemas, theme tokens, or live Slot '
      + 'trees and props. Host queries run locally. A Client query waits for the first valid page response and '
      + 'remains pending until a page answers or the Tool is cancelled. This Tool cannot invoke business Service '
      + 'methods or modify the runtime. For Service.listService and Event.listEvents, query without input to navigate '
      + 'the compact signature directory, then query the exact service or event for its structured contract and '
      + 'referenced types. For Slots.listSubTree, query without root to navigate the compact tree, then query an '
      + 'exact Slot root for its complete registration contract and props; an exact Factory root returns its identity, '
      + 'scope, and registrant.',
    parameters: {
      platform: { type: 'string', required: true, enum: ['host', 'client'], description: 'Runtime platform that owns the Provider.' },
      provider: { type: 'string', required: true, description: 'Exact Provider ID returned by cordis_inspect_list.' },
      method: { type: 'string', required: true, description: 'Exact method name declared by the Provider manifest.' },
      input: { type: 'json', description: 'Optional query input; it must satisfy the method input schema.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const data = await ctx.cordisInspect.query(
        args.platform,
        args.provider,
        args.method,
        args.input,
        requireAgent(exec),
        exec.signal,
      )
      return { platform: args.platform, provider: args.provider, method: args.method, data }
    },
    presentCall: presentInspectQueryCall,
  }))

}
