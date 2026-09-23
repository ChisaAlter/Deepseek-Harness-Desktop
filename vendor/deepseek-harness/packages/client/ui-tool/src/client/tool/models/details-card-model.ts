/** Recorded todo, goal, and schedule values for the compact detail body. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from './tool-call-model.ts'
import type { ToolDetailsModel } from '../components/ToolDetails.tsx'
import { parsedToolCall, singleResultText } from './raw-tool-call.ts'
import { controlDetails } from './control-details-model.ts'
import { inspectionDetails } from './inspection-details-model.ts'
import { detailJson, detailRecord, nonempty } from './detail-model-shared.ts'

type Translate = TranslateNS<'conversation'>
type DetailItem = ToolDetailsModel['items'][number]

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function formatDate(date: Date, locale: string, fallback: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    }).format(date)
  } catch {
    return fallback
  }
}

/**
 * Derive the compact todo list from a todo_write call.
 * @param args - Parsed todo_write arguments.
 * @param t - Conversation dictionary translator.
 * @returns Localized todo details, or null for unsupported input.
 */
export function todosDetail(args: Record<string, unknown>, t: Translate): ToolDetailsModel | null {
  if (!Array.isArray(args.todos)) return null
  const items: DetailItem[] = []
  const seen = new Set<string>()
  for (const todo of args.todos) {
    if (!detailRecord(todo) || !nonempty(todo.content)) return null
    const status = todo.status
    if (status !== 'completed' && status !== 'in_progress' && status !== 'pending') return null
    const title = todo.content.trim()
    if (seen.has(title)) return null
    seen.add(title)
    items.push({ title, status: { value: status, label: t(`detail.todo.${status}`) }, fields: [] })
  }
  return { items, empty: t('detail.todo.empty') }
}

function goalDetail(value: unknown, t: Translate): ToolDetailsModel | null {
  if (!detailRecord(value)) return null
  if (value.goal === null) return { items: [], empty: t('detail.goal.empty') }
  const goal = value.goal
  if (!detailRecord(goal) || !nonempty(goal.id) || !nonempty(goal.objective)
    || !count(goal.revision) || !count(goal.roundsStarted) || !count(goal.maxGoalRounds)) return null
  const phase = goal.phase
  if (phase !== 'active' && phase !== 'paused' && phase !== 'blocked' && phase !== 'complete') return null
  if (value.activation !== 'armed' && value.activation !== 'disarmed') return null
  const fields = [
    { label: t('detail.state'), value: t(phase === 'active' && value.activation === 'disarmed' ? 'detail.goal.disarmed' : `detail.goal.${phase}`) },
    { label: t('detail.goal.rounds'), value: `${goal.roundsStarted} / ${goal.maxGoalRounds}` },
  ]
  if (goal.blockedReason !== undefined) {
    if (!detailRecord(goal.blockedReason) || !nonempty(goal.blockedReason.code) || !nonempty(goal.blockedReason.message)) return null
    fields.push({ label: t('detail.goal.reason'), value: goal.blockedReason.message })
  }
  return { items: [{ title: goal.objective, fields }] }
}

function interval(seconds: number, t: Translate): string {
  if (seconds % 86400 === 0) return t('detail.days', { count: seconds / 86400 })
  if (seconds % 3600 === 0) return t('detail.hours', { count: seconds / 3600 })
  if (seconds % 60 === 0) return t('detail.minutes', { count: seconds / 60 })
  return t('detail.seconds', { count: seconds })
}

function scheduleItem(value: unknown, t: Translate, locale: string): DetailItem | null {
  if (!detailRecord(value) || !nonempty(value.id) || !nonempty(value.prompt)
    || typeof value.scheduledAt !== 'string' || value.deliveryMode !== 'session-local'
    || (value.state !== 'scheduled' && value.state !== 'overdue')) return null
  const date = new Date(value.scheduledAt)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.scheduledAt) return null
  let frequency: string
  switch (value.kind) {
    case 'at': frequency = t('detail.schedule.once'); break
    case 'after':
      if (!count(value.afterSeconds) || value.afterSeconds === 0) return null
      frequency = t('detail.schedule.once')
      break
    case 'every':
      if (!count(value.everySeconds) || value.everySeconds === 0) return null
      frequency = t('detail.schedule.every', { interval: interval(value.everySeconds, t) })
      break
    default: return null
  }
  const dateText = formatDate(date, locale, value.scheduledAt)
  return {
    title: value.prompt,
    fields: [
      { label: t('detail.schedule.when'), value: dateText },
      { label: t('detail.schedule.frequency'), value: frequency },
      { label: t('detail.state'), value: t(`detail.schedule.${value.state}`) },
    ],
  }
}

/**
 * Derive a supported successful result, retaining generic output on unknown or malformed data.
 * @param block - Logged root or nested Tool call and its optional result.
 * @param t - Conversation dictionary translator.
 * @param locale - Display locale for absolute dates in the viewer's time zone.
 * @returns Localized detail data, or null for raw input/output.
 */
export function detailsCardModel(block: ToolCallBlock, t: Translate, locale: string): ToolDetailsModel | null {
  if (!('kind' in block) || block.isError) return null
  const call = parsedToolCall(block)
  if (call === null) return null
  const text = singleResultText(block)
  if (text === undefined) return null
  const value = detailJson(text)
  const details = controlDetails(call.name, call.args, text, value, t) ?? inspectionDetails(call.name, call.args, text, value, t, locale)
  if (details !== null) return details
  if (value === undefined) return null
  switch (call.name) {
    case 'create_goal':
    case 'get_goal':
    case 'update_goal': return goalDetail(value, t)
    case 'schedule_create': {
      const item = scheduleItem(value, t, locale)
      return item === null ? null : { items: [item] }
    }
    case 'schedule_list': {
      if (!Array.isArray(value)) return null
      const items: DetailItem[] = []
      for (const entry of value) {
        const item = scheduleItem(entry, t, locale)
        if (item === null) return null
        items.push(item)
      }
      return { items, summary: t('detail.schedule.count', { count: items.length }), empty: t('detail.schedule.empty') }
    }
    case 'schedule_delete':
      if (!detailRecord(value) || !nonempty(value.id) || value.deleted !== true) return null
      return { items: [{ title: value.id, fields: [{ label: t('detail.state'), value: t('detail.schedule.deleted') }] }] }
    default: return null
  }
}
