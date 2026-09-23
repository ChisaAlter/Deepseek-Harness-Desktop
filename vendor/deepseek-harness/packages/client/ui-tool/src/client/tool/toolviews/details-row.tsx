/** Keyed recorded-result rows sharing the compact detail body. */
import { useMemo } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import {
  IconAgentPresetOutlineRegular, IconBranchOutlineRegular, IconChecklistOutlineRegular, IconClockOutlineRegular,
  IconCodeOutlineRegular, IconCordisPluginOutlineRegular, IconGoalOutlineRegular, IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { detailsCardModel } from '../models/details-card-model.ts'
import { parsedToolCall } from '../models/raw-tool-call.ts'
import { toolRowModel } from '../models/tool-call-model.ts'

const TITLE_KEYS = {
  create_goal: 'tool.title.createGoal',
  get_goal: 'tool.title.getGoal',
  update_goal: 'tool.title.updateGoal',
  schedule_create: 'tool.title.createSchedule',
  schedule_list: 'tool.title.listSchedules',
  schedule_delete: 'tool.title.deleteSchedule',
  cordis_inspect_list: 'tool.title.inspectProviders',
  cordis_inspect_query: 'tool.title.queryRuntime',
  cordis_inspect_self: 'tool.title.inspectPlugins',
  workflow: 'tool.title.workflow',
  ralph: 'tool.title.ralph',
  session_event_read: 'tool.title.readEvent',
  session_event_search: 'tool.title.searchEvents',
  session_event_trace: 'tool.title.traceEvent',
  session_search: 'tool.title.searchSessions',
  session_trace: 'tool.title.traceSession',
  list_subagent_models: 'tool.title.listModels',
  subagent: 'tool.title.subagent',
  list_agents: 'tool.title.listAgents',
  send_message: 'tool.title.sendMessage',
  interrupt_agent: 'tool.title.interruptAgent',
  job_list: 'tool.title.listJobs',
  job_output: 'tool.title.readJob',
  job_kill: 'tool.title.killJob',
  terminal_open: 'tool.title.openTerminal',
  terminal_read: 'tool.title.readTerminal',
  terminal_list: 'tool.title.listTerminals',
  terminal_signal: 'tool.title.signalTerminal',
  terminal_close: 'tool.title.closeTerminal',
  lsp: 'tool.title.lsp',
  spawn_teammate: 'tool.title.spawnTeammate',
  team_task_create: 'tool.title.createTeamTask',
  team_task_get: 'tool.title.getTeamTask',
  team_task_update: 'tool.title.updateTeamTask',
  team_task_list: 'tool.title.listTeamTasks',
  wait_agent: 'tool.title.waitAgent',
} as const

const LSP_TITLE_KEYS = {
  goToDefinition: 'tool.title.findDefinition',
  findReferences: 'tool.title.findReferences',
  goToImplementation: 'tool.title.findImplementation',
  hover: 'tool.title.hoverSymbol',
} as const

function detailIcon(toolName: string) {
  if (toolName.startsWith('schedule_')) return <IconClockOutlineRegular size={14} />
  if (toolName.endsWith('_goal')) return <IconGoalOutlineRegular size={14} />
  if (toolName.startsWith('cordis_')) return <IconCordisPluginOutlineRegular />
  if (toolName.startsWith('terminal_')) return <IconCodeOutlineRegular size={14} />
  if (toolName.startsWith('session_') || toolName === 'lsp') return <IconSearchOutlineRegular size={14} />
  if (toolName.startsWith('job_') || toolName.startsWith('team_task_')) return <IconChecklistOutlineRegular />
  if (toolName === 'workflow' || toolName === 'ralph') return <IconBranchOutlineRegular size={14} />
  return <IconAgentPresetOutlineRegular size={14} />
}

/**
 * Present recorded entities, receipts, and report fields in the existing expandable row.
 * @param props - Tool call, row actions, and locale supplied by the keyed slot.
 * @returns A Tool row with structured details or generic input/output.
 */
export function DetailsRow({ toolName, block, cwd, home, openFile, inspect, useDisclosure, t }: ToolCallViewProps & PropsLocale<'conversation'>) {
  const model = toolRowModel(toolName, block, cwd, home)
  const locale = document.documentElement.lang
  const details = useMemo(() => detailsCardModel(block, t, locale), [block, t, locale])
  const operation = toolName === 'lsp' ? parsedToolCall(block)?.args.operation : undefined
  const titleKey = typeof operation === 'string' && Object.hasOwn(LSP_TITLE_KEYS, operation)
    ? LSP_TITLE_KEYS[operation as keyof typeof LSP_TITLE_KEYS]
    : Object.hasOwn(TITLE_KEYS, toolName) ? TITLE_KEYS[toolName as keyof typeof TITLE_KEYS] : model.titleKey
  return (
    <ToolRow
      useDisclosure={useDisclosure}
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={detailIcon(toolName)}
      title={t(titleKey)}
      summary={details?.summary ?? details?.items[0]?.title ?? details?.empty ?? model.summary}
      details={details}
      bodyRaw={model.bodyRaw}
      output={model.output}
      errorSummary={model.errorSummary}
      state={model.state}
      inspect={inspect}
      onOpenFile={openFile}
    />
  )
}

/** Register recorded-result details through the standard atomic Tool slot. */
export const detailsToolview = {
  name: 'details-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'create_goal', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'get_goal', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'update_goal', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'schedule_create', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'schedule_list', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'schedule_delete', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'cordis_inspect_list', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'cordis_inspect_query', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'cordis_inspect_self', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'workflow', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'ralph', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'session_event_read', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'session_event_search', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'session_event_trace', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'session_search', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'session_trace', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'list_subagent_models', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'subagent', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'list_agents', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'send_message', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'interrupt_agent', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'job_list', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'job_output', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'job_kill', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'terminal_open', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'terminal_read', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'terminal_list', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'terminal_signal', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'terminal_close', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'lsp', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'spawn_teammate', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'team_task_create', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'team_task_get', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'team_task_update', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'team_task_list', locale: NS }, DetailsRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'wait_agent', locale: NS }, DetailsRow)
    })
  },
}
